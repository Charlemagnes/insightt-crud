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
 * What a guarded Transition did, as a discriminated outcome rather than a Task
 * that may or may not have changed.
 *
 * The distinction the union is here to preserve is `wrong_status` against
 * `not_found`: they are `409` and `404`, and a repository that returned
 * `Task | null` would have thrown the difference away before the route could
 * report it.
 */
export type TransitionResult =
  | { outcome: "changed"; task: Task }
  | { outcome: "wrong_status"; task: Task }
  | { outcome: "not_found" };

/**
 * The names `mark_task_done()` reports its four outcomes under. They are
 * values and not only a type because the migration spells them in SQL as well,
 * and `db/mark-task-done.test.ts` holds the two lists together.
 */
export const MARK_DONE_OUTCOMES = [
  "completed",
  "replayed",
  "wrong_status",
  "not_found",
] as const;

/**
 * What marking a Task Done did. The same three outcomes a Transition has, plus
 * the one that only Mark Done has: a Replay — the Task was already `DONE`,
 * nothing was written, and that is a success (CONTEXT.md, "Replay").
 *
 * `replayed` is deliberately not folded into `completed`. It is the same `200`
 * with the same body, but the route marks it with a header, and collapsing the
 * two here would mean the API could no longer tell a caller whether their
 * request was the one that finished the work.
 */
export type MarkDoneResult =
  | { outcome: "completed"; task: Task }
  | { outcome: "replayed"; task: Task }
  | { outcome: "wrong_status"; task: Task }
  | { outcome: "not_found" };

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

  /**
   * Moves a `PENDING` Task to `IN_PROGRESS`, through one guarded statement.
   *
   * The Status it may be moved from is not a parameter: it is the Status the
   * shared machine names as the one before `IN_PROGRESS`, so a caller cannot
   * ask for a Transition the rules do not allow.
   */
  start(query: OwnerScopedTaskQuery): Promise<TransitionResult>;

  /**
   * Marks a Task `DONE`, atomically and idempotently.
   *
   * Calling it twice is not an error and does not complete the Task twice: the
   * second call comes back `replayed`, with the original completion time
   * intact. Two callers racing get one completion and two identical successes.
   */
  markDone(query: OwnerScopedTaskQuery): Promise<MarkDoneResult>;
}
