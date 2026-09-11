import {
  TaskPageSchema,
  TaskSchema,
  type CreateTaskInput,
  type Task,
  type TaskPage,
} from "@insightt/shared";

import { apiFetch, apiFetchWithHeaders, jsonRequest } from "@/api/client";

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
