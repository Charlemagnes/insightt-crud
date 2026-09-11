import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { listTasks, type TaskListParams } from "@/api/tasks";
import { useTaskListStore } from "@/stores/taskList";

/**
 * Every cached page of Tasks. Nothing is fetched under this key — it is the
 * prefix the pages hang off, and what a mutation invalidates so that the pages
 * the person is *not* looking at are refetched too. A Transition can move a
 * Task out of a filtered list, which is a change to a page this tab may have
 * cached under a different filter.
 */
export const tasksQueryKey = ["tasks"] as const;

/**
 * One page, keyed by exactly the view state that produced it (PLAN.md §12).
 *
 * This is the mechanism behind "changing a filter refetches": there is no
 * effect watching the filter and asking for a refetch, because a different
 * filter is simply a different key with nothing cached under it yet.
 */
export function taskPageQueryKey(params: TaskListParams) {
  return [...tasksQueryKey, params] as const;
}

/**
 * What the person is looking at, as the list request wants it.
 *
 * The fields are selected one at a time rather than as an object: a selector
 * that built one would return a new reference on every store notification,
 * which is the shape Zustand's snapshot comparison treats as a change and
 * loops on.
 */
export function useTaskListParams(): TaskListParams {
  const page = useTaskListStore((state) => state.page);
  const pageSize = useTaskListStore((state) => state.pageSize);
  const status = useTaskListStore((state) => state.status);
  const sort = useTaskListStore((state) => state.sort);

  // The store keeps the column and its direction as one value, so neither can
  // outlive the other; the query string spells them as two independent keys.
  // An unsorted list asks for neither.
  return {
    page,
    pageSize,
    status,
    sort: sort?.field,
    direction: sort?.direction,
  };
}

/**
 * The Task list, for the page and filter currently selected.
 *
 * `keepPreviousData` is what makes paging feel like paging: the previous page's
 * rows stay on screen while the next one loads, and the table dims them instead
 * of emptying and reflowing the layout under the pager the person just clicked
 * (PLAN.md §13). `isPlaceholderData` is how a caller tells that state from a
 * first load, which has nothing to keep.
 */
export function useTasks() {
  const params = useTaskListParams();

  return useQuery({
    queryKey: taskPageQueryKey(params),
    queryFn: () => listTasks(params),
    placeholderData: keepPreviousData,
  });
}
