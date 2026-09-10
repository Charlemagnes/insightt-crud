# Express as a separate service, not a Next.js BFF

The brief names Express as the backend and asks us to evaluate whether Next.js'
BFF (route handlers as a backend-for-frontend) would serve this application
better, "considering the auth and concurrency requirements". We evaluated both
and kept Express as a separate process.

## Considered Options

**Next.js BFF.** Route handlers under `app/api/`, one process, one deployment,
one `tsconfig`. Its real advantage is auth: a BFF can hold the Auth0 session in
an `httpOnly` cookie via `@auth0/nextjs-auth0`, so no access token is ever
reachable from JavaScript and the XSS exposure of our `localStorage` choice
disappears. It also removes CORS entirely, since the browser talks to one
origin.

**Express as a separate service.** Two processes, two ports, explicit CORS, and
a token the browser holds.

## Decision

Express, for three reasons.

**The brief's own framing.** It asks for "a TypeScript backend web framework"
and separately for "communication between backend and frontend through JSON REST
API". A BFF satisfies both only on a technicality — the REST boundary becomes
an internal call within one Next process, and "backend framework" becomes
"Next.js again". Express makes the boundary a real one, across processes and
origins, which is what the requirement appears to be reaching for.

**Concurrency is neutral between them.** Every concurrency guarantee in this
system lives in Postgres: the conditional `UPDATE` in `mark_task_done()`
serialised by row locking, and `version`-based optimistic locking on edits. A
BFF would not make those easier or harder. Concurrency, despite being named in
the question, does not discriminate between the options.

**Auth genuinely favours the BFF, and we accepted the cost.** The `httpOnly`
cookie story is better than tokens in `localStorage`. We chose the weaker one
because the brief asks for authenticated frontend-to-backend communication over
a REST API, and a bearer token validated by `express-oauth2-jwt-bearer` against
the tenant JWKS demonstrates that directly, where a cookie-session BFF
demonstrates a Next.js feature instead. The README states this trade rather than
hiding it.

## Consequences

- Two processes in development, run together with `concurrently`.
- CORS is configured explicitly, including `exposedHeaders` for `ETag` and
  `X-Idempotent-Replay`, neither of which is CORS-safelisted.
- The access token is reachable from JavaScript. Mitigated by rotating refresh
  tokens and by there being no other origin the SPA talks to; not eliminated.
- The backend unit test required by the brief has a natural subject — a service
  layer with no React in it.
