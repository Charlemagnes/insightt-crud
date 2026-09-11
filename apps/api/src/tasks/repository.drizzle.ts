import type { Task } from "@insightt/shared";
import { and, count, desc, eq, sql, type SQL } from "drizzle-orm";

import type { Database } from "@/db/client";
import { tasks } from "@/db/schema";
import { toTask } from "@/tasks/mappers";
import type {
  OwnerScopedListQuery,
  OwnerScopedTaskQuery,
  TaskListResult,
  TaskRepository,
} from "@/tasks/repository";

/**
 * The Postgres-backed repository — the only module in `apps/api` that issues
 * SQL against `tasks`. Everything above it holds a `TaskRepository` and cannot
 * tell Drizzle from the in-memory fake.
 */
export function createDrizzleTaskRepository(db: Database): TaskRepository {
  return {
    async list({
      userId,
      page,
      pageSize,
      status,
    }: OwnerScopedListQuery): Promise<TaskListResult> {
      // `and` drops an `undefined`, so no `status` means every Status —
      // Archived included, since it is a Status and not a soft delete.
      const owned: SQL | undefined = and(
        eq(tasks.ownerId, userId),
        status === undefined ? undefined : eq(tasks.status, status),
      );

      // `count(*) over()` rides along on each row, so the page and the total
      // come back in one round trip rather than a second `select count(*)` a
      // concurrent insert could make disagree with it.
      const rows = await db
        .select({
          task: tasks,
          total: sql<number>`count(*) over()`.mapWith(Number),
        })
        .from(tasks)
        .where(owned)
        // `id` breaks the tie, without which paging is not stable — PLAN.md §6.
        .orderBy(desc(tasks.createdAt), desc(tasks.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      return {
        items: rows.map((row) => toTask(row.task)),
        // No rows means no row to read the count off — see `countOwned`.
        total: rows[0]?.total ?? (await countOwned(db, owned)),
      };
    },

    async findById({ userId, id }: OwnerScopedTaskQuery): Promise<Task | null> {
      const [row] = await db
        .select()
        .from(tasks)
        // Owner and id in one predicate: a Task belonging to someone else does
        // not match, so it comes back missing rather than forbidden, and the
        // Actor learns nothing about whether it exists.
        .where(and(eq(tasks.id, id), eq(tasks.ownerId, userId)))
        .limit(1);

      return row ? toTask(row) : null;
    },
  };
}

/**
 * The total for a page that came back empty. A window function has no row to
 * report a count on, and an empty page is not proof of an empty table — it is
 * what page 5 of a two-page list looks like. Reporting `0` there would collapse
 * the pager onto page 1 and hide the Tasks that are really present, so the
 * empty page pays for a second round trip and no other page does.
 */
async function countOwned(
  db: Database,
  owned: SQL | undefined,
): Promise<number> {
  const [row] = await db.select({ total: count() }).from(tasks).where(owned);
  return row?.total ?? 0;
}
