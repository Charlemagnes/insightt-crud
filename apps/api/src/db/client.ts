import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "@/db/schema";

/** The database handle the Drizzle-backed repository is built around. */
export type Database = NodePgDatabase<typeof schema>;

/**
 * Opens the pool and wraps it in Drizzle.
 *
 * `databaseUrl` is a **Supavisor session-mode** connection string. Session mode
 * rather than transaction mode because transaction mode does not support
 * prepared statements, which `node-postgres` and Drizzle both rely on; the
 * pooler rather than a direct connection because Supabase's direct host is
 * IPv6-first and a good many networks cannot reach it (PLAN.md §4).
 */
export function createDatabase(databaseUrl: string): {
  db: Database;
  pool: Pool;
} {
  const pool = new Pool({
    connectionString: databaseUrl,
    // Supabase terminates TLS with a certificate this client has no root for.
    // The connection is still encrypted; what is skipped is verifying the
    // hostname against the chain.
    ssl: { rejectUnauthorized: false },
  });

  return { db: drizzle(pool, { schema }), pool };
}
