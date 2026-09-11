import type { Task, TaskStatus } from "@insightt/shared";

/**
 * What a list read needs to know. Every read is scoped to one Owner, which is
 * why the Actor's `userId` sits inside the query rather than beside it — there
 * is no way to spell a read that forgets it.
 *
 * Deliberately not called `TaskListQuery`: PLAN.md §11 reserves that name for
 * the shared Zod schema of the query *string*, which carries no `userId` — a
 * request never gets to choose whose Tasks it reads.
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

/**
 * A Task to create, and the Owner it will belong to.
 *
 * There is no `status` and no `version`: both are the database's to decide, and
 * a caller that could name either would be able to create a Task that had
 * already skipped part of its lifecycle.
 *
 * `description` is `string | null` rather than optional, so "no description" is
 * spelled one way by the time it reaches storage. The shared schema has already
 * turned a blank one into `null`.
 */
export interface OwnerScopedTaskDraft {
  userId: string;
  title: string;
  description: string | null;
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
 * Owner scoping is a property of the interface, not of its call sites. Both
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

  /**
   * Stores a new Task under the Actor and returns it as the wire sees it.
   *
   * The new Task is `PENDING`, always. The draft has no way to say otherwise,
   * and the column defaults to it, so neither a caller nor a careless insert
   * can produce a Task that starts anywhere else.
   */
  create(draft: OwnerScopedTaskDraft): Promise<Task>;
}
