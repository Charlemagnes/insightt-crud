import type { Task, TaskPage } from "@insightt/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  archiveTask,
  createTask,
  markTaskDone,
  startTask,
  updateTask,
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

/** What an edit needs: the Task as the browser last saw it, and the changes. */
export interface TaskEditVariables {
  task: Task;
  changes: Partial<Pick<Task, "title" | "description">>;
}

/**
 * Editing a Task, against the Version the row was read at.
 *
 * The row shows the new text before the API confirms it, and goes back to what
 * it said if the edit is refused. A refusal is the ordinary case here rather
 * than an exception: a Task edited in another tab raises its Version, and this
 * edit is then `412 VERSION_CONFLICT` — which `onSettled` already refetches,
 * so the row the person is left looking at is the current one.
 */
export function useUpdateTask() {
  return useTaskRowMutation<TaskEditVariables, Task>({
    run: ({ task, changes }) =>
      updateTask({ id: task.id, version: task.version, changes }),
    idOf: ({ task }) => task.id,
    // Only the fields the edit named. Spreading the whole form would put a
    // disabled field's value back over one the Status has closed.
    inFlight: (row, { changes }) => ({ ...row, ...changes }),
    taskIn: (task) => task,
  });
}

/** Starting a Task. The row shows `IN_PROGRESS` before the API confirms it. */
export function useStartTask() {
  return useTaskRowMutation({
    run: startTask,
    idOf: identity,
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
  return useTaskRowMutation<string, MarkDoneResponse>({
    run: markTaskDone,
    idOf: identity,
    inFlight: (task) => ({ ...task, status: "DONE" }),
    taskIn: (result) => result.task,
  });
}

/**
 * Archiving a Task. The row shows `ARCHIVED` before the API confirms it, and
 * stays in the list either way — archiving files a Task away, it does not
 * remove it, so there is no row to take out optimistically.
 */
export function useArchiveTask() {
  return useTaskRowMutation({
    run: archiveTask,
    idOf: identity,
    inFlight: (task) => ({ ...task, status: "ARCHIVED" }),
    taskIn: (task) => task,
  });
}

/** Every Transition addresses its Task by id and asks for nothing else. */
const identity = (id: string) => id;

interface TaskRowMutation<Variables, Result> {
  /** The request this mutation makes. */
  run: (variables: Variables) => Promise<Result>;
  /** Which row in the cached page the request is about. */
  idOf: (variables: Variables) => string;
  /** How that row should look while the request is in flight. */
  inFlight: (task: Task, variables: Variables) => Task;
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
 * Invalidating on **settle** rather than on success is what makes a version
 * conflict a refresh rather than a silent rollback: the edit lost, the rollback
 * put back a row that is now known to be out of date, and the refetch replaces
 * it with what the Task actually says.
 *
 * `cancelQueries` first, because an in-flight list refetch that lands after the
 * optimistic write would put the old row back and make the click look ignored.
 */
function useTaskRowMutation<Variables, Result>({
  run,
  idOf,
  inFlight,
  taskIn,
}: TaskRowMutation<Variables, Result>) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: run,

    onMutate: async (variables: Variables) => {
      await queryClient.cancelQueries({ queryKey: tasksQueryKey });

      const snapshot = queryClient.getQueryData<TaskPage>(tasksQueryKey);

      queryClient.setQueryData<TaskPage>(tasksQueryKey, (page) =>
        page
          ? withRow(page, idOf(variables), (task) => inFlight(task, variables))
          : page,
      );

      return { snapshot };
    },

    onError: (_error, _variables, context) => {
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
