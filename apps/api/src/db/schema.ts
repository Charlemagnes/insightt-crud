import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * The Status enum, as a Postgres type rather than a `text` column with a check
 * constraint. The database refuses a value outside the lifecycle even when the
 * write comes from psql, and the four values are discoverable from the schema
 * rather than from application code.
 *
 * These are the same four values `TaskStatus` carries in `@insightt/shared`.
 * They are deliberately written twice, once per language, and the drift test in
 * `schema.test.ts` holds the two spellings together.
 */
export const taskStatus = pgEnum("task_status", [
  "PENDING",
  "IN_PROGRESS",
  "DONE",
  "ARCHIVED",
]);

/**
 * The `tasks` table — snake_case columns, DB nullability, and nothing the wire
 * knows about. `apps/api/src/tasks/mappers.ts` is the seam between this row and
 * the camelCase `Task` in `@insightt/shared`; the shared schemas are not
 * derived from this table, and this table is not derived from them (PLAN.md
 * §11).
 *
 * Row-level security stays **off**. Authorization is enforced in the API layer,
 * which leaves `mark_task_done()` free to run as a plain function without a
 * policy to satisfy (PLAN.md §2).
 */
export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The Owner's User ID — the Auth0 `sub` claim, stored verbatim. */
    ownerId: text("owner_id").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    status: taskStatus("status").notNull().default("PENDING"),
    /** Raised on every change; travels the wire as an `ETag`. */
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /**
     * Maintained by the `tasks_set_updated_at` trigger, never by application
     * code. Without the trigger this would read as the creation time forever,
     * because nothing above the database ever assigns it.
     */
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** When the Task reached `DONE`. A Replay never overwrites it. */
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    // Every read is Owner-scoped and the list filters by Status, so the index
    // covers both columns in that order: `owner_id` alone still uses it.
    index("tasks_owner_status_idx").on(table.ownerId, table.status),
  ],
);

/** The shape a `select` returns. Internal to `apps/api` — see `mappers.ts`. */
export type TaskRow = typeof tasks.$inferSelect;
/** The shape an `insert` takes. Internal to `apps/api`. */
export type NewTaskRow = typeof tasks.$inferInsert;
