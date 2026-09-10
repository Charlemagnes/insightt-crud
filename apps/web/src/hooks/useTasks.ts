import { useQuery } from "@tanstack/react-query";

import { listTasks } from "@/api/tasks";

/**
 * The query key is what the list view state will become — `['tasks', { page,
 * pageSize, statusFilter }]` — so that changing a filter refetches on its own
 * (PLAN.md §12). Until pagination lands there is nothing to vary.
 */
export const tasksQueryKey = ["tasks"] as const;

export function useTasks() {
  return useQuery({
    queryKey: tasksQueryKey,
    queryFn: listTasks,
  });
}
