import { z } from "zod";

/**
 * The API's configuration, read from the process environment exactly once at
 * the composition root and passed down as a value. Nothing below `index.ts`
 * reads `process.env`, so every collaborator can be built with a literal in a
 * test.
 */
const EnvSchema = z.object({
  // A Supavisor **session-mode** connection string, not the direct host:
  // transaction mode does not support prepared statements, and the direct host
  // is IPv6-first (PLAN.md §4).
  //
  // The port is checked rather than described, because transaction mode fails
  // late and obscurely — the pool connects, the first few queries work, and
  // then a prepared statement errors somewhere that looks like a Drizzle bug.
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required")
    .refine((url) => !url.includes(":6543/"), {
      error:
        "DATABASE_URL is the transaction-mode pooler (:6543), which does not " +
        "support prepared statements. Use the session pooler on :5432.",
    }),
  /**
   * Supabase's CA certificate. Absent, the connection is encrypted but its
   * certificate is not verified — see `db/client.ts`.
   */
  DATABASE_CA_CERT: z.string().min(1).optional(),
  AUTH0_DOMAIN: z.string().min(1, "AUTH0_DOMAIN is required"),
  AUTH0_AUDIENCE: z.string().min(1, "AUTH0_AUDIENCE is required"),
  PORT: z.coerce.number().int().positive().default(4000),
  // The protocol constraint is not decoration: `new URL()` happily parses
  // "localhost:3000" as a URL whose scheme is `localhost:`, and CORS would then
  // be configured against an origin no browser will ever send.
  WEB_ORIGIN: z
    .url({ protocol: /^https?$/, error: "WEB_ORIGIN must be an http(s) URL" })
    .default("http://localhost:3000"),
  // An enum rather than a free string so an unrecognised value fails loudly.
  // Read the other way round — anything that is not `production` is
  // development — a typo would silently turn off the one thing that reads it.
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  /**
   * How the console renders each log record — not what is recorded, which is
   * the same either way. `json` is the structured line PLAN.md §9 specifies;
   * `pretty` is one readable line per request, for a human watching `npm run
   * dev`. Unset follows `NODE_ENV`, so the default is right without being set.
   */
  LOG_FORMAT: z.enum(["pretty", "json"]).optional(),
});

export interface Env {
  /** Supabase Postgres over the pooler in session mode. */
  databaseUrl: string;
  /** Where Supabase's CA lives, when TLS verification is turned on. */
  databaseCaCertPath?: string;
  /** Where the tenant's JWKS is discovered. Auth0 issuers carry a trailing slash. */
  auth0IssuerBaseUrl: string;
  /** The API identifier registered in Auth0; every access token must name it. */
  auth0Audience: string;
  port: number;
  /** The single browser origin CORS admits. */
  webOrigin: string;
  /**
   * Whether to serve the generated API description at `/api/docs`. True
   * everywhere but production; `docs/router.ts` explains why that is the split.
   */
  serveDocs: boolean;
  /**
   * Which console sink `index.ts` builds. Presentation only: both render the
   * same records, so nothing is logged in one and missing from the other.
   */
  logFormat: "pretty" | "json";
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

  const {
    DATABASE_URL,
    DATABASE_CA_CERT,
    AUTH0_DOMAIN,
    AUTH0_AUDIENCE,
    PORT,
    WEB_ORIGIN,
    NODE_ENV,
    LOG_FORMAT,
  } = parsed.data;

  return {
    databaseUrl: DATABASE_URL,
    databaseCaCertPath: DATABASE_CA_CERT,
    auth0IssuerBaseUrl: `https://${AUTH0_DOMAIN.replace(/\/+$/, "")}/`,
    auth0Audience: AUTH0_AUDIENCE,
    port: PORT,
    webOrigin: WEB_ORIGIN,
    serveDocs: NODE_ENV !== "production",
    // A log shipper parses production's output; a person reads development's.
    logFormat: LOG_FORMAT ?? (NODE_ENV === "production" ? "json" : "pretty"),
  };
}
