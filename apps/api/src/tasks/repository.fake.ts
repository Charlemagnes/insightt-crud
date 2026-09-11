/**
 * **A fake, not a mock.** The distinction is Meszaros' (*xUnit Test Patterns*)
 * and it is the reason for the filename: a mock records the calls made to it so
 * a test can assert on them, where a fake is a real working implementation that
 * takes a shortcut — here, an array instead of Postgres. Everything below
 * genuinely enforces Owner scoping, ordering, paging, the Version guard and the
 * Transition rules, because those are the behaviours the tests are checking.
 *
 * The sibling is named the same way: `repository.drizzle.ts` and
 * `repository.fake.ts` both implement the interface in `repository.ts`, and
 * neither is ever imported above it (CLAUDE.md). `.drizzle` names the mechanism
 * because that is the only thing interesting about it; `.fake` names the role,
 * because "in memory" is the shortcut rather than the point.
 *
 * `.mock.ts` would have been the wrong word twice over — nothing here asserts
 * on interactions, and it would read as the Jest convention, which this is not.
 */

import { canTransition, type Task, type TaskStatus } from "@insightt/shared";

import { randomUUID } from "node:crypto";

import {
  SHOWN_ONLY_WHEN_ASKED_FOR,
  type MarkDoneResult,
  type OwnerScopedListQuery,
  type OwnerScopedTaskDraft,
  type OwnerScopedTaskEdit,
  type OwnerScopedTaskQuery,
  type TaskListResult,
  type TaskRepository,
  type TransitionResult,
  type UpdateResult,
} from "@/tasks/repository";

/** A Task as it is stored: the wire shape, plus the Owner the wire never sees. */
export interface OwnedTask extends Task {
  ownerId: string;
}

/**
 * Drops the Owner, the way `toTask` does when it maps a database row. Without
 * it the fake would hand routes a field the real repository never returns, and
 * a test could pass on a response shape production cannot produce.
 *
 * Exported because the test harness needs the same answer to the same question:
 * given this stored Task, what should the API return for it?
 */
export function withoutOwner({ ownerId: _ownerId, ...task }: OwnedTask): Task {
  return task;
}

/**
 * The repository the whole HTTP test suite runs against. It exists so a test
 * can drive the real middleware stack — real CORS, real logging, real auth
 * boundary, real error mapping — with no database behind it (PLAN.md §3).
 *
 * A fake that answered whatever it was told would prove the route calls a
 * repository and nothing more, which is why the methods below are written out
 * rather than stubbed.
 *
 * What it cannot check is that the *Drizzle* repository agrees with it. Nothing
 * here proves the SQL filters on `owner_id`; that is what the seed script and
 * running the app are for.
 */
export function createFakeTaskRepository(
  seed: OwnedTask[] = [],
): TaskRepository & { tasks: OwnedTask[] } {
  const tasks = [...seed];

  return {
    tasks,

    async list({
      userId,
      page,
      pageSize,
      status,
    }: OwnerScopedListQuery): Promise<TaskListResult> {
      const owned = tasks
        .filter((task) => task.ownerId === userId)
        // The same two-armed predicate the SQL uses: a Status asked for is
        // matched exactly, and no Status leaves Archived out rather than
        // filtering on nothing.
        .filter((task) =>
          status === undefined
            ? task.status !== SHOWN_ONLY_WHEN_ASKED_FOR
            : task.status === status,
        )
        // Newest first, with `id` breaking a tie exactly as the SQL does. A
        // fake that ordered differently would let a paging bug pass here and
        // fail in production.
        .sort(
          (a, b) =>
            b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
        );

      const from = (page - 1) * pageSize;

      return {
        items: owned.slice(from, from + pageSize).map(withoutOwner),
        total: owned.length,
      };
    },

    async findById(query: OwnerScopedTaskQuery): Promise<Task | null> {
      const found = owned(tasks, query);

      return found ? withoutOwner(found) : null;
    },

    async create({
      userId,
      title,
      description,
    }: OwnerScopedTaskDraft): Promise<Task> {
      const now = new Date().toISOString();

      const created: OwnedTask = {
        id: randomUUID(),
        ownerId: userId,
        title,
        description,
        // The column default, spelled out. A fake that started a Task anywhere
        // else would let a route that honoured a caller's Status pass here.
        status: "PENDING",
        version: 1,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
      };

      tasks.push(created);

      return withoutOwner(created);
    },

    async update({
      expectedVersion,
      changes,
      ...query
    }: OwnerScopedTaskEdit): Promise<UpdateResult> {
      const task = owned(tasks, query);

      if (!task) return { outcome: "not_found" };

      // The Version guard the SQL puts in its `WHERE`, asked here instead.
      // Without it the fake would accept a write the database refuses, and the
      // whole optimistic-locking suite would pass against nothing.
      if (task.version !== expectedVersion) {
        return { outcome: "stale", task: withoutOwner(task) };
      }

      // Only the keys the edit named. `Object.assign` with an absent key
      // changes nothing, which is exactly what an unnamed field should get —
      // spelling the fields out here would make an omitted one `undefined`.
      Object.assign(task, changes);
      task.version += 1;
      task.updatedAt = new Date().toISOString();

      return { outcome: "changed", task: withoutOwner(task) };
    },

    async delete(query: OwnerScopedTaskQuery): Promise<boolean> {
      const task = owned(tasks, query);

      if (!task) return false;

      // Out of the array, not flagged: the real repository issues a `DELETE`,
      // and a fake that hid the Task instead would let a list which forgot to
      // filter on the flag pass here and leak the row in production.
      tasks.splice(tasks.indexOf(task), 1);

      return true;
    },

    async start(query: OwnerScopedTaskQuery): Promise<TransitionResult> {
      return transition(tasks, query, "IN_PROGRESS");
    },

    async archive(query: OwnerScopedTaskQuery): Promise<TransitionResult> {
      // Nothing is cleared and nothing is removed: the Task keeps its
      // completion time and stays in the array. What changes is that `list`
      // above no longer selects it unless Archived is the Status asked for.
      return transition(tasks, query, "ARCHIVED");
    },

    async markDone(query: OwnerScopedTaskQuery): Promise<MarkDoneResult> {
      const task = owned(tasks, query);

      if (!task) return { outcome: "not_found" };

      // Already DONE is a Replay: a success, and the original completion time
      // survives it. This is the branch `mark_task_done()` reaches by reading
      // the row inside the transaction that failed to update it.
      if (task.status === "DONE") {
        return { outcome: "replayed", task: withoutOwner(task) };
      }

      if (!canTransition(task.status, "DONE")) {
        return { outcome: "wrong_status", task: withoutOwner(task) };
      }

      task.status = "DONE";
      task.version += 1;
      task.completedAt = new Date().toISOString();
      task.updatedAt = task.completedAt;

      return { outcome: "completed", task: withoutOwner(task) };
    },
  };
}

/**
 * A guarded Transition, the way the Drizzle repository's one `UPDATE` is: the
 * Task has to exist, be the Actor's, and be somewhere the move is legal.
 *
 * Written once for both Transitions that use it, because a second copy is a
 * second place `version` could stop being raised — and a Version that did not
 * move would leave a stale `If-Match` matching.
 */
function transition(
  tasks: OwnedTask[],
  query: OwnerScopedTaskQuery,
  to: TaskStatus,
): TransitionResult {
  const task = owned(tasks, query);

  if (!task) return { outcome: "not_found" };

  // The same rule the SQL guard is built from, asked the other way round:
  // there is a Task in hand here, so the question is whether it may move.
  if (!canTransition(task.status, to)) {
    return { outcome: "wrong_status", task: withoutOwner(task) };
  }

  task.status = to;
  task.version += 1;
  task.updatedAt = new Date().toISOString();

  return { outcome: "changed", task: withoutOwner(task) };
}

/**
 * The stored Task itself, not a copy — the transitions above mutate what they
 * find. Owner-scoped like every other read, so a Task belonging to someone
 * else is simply absent.
 */
function owned(
  tasks: OwnedTask[],
  { userId, id }: OwnerScopedTaskQuery,
): OwnedTask | undefined {
  return tasks.find((task) => task.id === id && task.ownerId === userId);
}
