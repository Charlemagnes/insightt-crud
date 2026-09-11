import { TASK_PAGE } from "@insightt/shared";
import { create } from "zustand";

import { ALL_STATUSES, type StatusFilter } from "@/api/tasks";

/**
 * What the Task form is open for: a new Task, an existing one, or nothing.
 *
 * One field rather than two, because "creating" and "editing" are the same
 * modal being open — two booleans could disagree and leave it open with no
 * answer about what it is editing.
 *
 * The edit target is an **id, not a Task**. The rows live in the TanStack Query
 * cache and copying one here would be the second cache PLAN.md §12 exists to
 * avoid: an edit would then be written against whatever the store happened to
 * remember rather than against the row the person is looking at.
 */
export type TaskFormTarget =
  { mode: "create" } | { mode: "edit"; taskId: string } | null;

/**
 * What the person is looking at: which page, how large, narrowed to which
 * Status, and which Task they have singled out.
 *
 * **Not the Tasks themselves.** Query owns the rows; this owns the question
 * they were fetched to answer, and `page`, `pageSize` and `status` together
 * *are* the query key — which is what makes changing a filter refetch on its
 * own rather than through an effect that asks it to (PLAN.md §12).
 */
interface TaskListState {
  page: number;
  pageSize: number;
  /** `ALL_STATUSES` until someone narrows it, which is where the list starts. */
  status: StatusFilter;
  formTarget: TaskFormTarget;
  /** Moves the pager. Ant Design reports both numbers, so both are taken. */
  goToPage: (page: number, pageSize: number) => void;
  /**
   * Narrows the list, or widens it again with `ALL_STATUSES`.
   *
   * **Always back to the first page.** The page number counts into a result set
   * the filter has just replaced: page 4 of every Task is not page 4 of the
   * Archived ones, and keeping it lands the person on a page that may not
   * exist, which reads as a filter that found nothing.
   */
  filterByStatus: (status: StatusFilter) => void;
  openCreate: () => void;
  openEdit: (taskId: string) => void;
  closeForm: () => void;
}

export const useTaskListStore = create<TaskListState>((set) => ({
  page: TASK_PAGE.first,
  pageSize: TASK_PAGE.defaultSize,
  status: ALL_STATUSES,
  formTarget: null,
  goToPage: (page, pageSize) => set({ page, pageSize }),
  filterByStatus: (status) => set({ status, page: TASK_PAGE.first }),
  openCreate: () => set({ formTarget: { mode: "create" } }),
  openEdit: (taskId) => set({ formTarget: { mode: "edit", taskId } }),
  closeForm: () => set({ formTarget: null }),
}));
