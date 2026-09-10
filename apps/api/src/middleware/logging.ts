import { randomUUID } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";

import type { RequestHandler } from "express";

/**
 * One structured line. `requestId` is what stitches the three lines a single
 * request produces — inbound, actor, outbound — back together.
 */
export interface LogRecord {
  ts: string;
  requestId: string | null;
  direction: "startup" | "inbound" | "actor" | "outbound" | "error";
  [field: string]: unknown;
}

/**
 * Where log lines go. Injected rather than imported so tests can read what the
 * API claims to have logged instead of scraping stdout.
 */
export type LogSink = (record: LogRecord) => void;

/** The production sink: structured JSON on stdout, one line per record. */
export const consoleLogSink: LogSink = (record) => {
  console.log(JSON.stringify(record));
};

const REDACTED = "[REDACTED]";

/**
 * Headers whose values are credentials. `set-cookie` is here for the response
 * side even though this API sets no cookies — the redaction list should not
 * need revisiting if one ever appears.
 */
const REDACTED_HEADERS = new Set(["authorization", "cookie", "set-cookie"]);

/** Roughly 1KB, past which a body tells the log more about volume than content. */
const BODY_LOG_LIMIT = 1024;

/**
 * Logs every request in and every response out.
 *
 * **Mount it first**, ahead of CORS, the body parser and auth. Everything
 * downstream can end a request on its own — `cors` answers a preflight itself,
 * `express.json` throws on a malformed body, `express-oauth2-jwt-bearer`
 * rejects a bad token — and each of those is API activity with headers and a
 * status code. Mounted anywhere further down, whole classes of request produce
 * no line at all, and "send a bad token, read the log" has nothing to read.
 *
 * **Both lines are written when the response closes**, the way `morgan` does
 * it, because the interesting fields do not exist at the moment a request
 * arrives: `req.body` is parsed by a later middleware, and Express fills
 * `req.params` in only once it has matched a route. The inbound line still
 * carries the time the request was *received*, not the time it was written, so
 * the record says when things happened even though the console does not.
 *
 * Emitting all three lines from one place is also what keeps them in order and
 * on one request id: the Actor is read off the request that `attachActor`
 * stamped, rather than logged by a second middleware racing ahead of the first.
 */
export function createRequestLogging(log: LogSink): RequestHandler {
  return (req, res, next) => {
    const requestId = randomUUID();
    const receivedAt = new Date().toISOString();
    const startedAt = process.hrtime.bigint();
    req.requestId = requestId;

    // `close` rather than `finish`: it fires for a response the client gave up
    // on as well as one that completed, so an aborted request is still logged.
    res.on("close", () => {
      const completed = res.writableEnded;
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

      log({
        ts: receivedAt,
        requestId,
        direction: "inbound",
        // Always null. The Actor is a separate line by design: a request that
        // never got past auth still has to appear here, and it appears with the
        // User ID recorded as absent rather than not appearing at all.
        userId: null,
        method: req.method,
        path: req.originalUrl,
        route: req.route?.path ?? null,
        params: req.params,
        query: req.query,
        headers: redactHeaders(req.headers),
        body: truncateBody(req.body),
      });

      if (req.actor) {
        log({
          ts: new Date().toISOString(),
          requestId,
          direction: "actor",
          userId: req.actor.userId,
        });
      }

      log({
        ts: new Date().toISOString(),
        requestId,
        direction: "outbound",
        status: completed ? res.statusCode : null,
        durationMs,
        ...(completed ? {} : { aborted: true }),
        ...(res.locals.errorName ? { error: res.locals.errorName } : {}),
      });
    });

    next();
  };
}

function redactHeaders(headers: IncomingHttpHeaders): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      REDACTED_HEADERS.has(name.toLowerCase()) ? REDACTED : value,
    ]),
  );
}

function truncateBody(body: unknown): unknown {
  if (body === undefined) return undefined;

  let serialised: string;
  try {
    serialised = JSON.stringify(body) ?? String(body);
  } catch {
    return "[unserialisable]";
  }

  if (serialised.length <= BODY_LOG_LIMIT) return body;
  return `${serialised.slice(0, BODY_LOG_LIMIT)}…[truncated]`;
}
