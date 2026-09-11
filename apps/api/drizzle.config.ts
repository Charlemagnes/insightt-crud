import "dotenv/config";

import { defineConfig } from "drizzle-kit";

/**
 * `drizzle-kit` generates a migration by diffing `db/schema.ts` against the
 * migrations already in `drizzle/`. It diffs tables, not triggers or functions,
 * so those arrive by hand — `generate --custom` writes the empty file and the
 * journal entry, and the SQL goes in it. `0001_updated_at_trigger.sql` is the
 * first; `mark_task_done()` will be the next. Generated and hand-written
 * migrations sit in the same folder and run in the same order.
 *
 * This config is used only by `drizzle-kit generate`. Applying migrations goes
 * through `src/db/migrate.ts`, so the pool and its TLS settings are configured
 * in one place and a migration cannot succeed on a connection the app would
 * fail on.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  // `generate` never connects — these are here for the drizzle-kit commands
  // that do, such as `studio`. The TLS trade they make is the unverified one
  // `src/db/client.ts` documents, and for the same reason.
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
    ssl: { rejectUnauthorized: false },
  },
  strict: true,
  verbose: true,
});
