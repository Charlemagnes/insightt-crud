import { useMutation, useQueryClient } from "@tanstack/react-query";

import { createTask } from "@/api/tasks";
import { tasksQueryKey } from "@/hooks/useTasks";

/**
 * Creating a Task. **Deliberately not optimistic** (PLAN.md §12): under
 * newest-first pagination a new Task's position is not knowable in the browser,
 * and `total` cannot be adjusted correctly across pages, so there is nothing
 * honest to put in the cache until the API answers.
 *
 * It invalidates on success rather than on settle, because a create that failed
 * changed nothing there is to reconcile — unlike the optimistic per-row
 * mutations, which have a rollback to check against the server.
 */
export function useCreateTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createTask,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tasksQueryKey }),
  });
}
