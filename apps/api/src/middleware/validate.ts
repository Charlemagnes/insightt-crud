import type { Request, RequestHandler } from "express";
import type { z } from "zod";

import { ApiError } from "@/middleware/errors";

/** The three request parts worth validating. Each is optional. */
export interface ValidationSchemas {
  body?: z.ZodType;
  query?: z.ZodType;
  params?: z.ZodType;
}

/** What the handler gets back: the parsed value of each part that was declared. */
type Validated<Schemas extends ValidationSchemas> = {
  [Part in keyof Schemas]: Schemas[Part] extends z.ZodType
    ? z.infer<Schemas[Part]>
    : never;
};

/**
 * A validating middleware that can also read back what it parsed, with the
 * types it parsed into. It is the middleware — mount it in the route chain —
 * and `.read(req)` is the typed view of `req.valid`.
 *
 * Returning the reader alongside the middleware is what keeps the handler
 * honest. `req.valid` has to be declared as `unknown` on the global `Request`,
 * because a single interface cannot describe every route's schemas at once; the
 * reader closes over the schemas that were actually mounted, so the handler
 * gets their inferred types without the schemas being named twice.
 */
export type Validator<Schemas extends ValidationSchemas> = RequestHandler & {
  read(req: Request): Validated<Schemas>;
};

/**
 * Parses the declared parts of a request and stores the results on `req.valid`,
 * so a handler only ever sees input that has already been checked. A malformed
 * payload never reaches one.
 *
 * The two failure paths are not the same status, and the difference is
 * deliberate:
 *
 * - **`body` or `query`** fails as `422 VALIDATION_FAILED`, with Zod's issues
 *   in `details` so a form can show them per field.
 * - **`params`** fails as `404 NOT_FOUND`. A path parameter that does not parse
 *   names nothing that could exist — `/api/tasks/nonsense` is not a bad request
 *   about a Task, it is a Task that is not there. Reporting it as `404` also
 *   keeps it identical to a Task owned by someone else, so the two answers
 *   cannot be told apart, and it never reaches Postgres, where comparing `uuid`
 *   to `'nonsense'` is a type error that would surface as `500`.
 */
export function validate<Schemas extends ValidationSchemas>(
  schemas: Schemas,
): Validator<Schemas> {
  const middleware: RequestHandler = (req, _res, next) => {
    const valid: Record<string, unknown> = {};

    for (const part of ["params", "query", "body"] as const) {
      const schema = schemas[part];
      if (!schema) continue;

      const parsed = schema.safeParse(req[part]);

      if (!parsed.success) {
        next(
          part === "params"
            ? new ApiError(404, "NOT_FOUND", "Not found")
            : new ApiError(
                422,
                "VALIDATION_FAILED",
                `Invalid request ${part}`,
                parsed.error.issues,
              ),
        );
        return;
      }

      valid[part] = parsed.data;
    }

    req.valid = valid;
    next();
  };

  return Object.assign(middleware, {
    read: (req: Request) => req.valid as Validated<Schemas>,
  });
}
