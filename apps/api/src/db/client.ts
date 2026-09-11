import { readFileSync } from "node:fs";

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "@/db/schema";

/** The database handle the Drizzle-backed repository is built around. */
export type Database = NodePgDatabase<typeof schema>;

/**
 * How the connection is encrypted.
 *
 * Supabase's pooler presents a self-signed chain, so Node rejects it outright
 * unless it is told which root to trust. Without a CA the connection is still
 * encrypted but **not authenticated** — enough for a local development target,
 * not enough for anything reachable from outside it.
 *
 * Point `DATABASE_CA_CERT` at Supabase's certificate (dashboard → Settings →
 * Database → SSL configuration) to turn verification on. The two branches are
 * spelled out rather than left to `rejectUnauthorized: false` alone so that the
 * weaker one is a visible choice, not a default nobody revisits.
 */
function tlsOptions(caCertPath: string | undefined) {
  if (!caCertPath) return { rejectUnauthorized: false };

  return {
    ca: readFileSync(caCertPath, "utf8"),
    rejectUnauthorized: true,
  };
}

/**
 * Opens the pool and wraps it in Drizzle.
 *
 * `databaseUrl` is a **Supavisor session-mode** connection string. Session mode
 * rather than transaction mode because transaction mode does not support
 * prepared statements, which `node-postgres` and Drizzle both rely on; the
 * pooler rather than a direct connection because Supabase's direct host is
 * IPv6-first and a good many networks cannot reach it (PLAN.md §4).
 */
export function createDatabase(
  databaseUrl: string,
  caCertPath?: string,
): { db: Database; pool: Pool } {
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: tlsOptions(caCertPath),
  });

  return { db: drizzle(pool, { schema }), pool };
}
