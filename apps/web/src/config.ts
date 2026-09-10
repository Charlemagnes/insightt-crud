/**
 * The browser-visible configuration, read once and validated loudly. Next
 * inlines `process.env.NEXT_PUBLIC_*` at build time only where it is spelled
 * out literally, so each one is written in full below rather than looked up
 * through a variable.
 *
 * A missing value fails the build rather than surfacing later as an Auth0
 * redirect to `https://undefined/authorize`.
 */
function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing ${name}. Copy apps/web/.env.example to apps/web/.env.local and run scripts/setup-auth0.sh.`,
    );
  }
  return value;
}

export const config = {
  auth0Domain: required(
    "NEXT_PUBLIC_AUTH0_DOMAIN",
    process.env.NEXT_PUBLIC_AUTH0_DOMAIN,
  ),
  auth0ClientId: required(
    "NEXT_PUBLIC_AUTH0_CLIENT_ID",
    process.env.NEXT_PUBLIC_AUTH0_CLIENT_ID,
  ),
  /** The API identifier. Without it Auth0 issues an opaque token the API cannot verify. */
  auth0Audience: required(
    "NEXT_PUBLIC_AUTH0_AUDIENCE",
    process.env.NEXT_PUBLIC_AUTH0_AUDIENCE,
  ),
  apiUrl: required("NEXT_PUBLIC_API_URL", process.env.NEXT_PUBLIC_API_URL),
} as const;
