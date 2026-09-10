import type { Actor } from "@/middleware/auth";

/**
 * What the middleware stack adds to a request. `express-oauth2-jwt-bearer`
 * contributes `req.auth` from its own declaration; these two are ours.
 */
declare global {
  namespace Express {
    interface Request {
      /** Correlates the inbound, actor and outbound log lines. */
      requestId?: string;
      /** Set by `attachActor`, once auth has resolved. Read with `actorOf`. */
      actor?: Actor;
    }
  }
}
