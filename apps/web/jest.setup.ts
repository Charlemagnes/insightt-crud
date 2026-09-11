/**
 * `config.ts` reads `NEXT_PUBLIC_*` at module load and throws on a missing one
 * — deliberately, so a misconfigured build fails loudly rather than redirecting
 * to `https://undefined/authorize`. Anything a test imports pulls that in
 * transitively, so the values are supplied here rather than from `.env.local`:
 * the suite must not depend on a developer's real tenant, and it must run in CI
 * where there is none.
 *
 * They are obvious placeholders on purpose. Nothing under test reaches Auth0,
 * and a value that looked real would invite someone to believe it was.
 */
process.env.NEXT_PUBLIC_AUTH0_DOMAIN = "test.auth0.local";
process.env.NEXT_PUBLIC_AUTH0_CLIENT_ID = "test-client-id";
process.env.NEXT_PUBLIC_AUTH0_AUDIENCE = "https://test.api.local";
process.env.NEXT_PUBLIC_API_URL = "http://api.test.local";
