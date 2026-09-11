import type { Task } from "@insightt/shared";

import type {
  OwnerScopedListQuery,
  OwnerScopedTaskQuery,
  TaskListResult,
  TaskRepository,
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
 * The in-memory fake, and the repository the whole HTTP test suite runs
 * against. It exists so a test can drive the real middleware stack — real CORS,
 * real logging, real auth boundary, real error mapping — with no database
 * behind it (PLAN.md §3).
 *
 * It reimplements Owner scoping, ordering and paging rather than stubbing them,
 * because those are the behaviours the tests are checking. A fake that answered
 * whatever it was told would prove the route calls a repository and nothing
 * more.
 *
 * What it cannot check is that the *Drizzle* repository agrees with it. Nothing
 * here proves the SQL filters on `owner_id`; that is what the seed script and
 * running the app are for.
 */
export function createMemoryTaskRepository(
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
        .filter((task) => status === undefined || task.status === status)
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

    async findById({ userId, id }: OwnerScopedTaskQuery): Promise<Task | null> {
      const found = tasks.find(
        (task) => task.id === id && task.ownerId === userId,
      );
      return found ? withoutOwner(found) : null;
    },
  };
}
