import {
  TaskPageSchema,
  TaskSchema,
  type CreateTaskInput,
  type Task,
  type TaskPage,
} from "@insightt/shared";

import { apiFetch, jsonRequest } from "@/api/client";

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
