import { z } from "zod";

/**
 * The API's configuration, read from the process environment exactly once at
 * the composition root and passed down as a value. Nothing below `index.ts`
 * reads `process.env`, so every collaborator can be built with a literal in a
 * test.
 *
 * Only variables the API actually uses are declared. `DATABASE_URL` joins them
 * when the Postgres-backed repository lands.
 */
const EnvSchema = z.object({
  AUTH0_DOMAIN: z.string().min(1, "AUTH0_DOMAIN is required"),
  AUTH0_AUDIENCE: z.string().min(1, "AUTH0_AUDIENCE is required"),
  PORT: z.coerce.number().int().positive().default(4000),
  // The protocol constraint is not decoration: `new URL()` happily parses
  // "localhost:3000" as a URL whose scheme is `localhost:`, and CORS would then
  // be configured against an origin no browser will ever send.
  WEB_ORIGIN: z
    .url({ protocol: /^https?$/, error: "WEB_ORIGIN must be an http(s) URL" })
    .default("http://localhost:3000"),
});

export interface Env {
  /** Where the tenant's JWKS is discovered. Auth0 issuers carry a trailing slash. */
  auth0IssuerBaseUrl: string;
  /** The API identifier registered in Auth0; every access token must name it. */
  auth0Audience: string;
  port: number;
  /** The single browser origin CORS admits. */
  webOrigin: string;
}

/**
 * Validates the environment and throws with every problem at once — a missing
 * variable should not be discovered one restart at a time.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);

  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid API environment:\n${problems}`);
  }

  const { AUTH0_DOMAIN, AUTH0_AUDIENCE, PORT, WEB_ORIGIN } = parsed.data;

  return {
    auth0IssuerBaseUrl: `https://${AUTH0_DOMAIN.replace(/\/+$/, "")}/`,
    auth0Audience: AUTH0_AUDIENCE,
    port: PORT,
    webOrigin: WEB_ORIGIN,
  };
}
