import "dotenv/config";

import { migrate } from "drizzle-orm/node-postgres/migrator";

import { createDatabase } from "@/db/client";
import { loadEnv } from "@/env";

/**
 * Applies everything in `drizzle/` that has not run yet, generated and
 * hand-written alike, in journal order.
 *
 * `drizzle-kit migrate` would do the same, but this runs through the same
 * `createDatabase` the server uses — so the pooler and TLS settings are
 * configured in one place, and a migration cannot succeed against a connection
 * the app would fail on.
 */
async function main(): Promise<void> {
  const env = loadEnv();
  const { db, pool } = createDatabase(env.databaseUrl);

  try {
    await migrate(db, { migrationsFolder: `${__dirname}/../../drizzle` });
    console.log("Migrations applied.");
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
