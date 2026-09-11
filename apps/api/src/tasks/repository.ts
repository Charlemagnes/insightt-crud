import type { Task, TaskStatus, UpdateTaskInput } from "@insightt/shared";

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

/**
 * An edit, and the Version the Actor believed the Task was at.
 *
 * `expectedVersion` is not optional. A write with no Version to check against
 * is the clobbering this whole mechanism exists to prevent, so the type refuses
 * to describe one; the route turns a missing `If-Match` into `428` before it
 * gets this far.
 *
 * `changes` is the shared `UpdateTaskInput`, whose two fields already mean
 * exactly what storage needs them to: an absent key leaves the column alone,
 * and `description: null` clears it.
 */
export interface OwnerScopedTaskEdit extends OwnerScopedTaskQuery {
  expectedVersion: number;
  changes: UpdateTaskInput;
}

/**
 * What a guarded edit did.
 *
 * `stale` is its own outcome rather than a flavour of refusal: the Task is
 * real, the Actor owns it, and the only thing wrong is that it moved on since
 * they read it. That is `412 VERSION_CONFLICT`, which the frontend recovers
 * from by refreshing — a different thing entirely from the `404` a Task that
 * is not there gets.
 */
export type UpdateResult =
  | { outcome: "changed"; task: Task }
  | { outcome: "stale"; task: Task }
  | { outcome: "not_found" };

/** One page of Tasks, plus the count the pager needs to size itself. */
export interface TaskListResult {
  items: Task[];
  total: number;
}

/**
 * Why a Transition did not happen. The distinction this preserves is the one
 * the routes report as `409` against `404`: a repository that answered
 * `Task | null` would have thrown it away before anything could.
 *
 * `not_found` carries no Task, because a Task the Actor does not own and a
 * Task that does not exist are the same answer and neither has one to give.
 */
export type Refused =
  | { outcome: "wrong_status"; task: Task }
  | { outcome: "not_found" };

/** What a guarded Transition did. */
export type TransitionResult = { outcome: "changed"; task: Task } | Refused;

/**
 * What marking a Task Done did: the same refusals, and two ways to succeed.
 *
 * `replayed` is deliberately not folded into `completed`. The Task was already
 * `DONE`, nothing was written, and that is a success (CONTEXT.md, "Replay") —
 * but it is the one the route marks with a header, and collapsing the two here
 * would leave the API unable to say which request finished the work.
 */
export type MarkDoneResult =
  | { outcome: "completed"; task: Task }
  | { outcome: "replayed"; task: Task }
  | Refused;

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
   * Changes the fields an edit names, but only while the Task is still at
   * `expectedVersion`.
   *
   * One guarded statement, like every Transition: the Version is part of the
   * `WHERE`, so two Actors editing the same Task from the same read cannot both
   * win. The loser matches no row and comes back `stale`.
   *
   * The whitelist that decides *which* fields a Status leaves open is not asked
   * here. It needs the Task, it is the same rule in both implementations, and
   * it is the route's to enforce — see `assertEditable` in `routes.ts`.
   */
  update(edit: OwnerScopedTaskEdit): Promise<UpdateResult>;

  /**
   * Removes a Task outright, and answers whether there was one to remove.
   *
   * No Status guard, and no `expectedVersion`. Delete is legal from every
   * Status (PLAN.md §7), and a Version would only refuse a delete because the
   * Task's title changed — a precondition that protects nothing, since the row
   * the caller wants gone is the row that goes.
   *
   * `false` is both "no such Task" and "not yours", the same collapse
   * `findById` makes: the route turns either into `404`, so no answer here can
   * confirm that someone else's Task exists.
   *
   * A second delete of the same Task is `false`, not an error. Deleting is not
   * idempotent the way Mark Done is — the Task is gone, and there is no longer
   * anything to report success about (CONTEXT.md, "Delete").
   */
  delete(query: OwnerScopedTaskQuery): Promise<boolean>;

  /**
   * Moves a `PENDING` Task to `IN_PROGRESS`, through one guarded statement.
   *
   * The Status it may be moved from is not a parameter: it is the Status the
   * shared machine names as the one before `IN_PROGRESS`, so a caller cannot
   * ask for a Transition the rules do not allow.
   */
  start(query: OwnerScopedTaskQuery): Promise<TransitionResult>;

  /**
   * Moves a `DONE` Task to `ARCHIVED`, through the same guarded statement
   * `start` uses — the Status it may be moved from again comes from the shared
   * machine rather than from the caller.
   *
   * Archiving is not a delete. The row stays, the Task keeps its completion
   * time, and it goes on appearing in the Owner's list (CONTEXT.md,
   * "Archived"). What changes is that `ARCHIVED` is terminal, so this is the
   * last Transition the Task has.
   */
  archive(query: OwnerScopedTaskQuery): Promise<TransitionResult>;

  /**
   * Marks a Task `DONE`, atomically and idempotently.
   *
   * Calling it twice is not an error and does not complete the Task twice: the
   * second call comes back `replayed`, with the original completion time
   * intact. Two callers racing get one completion and two identical successes.
   */
  markDone(query: OwnerScopedTaskQuery): Promise<MarkDoneResult>;
}
