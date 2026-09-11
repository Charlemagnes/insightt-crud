import {
  TaskPageSchema,
  TaskSchema,
  type CreateTaskInput,
  type Task,
  type TaskPage,
  type UpdateTaskInput,
} from "@insightt/shared";

import {
  apiFetch,
  apiFetchWithHeaders,
  apiSend,
  jsonRequest,
} from "@/api/client";

/** The Transition endpoints take no body — the target Status is in the path. */
const TRANSITION_REQUEST: RequestInit = { method: "POST" };

/** One page of the Actor's own Tasks, newest first. */
export function listTasks(): Promise<TaskPage> {
  return apiFetch("/api/tasks", TaskPageSchema);
}

/**
 * Creates a Task and returns it as stored — with the id, the Version and the
 * timestamps the browser could not know, and the `PENDING` Status the API
 * assigns whatever this asked for.
 *
 * The input is the already-parsed output of `CreateTaskInput`, so the browser
 * and the API have applied the same rules to the same text. The API parses it
 * again regardless; this validation is for the person filling in the form, not
 * a substitute for the one that protects the database.
 */
export function createTask(input: CreateTaskInput): Promise<Task> {
  return apiFetch("/api/tasks", TaskSchema, jsonRequest("POST", input));
}

/** The arguments `updateTask` sends: the edit, and what it was written against. */
export interface TaskEditRequest {
  id: string;
  /** The Version the browser last saw, which becomes the `If-Match`. */
  version: number;
  changes: UpdateTaskInput;
}

/**
 * Edits a Task, refusing to write over a change made somewhere else.
 *
 * The Version travels as `If-Match`, not in the body: it is a precondition on
 * the request rather than a field being written, and the API rejects a body
 * that names one. An edit sent against a Version the Task has moved past comes
 * back `412 VERSION_CONFLICT` rather than quietly winning.
 *
 * `changes` carries only the fields being changed. A field the Task's Status
 * has closed is not one of them — the form does not offer it, and naming it
 * anyway would be `422 FIELD_NOT_EDITABLE`.
 */
export function updateTask({
  id,
  version,
  changes,
}: TaskEditRequest): Promise<Task> {
  const init = jsonRequest("PATCH", changes);

  return apiFetch(`/api/tasks/${id}`, TaskSchema, {
    ...init,
    // Quoted, because `If-Match` is compared verbatim against the `ETag` the
    // API issued and that tag is quoted.
    headers: { ...init.headers, "If-Match": `"${version}"` },
  });
}

/**
 * Deletes a Task. Allowed from every Status, including `ARCHIVED` — terminal
 * describes the Transitions a Task has left, not whether it can be removed.
 *
 * No Version travels with it, unlike an edit: a delete overwrites nothing, so
 * there is no stale write for a precondition to refuse. A Task that is already
 * gone comes back `404`, not a success — deleting is not a Replay.
 *
 * Nothing is returned because the API answers `204`: the Task it described does
 * not exist any more.
 */
export async function deleteTask(id: string): Promise<void> {
  await apiSend(`/api/tasks/${id}`, { method: "DELETE" });
}

/** Starts a Task: `PENDING → IN_PROGRESS`. */
export function startTask(id: string): Promise<Task> {
  return apiFetch(`/api/tasks/${id}/start`, TaskSchema, TRANSITION_REQUEST);
}

/**
 * Archives a Task: `DONE → ARCHIVED`, the last move it has.
 *
 * The Task comes back rather than disappearing. Archived is a Status, not a
 * soft delete, and the row stays in the list (CONTEXT.md, "Archived").
 */
export function archiveTask(id: string): Promise<Task> {
  return apiFetch(`/api/tasks/${id}/archive`, TaskSchema, TRANSITION_REQUEST);
}

/**
 * A completed Task, and whether this request is what completed it.
 *
 * `replayed` is not a failure. It means the Task was already Done — a second
 * tab, or a double click that got through — and the API answered the same
 * `200` with the original completion time intact (CONTEXT.md, "Replay").
 */
export interface MarkDoneResponse {
  task: Task;
  replayed: boolean;
}

/** Marks a Task Done. Safe to call twice: the second call is a Replay. */
export async function markTaskDone(id: string): Promise<MarkDoneResponse> {
  const { body, headers } = await apiFetchWithHeaders(
    `/api/tasks/${id}/done`,
    TaskSchema,
    TRANSITION_REQUEST,
  );

  // Readable only because CORS exposes it; a browser strips a header that is
  // neither safelisted nor named in `exposedHeaders` (PLAN.md §10).
  return { task: body, replayed: headers.get("X-Idempotent-Replay") === "true" };
}
