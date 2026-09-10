import { TaskPageSchema, type TaskPage } from "@insightt/shared";

import { apiFetch } from "@/api/client";

/** One page of the Actor's own Tasks, newest first. */
export function listTasks(): Promise<TaskPage> {
  return apiFetch("/api/tasks", TaskPageSchema);
}
