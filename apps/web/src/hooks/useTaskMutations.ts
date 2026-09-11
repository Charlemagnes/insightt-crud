import type { Task, TaskPage } from "@insightt/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  createTask,
  markTaskDone,
  startTask,
  type MarkDoneResponse,
} from "@/api/tasks";
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

/** Starting a Task. The row shows `IN_PROGRESS` before the API confirms it. */
export function useStartTask() {
  return useTaskRowMutation({
    run: startTask,
    inFlight: (task) => ({ ...task, status: "IN_PROGRESS" }),
    taskIn: (task) => task,
  });
}

/**
 * Marking a Task Done.
 *
 * A Replay resolves rather than rejects, so the caller never has to treat "it
 * was already Done" as a failure; `replayed` on the result is what tells the
 * two apart, and both overwrite the cache from the same response body.
 */
export function useMarkTaskDone() {
  return useTaskRowMutation<MarkDoneResponse>({
    run: markTaskDone,
    inFlight: (task) => ({ ...task, status: "DONE" }),
    taskIn: (result) => result.task,
  });
}

interface TaskRowMutation<Result> {
  /** The request, which every per-row mutation addresses by Task id. */
  run: (id: string) => Promise<Result>;
  /** How the row should look while the request is in flight. */
  inFlight: (task: Task) => Task;
  /** The Task in the response, which the cache is corrected from. */
  taskIn: (result: Result) => Task;
}

/**
 * The per-row mutation policy from PLAN.md §12, in one place: snapshot the
 * cache on mutate, restore it on error, overwrite the row from the response on
 * success, and invalidate once it has settled.
 *
 * Overwriting rather than leaving the optimistic row in place is what keeps
 * `version` honest. The browser cannot know what the Version became, and a
 * guessed one would be sent as the next `If-Match` and refused as stale.
 *
 * `cancelQueries` first, because an in-flight list refetch that lands after the
 * optimistic write would put the old row back and make the click look ignored.
 */
function useTaskRowMutation<Result>({
  run,
  inFlight,
  taskIn,
}: TaskRowMutation<Result>) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: run,

    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: tasksQueryKey });

      const snapshot = queryClient.getQueryData<TaskPage>(tasksQueryKey);

      queryClient.setQueryData<TaskPage>(tasksQueryKey, (page) =>
        page ? withRow(page, id, inFlight) : page,
      );

      return { snapshot };
    },

    onError: (_error, _id, context) => {
      // Put back exactly what was there. The mutation rejected, so the row the
      // person is looking at has to go back to what the server still holds.
      if (context?.snapshot) {
        queryClient.setQueryData(tasksQueryKey, context.snapshot);
      }
    },

    onSuccess: (result) => {
      const task = taskIn(result);

      queryClient.setQueryData<TaskPage>(tasksQueryKey, (page) =>
        page ? withRow(page, task.id, () => task) : page,
      );
    },

    // `total` and the ordering are the server's to decide, and a Transition can
    // move a Task out of a filtered list entirely.
    onSettled: () => queryClient.invalidateQueries({ queryKey: tasksQueryKey }),
  });
}

/** The page with one row replaced, leaving every other row identical. */
function withRow(
  page: TaskPage,
  id: string,
  change: (task: Task) => Task,
): TaskPage {
  return {
    ...page,
    items: page.items.map((task) => (task.id === id ? change(task) : task)),
  };
}
