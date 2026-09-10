import type { Request, RequestHandler } from "express";
import { auth } from "express-oauth2-jwt-bearer";

import type { Env } from "@/env";
import { ApiError } from "@/middleware/errors";

/**
 * The person behind the current request. An operation on a Task succeeds only
 * when the Actor is that Task's Owner (CONTEXT.md, "Actor").
 *
 * Deliberately not in `@insightt/shared`: no Actor ever crosses the wire — the
 * API never returns a user, it only reads the token.
 */
export interface Actor {
  userId: string;
}

/**
 * Validates the bearer token against the tenant's JWKS. Every API route sits
 * behind this, so an unauthenticated request is rejected before any handler
 * runs; the middleware throws `UnauthorizedError`, which the error handler
 * turns into `401 UNAUTHENTICATED`.
 */
export function createAuthMiddleware(env: Env): RequestHandler {
  return auth({
    issuerBaseURL: env.auth0IssuerBaseUrl,
    audience: env.auth0Audience,
    tokenSigningAlg: "RS256",
  });
}

/**
 * The auth boundary, and the **only** place the Auth0 `sub` claim is read. From
 * here up it is called `userId` and nothing else (CONTEXT.md, "User ID").
 */
export const attachActor: RequestHandler = (req, _res, next) => {
  const userId = req.auth?.payload.sub;

  if (!userId) {
    next(new ApiError(401, "UNAUTHENTICATED", "Token carries no subject"));
    return;
  }

  req.actor = { userId };
  next();
};

/**
 * Reads the Actor a handler is guaranteed to have, without an assertion at
 * every call site. It throws rather than returning `undefined` because a route
 * mounted outside the auth stack is a wiring bug, not a request the caller can
 * fix.
 */
export function actorOf(req: Request): Actor {
  if (!req.actor) {
    throw new Error("No Actor on the request: route mounted outside the auth stack");
  }
  return req.actor;
}
