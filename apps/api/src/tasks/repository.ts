import type { Task, TaskStatus } from "@insightt/shared";

/**
 * What a list read needs to know. Every read is scoped to one Owner, which is
 * why the Actor's `userId` sits inside the query rather than beside it — there
 * is no way to spell a read that forgets it.
 *
 * Deliberately not called `TaskListQuery`: PLAN.md §11 reserves that name for
 * the shared Zod schema of the query *string*, which carries no `userId` — a
 * caller never gets to choose whose Tasks it reads.
 */
export interface OwnerScopedListQuery {
  userId: string;
  page: number;
  pageSize: number;
  /** Absent means every Status, Archived included. */
  status?: TaskStatus;
}

/** Addresses one Task, and says who is asking. */
export interface OwnerScopedTaskQuery {
  userId: string;
  id: string;
}

/** One page of Tasks, plus the count the pager needs to size itself. */
export interface TaskListResult {
  items: Task[];
  total: number;
}

/**
 * The Task repository. `apps/api` never imports a concrete implementation above
 * this line, so nothing that reads Tasks knows Drizzle exists — which is what
 * lets the whole HTTP test suite run against `createMemoryTaskRepository`.
 *
 * It returns wire-shaped `Task` values, not database rows: the snake_case row
 * stops at `mappers.ts`, one layer below (PLAN.md §11).
 *
 * Owner scoping is a property of the interface, not of its callers. Both
 * methods take a `userId` and neither offers a way to omit it, so a read that
 * crosses Owners cannot be written by accident — the compiler asks for the
 * Actor before it will accept the call.
 */
export interface TaskRepository {
  /** One page of the Owner's Tasks, newest first, with the total count. */
  list(query: OwnerScopedListQuery): Promise<TaskListResult>;

  /**
   * One Task, or `null` when there is no such Task **or** it belongs to someone
   * else. The two cases are deliberately indistinguishable: the route turns
   * either into `404`, so a `403` never confirms that someone else's Task
   * exists.
   */
  findById(query: OwnerScopedTaskQuery): Promise<Task | null>;
}
