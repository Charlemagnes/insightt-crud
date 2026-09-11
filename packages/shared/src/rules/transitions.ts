import { TaskStatus, type Task, type UpdateTaskInput } from "../schemas/task";

/**
 * The lifecycle, in order. This array **is** the machine: the Status machine is
 * strictly linear, so every legal Transition is one step to the right and
 * nothing else has to be written down (CONTEXT.md, "Transition").
 *
 * It is `TaskStatus.options` rather than a second list, because a second list
 * is a second place the order could be wrong. `apps/api/src/db/schema.test.ts`
 * already holds the Postgres enum to this same order, so all three spellings —
 * Zod, Postgres, and the machine below — move together or fail a test.
 */
export const LIFECYCLE: readonly TaskStatus[] = TaskStatus.options;

/**
 * The Status a Task moves to next, or `null` when it has nowhere left to go.
 * `ARCHIVED` is terminal, so it is the one Status that answers `null`.
 */
export function nextStatus(from: TaskStatus): TaskStatus | null {
  const next: TaskStatus | undefined = LIFECYCLE[LIFECYCLE.indexOf(from) + 1];
  return next ?? null;
}

/**
 * The one Status a Task must already be in for `to` to be reachable, or `null`
 * when `to` is where every Task starts and nothing transitions into it.
 *
 * This is what a guarded `UPDATE` needs: "move this Task to `IN_PROGRESS`, but
 * only if it is still `PENDING`" is one statement, and the Status in its
 * `WHERE` clause comes from here rather than from the call site, so the guard
 * cannot disagree with the machine.
 */
export function statusBefore(to: TaskStatus): TaskStatus | null {
  const index = LIFECYCLE.indexOf(to);
  return index > 0 ? LIFECYCLE[index - 1] : null;
}

/**
 * Whether a Task in `from` may move to `to`. Only a single step forward is
 * legal: no skipping, no reverting, and nothing at all out of `ARCHIVED`.
 *
 * Both the API and the UI ask this question. The UI disables a control the
 * answer is `false` for, so no enabled control can produce a rejection; the API
 * answers `409 INVALID_TRANSITION` when one arrives anyway, because a disabled
 * button is a courtesy and not an enforcement.
 */
export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return nextStatus(from) === to;
}

/** The fields an edit may name. Everything else about a Task is derived. */
export const EDITABLE_FIELDS = ["title", "description"] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];

/**
 * Which fields each Status leaves open, as a whitelist (PLAN.md §7). A
 * whitelist and not a heuristic: the answer to "may I change this?" is looked
 * up, never guessed at.
 *
 * A `DONE` Task keeps its title editable so a typo can be fixed after the fact,
 * but not its description — the description is the plan, and the work is over.
 * An `ARCHIVED` Task is closed to everything: it is finished and put away
 * (CONTEXT.md, "Archived").
 */
const EDITABLE_BY_STATUS: Record<TaskStatus, readonly EditableField[]> = {
  PENDING: ["title", "description"],
  IN_PROGRESS: ["title", "description"],
  DONE: ["title"],
  ARCHIVED: [],
};

/** Whether `field` may be changed on a Task in `status`. */
export function canEdit(status: TaskStatus, field: EditableField): boolean {
  return EDITABLE_BY_STATUS[status].includes(field);
}

/**
 * The fields an edit would actually change, dropping the ones that already hold
 * the value they ask for.
 *
 * Two callers need the same answer for different reasons, and a second copy is
 * a second place they could disagree. The edit form sends only what this
 * returns, so a field the person did not touch is never named and so cannot be
 * refused by the whitelist. The API asks whether it is empty, and refuses the
 * edit if it is: the Version is the record that a Task changed, and raising it
 * for a write that changed nothing would invalidate every other tab's
 * `If-Match` over an edit that never happened.
 *
 * A field the edit did not name is not a change. Omitting a key means "leave it
 * alone", which is exactly what leaving it out of the result means too.
 */
export function changedFields(
  task: Task,
  edit: UpdateTaskInput,
): UpdateTaskInput {
  const changed: UpdateTaskInput = {};

  // Written out rather than looped, because a loop over `EDITABLE_FIELDS`
  // cannot assign through a union key without a cast, and a cast here would be
  // the one place a field could be copied into the wrong slot unnoticed.
  if (edit.title !== undefined && edit.title !== task.title) {
    changed.title = edit.title;
  }

  if (edit.description !== undefined && edit.description !== task.description) {
    changed.description = edit.description;
  }

  return changed;
}

/** Whether any field at all may be changed — what an Edit control asks. */
export function canEditAnything(status: TaskStatus): boolean {
  return EDITABLE_BY_STATUS[status].length > 0;
}
