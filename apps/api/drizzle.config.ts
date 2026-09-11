import "dotenv/config";

import { defineConfig } from "drizzle-kit";

/**
 * `drizzle-kit` generates a migration by diffing `db/schema.ts` against the
 * migrations already in `drizzle/`. Two things it cannot see live in
 * `drizzle/0001_task_triggers.sql`, written by hand: the `set_updated_at()`
 * trigger, and later the `mark_task_done()` function. Generated migrations and
 * hand-written ones sit in the same folder and run in the same order.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
    // Supabase terminates TLS with a certificate this client has no root for;
    // the same trade the runtime pool makes in `src/db/client.ts`.
    ssl: { rejectUnauthorized: false },
  },
  strict: true,
  verbose: true,
});
