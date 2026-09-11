import type { Task } from "@insightt/shared";

import type { TaskRow } from "@/db/schema";

/**
 * The seam between the two type layers (PLAN.md §11).
 *
 * Drizzle types describe a database row: snake_case columns, `Date` objects,
 * `owner_id`. Zod types describe the wire contract: camelCase, ISO strings, and
 * no Owner at all. They are near-identical today and will not stay that way —
 * the row is free to grow a column the API does not publish, and the contract
 * is free to rename a field without a migration.
 *
 * Collapsing the two, by deriving the shared schemas from the table with
 * `drizzle-zod`, would invert the direction: the public API shape would become
 * a projection of whatever the table happens to look like, and
 * `packages/shared` would have to import the database schema to say what a Task
 * is — dragging the data layer into the frontend's import graph.
 *
 * `ownerId` is dropped rather than renamed. The API only ever returns the
 * Actor's own Tasks, so publishing the Owner would tell the caller something it
 * already knows, in a field a later endpoint might be tempted to let it write.
 *
 * This function is the only place that knows both shapes.
 */
export function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    version: row.version,
    // ISO strings rather than `Date`, so a JSON round trip loses nothing and
    // the same schema parses on both sides of the wire.
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}
