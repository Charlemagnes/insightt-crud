import type { ErrorCode, ErrorResponse } from "@insightt/shared";
import type { ErrorRequestHandler, RequestHandler } from "express";
import { UnauthorizedError } from "express-oauth2-jwt-bearer";

import type { LogSink } from "@/middleware/logging";

/**
 * A failure the API means to report. Anything thrown that is not one of these
 * is a bug, and is reported as `500 INTERNAL` with nothing of its insides in
 * the response body.
 *
 * `apps/web/src/api/client.ts` declares a twin of this class. The two are
 * deliberately not shared: `@insightt/shared` holds wire contracts, and a
 * runtime class that throws is not one. What crosses the wire is the envelope
 * they both agree on, `ErrorResponseSchema`.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Reached only when no route matched. A path the API does not serve and a Task
 * the Actor does not own are reported identically, which is the point: neither
 * answer tells the caller whether the thing exists.
 */
export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new ApiError(404, "NOT_FOUND", "Not found"));
};

/**
 * The single place an exception becomes a status code. It also records the
 * error's class on `res.locals` so the outbound log line can name it — the
 * response body deliberately cannot.
 */
export function createErrorHandler(log: LogSink): ErrorRequestHandler {
  return (error, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }

    res.locals.errorName = error instanceof Error ? error.name : "Unknown";

    const { status, code, message, details } = classify(error);

    // The internals of an unexpected failure are worth keeping, just not worth
    // returning: they go to the log, beside the request id that produced them.
    if (status >= 500) {
      log({
        ts: new Date().toISOString(),
        requestId: req.requestId ?? null,
        direction: "error",
        error: error instanceof Error ? error.stack : String(error),
      });
    }

    const body: ErrorResponse = {
      error:
        details === undefined ? { code, message } : { code, message, details },
    };
    res.status(status).json(body);
  };
}

interface ClassifiedError {
  status: number;
  code: ErrorCode;
  message: string;
  details?: unknown;
}

function classify(error: unknown): ClassifiedError {
  if (error instanceof ApiError) {
    return {
      status: error.status,
      code: error.code,
      message: error.message,
      details: error.details,
    };
  }

  // `express-oauth2-jwt-bearer` throws this for a missing, malformed, expired
  // or wrongly-audienced token. Its own message is safe to pass on — it says
  // what is wrong with the token, never anything about the tenant.
  if (error instanceof UnauthorizedError) {
    return {
      status: 401,
      code: "UNAUTHENTICATED",
      message: error.message,
    };
  }

  // Unparseable JSON and an oversized payload are the caller's mistake, and
  // `express.json` throws them before any route or schema is reached. Without
  // this they would be reported as `500 INTERNAL`, blaming the server for a
  // request it was right to refuse.
  if (isMalformedRequest(error)) {
    return {
      status: 422,
      code: "VALIDATION_FAILED",
      message: "Request body could not be read",
      details: { reason: error.type },
    };
  }

  return {
    status: 500,
    code: "INTERNAL",
    message: "Something went wrong",
  };
}

/**
 * `body-parser` tags every error it throws with a `type` and a 4xx `status`
 * (`entity.parse.failed`, `entity.too.large`, `charset.unsupported`, …).
 * Matching on the shape rather than on the message keeps this independent of
 * its wording, and of which of the several failures it happened to be.
 *
 * The status is reported as `422 VALIDATION_FAILED` rather than the 400 or 413
 * the parser chose, so that the frozen error table in PLAN.md §6 stays the
 * whole vocabulary; the parser's own reason travels in `details`.
 */
function isMalformedRequest(
  error: unknown,
): error is Error & { type: string; status: number } {
  if (!(error instanceof Error) || !("type" in error) || !("status" in error)) {
    return false;
  }
  const { type, status } = error as { type: unknown; status: unknown };
  return (
    typeof type === "string" &&
    typeof status === "number" &&
    status >= 400 &&
    status < 500
  );
}
