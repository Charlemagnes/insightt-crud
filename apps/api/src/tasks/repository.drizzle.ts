import { statusBefore, TaskStatus, type Task } from "@insightt/shared";
import { and, count, desc, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@/db/client";
import { tasks, type TaskRow } from "@/db/schema";
import { toTask } from "@/tasks/mappers";
import type {
  MarkDoneResult,
  OwnerScopedListQuery,
  OwnerScopedTaskDraft,
  OwnerScopedTaskEdit,
  OwnerScopedTaskQuery,
  TaskListResult,
  TaskRepository,
  TransitionResult,
  UpdateResult,
} from "@/tasks/repository";

/**
 * The Status a Task must already be in for each guarded Transition, read off
 * the shared machine rather than written here. The SQL guard and the button
 * the UI enables then come from one definition, so neither can offer what the
 * other refuses.
 *
 * `statusBefore` answers `null` for the Status every Task starts in, which
 * neither of these is. Resolving them once at load means a mistake here is a
 * crash on boot rather than a Transition that quietly never matches.
 */
const STARTS_FROM = requireStatusBefore("IN_PROGRESS");
const ARCHIVES_FROM = requireStatusBefore("ARCHIVED");

function requireStatusBefore(to: TaskStatus): TaskStatus {
  const from = statusBefore(to);

  if (!from) {
    throw new Error(`Nothing transitions into ${to}; it is where a Task starts`);
  }

  return from;
}

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

    async findById(query: OwnerScopedTaskQuery): Promise<Task | null> {
      const row = await selectOwned(db, query);

      return row ? toTask(row) : null;
    },

    async create({
      userId,
      title,
      description,
    }: OwnerScopedTaskDraft): Promise<Task> {
      // `status` and `version` are left to the column defaults rather than
      // written here. Naming them would be a second place the starting Status
      // is decided, and the one in the database is the one that holds even when
      // the write does not come from this process.
      const [row] = await db
        .insert(tasks)
        .values({ ownerId: userId, title, description })
        .returning();

      // `insert ... returning` on a single row either returns it or throws;
      // there is no third outcome. Asserting it here keeps the impossible case
      // from becoming a `Task | undefined` every caller has to answer for.
      if (!row) {
        throw new Error("Insert returned no row");
      }

      return toTask(row);
    },

    async update({
      userId,
      id,
      expectedVersion,
      changes,
    }: OwnerScopedTaskEdit): Promise<UpdateResult> {
      // The Version is in the `WHERE`, which is what makes this optimistic
      // locking rather than a read followed by a hopeful write: two Actors
      // holding the same Version both run this, and the second matches no row.
      const [row] = await db
        .update(tasks)
        // Spread rather than named: a field the edit did not name is not a key
        // here, so `set` leaves that column alone. `updated_at` is the
        // trigger's, and `version` is raised so the `If-Match` the caller is
        // still holding stops matching.
        .set({ ...changes, version: sql`${tasks.version} + 1` })
        .where(
          and(
            eq(tasks.id, id),
            eq(tasks.ownerId, userId),
            eq(tasks.version, expectedVersion),
          ),
        )
        .returning();

      if (row) {
        return { outcome: "changed", task: toTask(row) };
      }

      // Nothing matched, and the caller needs to know whether that is a `404`
      // or a `412` — the same second read `transition` does, for the same
      // reason and with the same caveat: either answer is a refusal, and the
      // edit did not happen.
      const current = await selectOwned(db, { userId, id });

      return current
        ? { outcome: "stale", task: toTask(current) }
        : { outcome: "not_found" };
    },

    async start(query: OwnerScopedTaskQuery): Promise<TransitionResult> {
      return transition(db, query, "IN_PROGRESS", STARTS_FROM);
    },

    async archive(query: OwnerScopedTaskQuery): Promise<TransitionResult> {
      // The same guarded `UPDATE` as Start, and nothing else: no delete, no
      // flag, no column cleared. `completed_at` is not touched, so an Archived
      // Task still says when it was finished (CONTEXT.md, "Archived").
      return transition(db, query, "ARCHIVED", ARCHIVES_FROM);
    },

    async markDone({ userId, id }: OwnerScopedTaskQuery): Promise<MarkDoneResult> {
      // The whole decision happens in the function, in one transaction: the
      // conditional UPDATE, and the read that explains a zero-row result. See
      // `drizzle/0002_mark_task_done.sql` and ADR-0002.
      const result = await db.execute(
        sql`select * from mark_task_done(${id}, ${userId})`,
      );

      // `db.execute` returns whatever Postgres sent, typed as loosely as that
      // implies, so the contract is re-established here rather than asserted.
      const row = MarkTaskDoneRow.parse(result.rows[0]);


      return row.outcome === "not_found"
        ? { outcome: "not_found" }
        : { outcome: row.outcome, task: toTask(asTaskRow(row)) };
    },
  };
}

/**
 * A Transition as one guarded `UPDATE`, which is every Transition except Mark
 * Done (PLAN.md §8).
 *
 * `from` is passed in already resolved rather than looked up here, so a
 * Transition whose source Status does not exist fails at module load instead
 * of at the first request — and the guard is still the machine's answer, never
 * a Status this file spells.
 */
async function transition(
  db: Database,
  query: OwnerScopedTaskQuery,
  to: TaskStatus,
  from: TaskStatus,
): Promise<TransitionResult> {
  const { userId, id } = query;

  // One guarded statement, so the Transition is atomic without a lock the
  // application holds: two callers racing to move the same Task both run this,
  // and only one of them matches a row.
  const [row] = await db
    .update(tasks)
    .set({ status: to, version: sql`${tasks.version} + 1` })
    .where(
      and(eq(tasks.id, id), eq(tasks.ownerId, userId), eq(tasks.status, from)),
    )
    .returning();

  if (row) {
    return { outcome: "changed", task: toTask(row) };
  }

  // Nothing matched, and the caller needs to know whether that is a `404` or a
  // `409`. This read is a second statement, so a Task changing in between could
  // swap one refusal for the other — which is a refusal either way, and the
  // Transition still did not happen. Mark Done cannot accept that much, because
  // there the two answers are a success and a rejection; that is why it is a
  // function and this is not (PLAN.md §8).
  const current = await selectOwned(db, query);

  return current
    ? { outcome: "wrong_status", task: toTask(current) }
    : { outcome: "not_found" };
}

/**
 * One Task, by id and Owner together. A Task belonging to someone else does
 * not match, so it comes back missing rather than forbidden, and the Actor
 * learns nothing about whether it exists.
 */
async function selectOwned(
  db: Database,
  { userId, id }: OwnerScopedTaskQuery,
): Promise<TaskRow | undefined> {
  const [row] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, id), eq(tasks.ownerId, userId)))
    .limit(1);

  return row;
}

/**
 * A `timestamptz` as it arrives from a raw statement.
 *
 * Drizzle replaces `node-postgres`'s own parser for the timestamp types with
 * one that hands back Postgres's text form, so it can do the conversion in its
 * column mappers instead. A `db.execute` has no column mapper, so the text
 * arrives here — and `new Date(...)` on it is exactly what Drizzle's own
 * mapper would have done with it.
 */
const timestamp = z.coerce.date();

/**
 * The `tasks` columns as `mark_task_done()` returns them: the table's own
 * snake_case names, because a raw `db.execute` has no Drizzle select to rename
 * them and no typed row to hand back.
 */
const TaskColumns = z.object({
  id: z.uuid(),
  owner_id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  status: TaskStatus,
  version: z.number().int(),
  created_at: timestamp,
  updated_at: timestamp,
  // `nullable` outside the coercion, so an absent completion stays absent
  // rather than being coerced into the epoch.
  completed_at: timestamp.nullable(),
});

/**
 * The names `mark_task_done()` reports its outcomes under, written once here.
 * The migration spells them again in SQL, and `db/mark-task-done.test.ts`
 * reads this list to hold the two together. TypeScript holds the third
 * spelling — `MarkDoneResult` — to it, because `markDone` below returns one
 * and is built from the other.
 */
export const MarkDoneOutcome = z.enum([
  "completed",
  "replayed",
  "wrong_status",
  "not_found",
]);

/**
 * The function's row, as a schema. Parsing rather than casting is what makes
 * the SQL and this file one contract: rename an outcome in the migration and
 * every Mark Done fails loudly here, instead of falling through to whichever
 * branch happens to be last.
 *
 * Only `not_found` comes back without a Task, and the union says so, so
 * nothing downstream has to check for a Task the outcome already promised.
 */
const MarkTaskDoneRow = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("not_found") }),
  z.object({
    outcome: MarkDoneOutcome.exclude(["not_found"]),
    ...TaskColumns.shape,
  }),
]);

/**
 * The same columns under the names Drizzle's own rows use. This crosses no
 * layer — both spellings are the database's — it only puts the row into the
 * shape `mappers.ts` takes, which stays the single seam to the wire contract.
 */
function asTaskRow(columns: z.infer<typeof TaskColumns>): TaskRow {
  return {
    id: columns.id,
    ownerId: columns.owner_id,
    title: columns.title,
    description: columns.description,
    status: columns.status,
    version: columns.version,
    createdAt: columns.created_at,
    updatedAt: columns.updated_at,
    completedAt: columns.completed_at,
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
