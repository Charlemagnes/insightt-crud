import type { ErrorCode, ErrorResponse } from "@insightt/shared";
import type { ErrorRequestHandler, RequestHandler } from "express";
import { UnauthorizedError } from "express-oauth2-jwt-bearer";

import type { LogSink } from "@/middleware/logging";

/**
 * A failure the API means to report. Anything thrown that is not one of these
 * is a bug, and is reported as `500 INTERNAL` with nothing of its insides in
 * the response body.
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

    const { status, code, message, details } = describe(error);

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
      error: details === undefined ? { code, message } : { code, message, details },
    };
    res.status(status).json(body);
  };
}

interface DescribedError {
  status: number;
  code: ErrorCode;
  message: string;
  details?: unknown;
}

function describe(error: unknown): DescribedError {
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

  return {
    status: 500,
    code: "INTERNAL",
    message: "Something went wrong",
  };
}
