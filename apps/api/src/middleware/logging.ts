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
  direction: "inbound" | "actor" | "outbound" | "error";
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
 * Mount this **before** the auth middleware. The brief asks for all API
 * activity logged, with headers in and a status code out; a rejected request
 * has both, and mounted after `express-oauth2-jwt-bearer` it would produce no
 * line at all — leaving "send a bad token, read the log" with nothing to read.
 * An unauthenticated request logs `userId: null`, which is information rather
 * than a gap; the Actor's User ID is stamped onto the same request id by
 * `createActorLogging` once auth has resolved.
 *
 * Mount it **after** the body parser, so the body it truncates is the parsed
 * one.
 */
export function createRequestLogging(log: LogSink): RequestHandler {
  return (req, res, next) => {
    const requestId = randomUUID();
    req.requestId = requestId;
    const startedAt = process.hrtime.bigint();

    log({
      ts: new Date().toISOString(),
      requestId,
      direction: "inbound",
      userId: null,
      method: req.method,
      path: req.originalUrl,
      // Express fills `params` in as it matches a route, which has not happened
      // yet at this mount point — deliberately, see above. It is the query
      // string that carries the caller's input on the way in.
      params: req.params,
      query: req.query,
      headers: redactHeaders(req.headers),
      body: truncateBody(req.body),
    });

    res.on("finish", () => {
      const durationNs = process.hrtime.bigint() - startedAt;
      log({
        ts: new Date().toISOString(),
        requestId,
        direction: "outbound",
        status: res.statusCode,
        durationMs: Number(durationNs) / 1e6,
        ...(typeof res.locals.errorName === "string"
          ? { error: res.locals.errorName }
          : {}),
      });
    });

    next();
  };
}

/**
 * Stamps the resolved Actor onto the request id the inbound line already
 * carries. Mount after the auth middleware; without it the log knows a request
 * happened but not who made it.
 */
export function createActorLogging(log: LogSink): RequestHandler {
  return (req, _res, next) => {
    log({
      ts: new Date().toISOString(),
      requestId: req.requestId ?? null,
      direction: "actor",
      userId: req.actor?.userId ?? null,
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
