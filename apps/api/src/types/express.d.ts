import type { Actor } from "@/middleware/auth";

/**
 * What the middleware stack adds to a request. `express-oauth2-jwt-bearer`
 * contributes `req.auth` from its own declaration; these are ours.
 */
declare global {
  namespace Express {
    interface Request {
      /** Correlates the inbound, actor and outbound log lines. */
      requestId?: string;
      /** Set by `attachActor`, once auth has resolved. Read with `actorOf`. */
      actor?: Actor;
    }

    interface Locals {
      /**
       * The class of whatever the error handler caught. Declared here because
       * it is the one channel between two middlewares that never call each
       * other: `errors.ts` writes it, `logging.ts` reads it onto the outbound
       * line. The response body deliberately never carries it.
       */
      errorName?: string;
    }
  }
}
