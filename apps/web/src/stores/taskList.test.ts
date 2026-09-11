import { TASK_PAGE } from "@insightt/shared";

import { ALL_STATUSES } from "@/api/tasks";
import { taskPageQueryKey, tasksQueryKey } from "@/hooks/useTasks";
import { useTaskListStore } from "@/stores/taskList";

/**
 * Zustand stores are module singletons, so one test's paging would otherwise be
 * the next one's starting point.
 */
const INITIAL = useTaskListStore.getState();

beforeEach(() => {
  useTaskListStore.setState(INITIAL, true);
});

/** The store's data, without the setters — what the list is actually looking at. */
const view = () => {
  const { page, pageSize, status, sort, formTarget } =
    useTaskListStore.getState();

  return { page, pageSize, status, sort, formTarget };
};

describe("the list view state", () => {
  it("starts on the first page, at the size the API defaults to", () => {
    expect(view()).toMatchObject({
      page: TASK_PAGE.first,
      pageSize: TASK_PAGE.defaultSize,
    });
  });

  it("starts unfiltered, so the first list shows every Status it shows", () => {
    expect(view().status).toBe(ALL_STATUSES);
  });

  // No column claims the first list, and the API is asked for no order.
  it("starts unsorted", () => {
    expect(view().sort).toBeNull();
  });

  it("starts with the form closed", () => {
    expect(view().formTarget).toBeNull();
  });
});

describe("sorting", () => {
  it("takes the column and the direction the header reports", () => {
    useTaskListStore.getState().sortBy({ field: "title", direction: "desc" });

    expect(view().sort).toEqual({ field: "title", direction: "desc" });
  });

  // The third click on a header clears the sort, and the list goes back to the
  // one it started in: no column claiming it, and no order asked for.
  it("clears back to unsorted", () => {
    useTaskListStore.getState().sortBy({ field: "title", direction: "desc" });
    useTaskListStore.getState().sortBy(null);

    expect(view().sort).toBeNull();
  });

  // The sort orders every matching Task, not the page on screen, so page 4 of
  // one order is a different slice of a different result set in the next.
  it("goes back to the first page", () => {
    useTaskListStore.getState().goToPage(4, TASK_PAGE.defaultSize);
    useTaskListStore.getState().sortBy({ field: "status", direction: "asc" });

    expect(view().page).toBe(TASK_PAGE.first);
  });

  it("goes back to the first page when the sort is cleared too", () => {
    useTaskListStore.getState().sortBy({ field: "status", direction: "asc" });
    useTaskListStore.getState().goToPage(4, TASK_PAGE.defaultSize);
    useTaskListStore.getState().sortBy(null);

    expect(view().page).toBe(TASK_PAGE.first);
  });

  it("leaves the Status filter and the page size alone", () => {
    useTaskListStore.getState().filterByStatus("DONE");
    useTaskListStore.getState().goToPage(TASK_PAGE.first, 50);
    useTaskListStore.getState().sortBy({ field: "title", direction: "asc" });

    expect(view()).toMatchObject({ status: "DONE", pageSize: 50 });
  });
});

describe("paging", () => {
  it("moves to the page the pager reports", () => {
    useTaskListStore.getState().goToPage(3, TASK_PAGE.defaultSize);

    expect(view().page).toBe(3);
  });

  it("takes the page size from the same report, so the two cannot disagree", () => {
    useTaskListStore.getState().goToPage(2, 50);

    expect(view()).toMatchObject({ page: 2, pageSize: 50 });
  });

  it("leaves the Status filter alone", () => {
    useTaskListStore.getState().filterByStatus("DONE");
    useTaskListStore.getState().goToPage(2, TASK_PAGE.defaultSize);

    expect(view().status).toBe("DONE");
  });
});

describe("the Status filter", () => {
  it("narrows the list to one Status", () => {
    useTaskListStore.getState().filterByStatus("IN_PROGRESS");

    expect(view().status).toBe("IN_PROGRESS");
  });

  it("widens it again, back to every Status", () => {
    useTaskListStore.getState().filterByStatus("IN_PROGRESS");
    useTaskListStore.getState().filterByStatus(ALL_STATUSES);

    expect(view().status).toBe(ALL_STATUSES);
  });

  it("can select ARCHIVED, which is a Status and not a soft delete", () => {
    useTaskListStore.getState().filterByStatus("ARCHIVED");

    expect(view().status).toBe("ARCHIVED");
  });

  // Page 4 of every Task is not page 4 of the Archived ones. Keeping the number
  // would land the person past the end of the new result set, which reads as a
  // filter that matched nothing.
  it("goes back to the first page", () => {
    useTaskListStore.getState().goToPage(4, TASK_PAGE.defaultSize);
    useTaskListStore.getState().filterByStatus("ARCHIVED");

    expect(view().page).toBe(TASK_PAGE.first);
  });

  it("goes back to the first page when the filter is cleared too", () => {
    useTaskListStore.getState().filterByStatus("ARCHIVED");
    useTaskListStore.getState().goToPage(4, TASK_PAGE.defaultSize);
    useTaskListStore.getState().filterByStatus(ALL_STATUSES);

    expect(view().page).toBe(TASK_PAGE.first);
  });

  it("keeps the page size, which is a preference and not a position", () => {
    useTaskListStore.getState().goToPage(4, 50);
    useTaskListStore.getState().filterByStatus("DONE");

    expect(view().pageSize).toBe(50);
  });
});

describe("the form target", () => {
  it("opens for a new Task", () => {
    useTaskListStore.getState().openCreate();

    expect(view().formTarget).toEqual({ mode: "create" });
  });

  it("opens on an existing Task by id, never by copying the row", () => {
    useTaskListStore.getState().openEdit("task-1");

    expect(view().formTarget).toEqual({ mode: "edit", taskId: "task-1" });
  });

  it("closes", () => {
    useTaskListStore.getState().openEdit("task-1");
    useTaskListStore.getState().closeForm();

    expect(view().formTarget).toBeNull();
  });

  it("cannot be creating and editing at once", () => {
    useTaskListStore.getState().openEdit("task-1");
    useTaskListStore.getState().openCreate();

    expect(view().formTarget).toEqual({ mode: "create" });
  });

  it("does not move the list", () => {
    useTaskListStore.getState().goToPage(2, TASK_PAGE.defaultSize);
    useTaskListStore.getState().openEdit("task-1");

    expect(view()).toMatchObject({ page: 2, status: ALL_STATUSES });
  });
});

/**
 * The view state *is* the query key (PLAN.md §12), which is what makes changing
 * a filter refetch without an effect asking it to. These hold that link.
 */
describe("the query key it forms", () => {
  const keyForCurrentView = () => {
    const { page, pageSize, status, sort } = useTaskListStore.getState();

    return taskPageQueryKey({
      page,
      pageSize,
      status,
      sort: sort?.field,
      direction: sort?.direction,
    });
  };

  it("changes when the page does", () => {
    const before = keyForCurrentView();

    useTaskListStore.getState().goToPage(2, TASK_PAGE.defaultSize);

    expect(keyForCurrentView()).not.toEqual(before);
  });

  it("changes when the page size does", () => {
    const before = keyForCurrentView();

    useTaskListStore.getState().goToPage(TASK_PAGE.first, 50);

    expect(keyForCurrentView()).not.toEqual(before);
  });

  it("changes when the sort does", () => {
    const before = keyForCurrentView();

    useTaskListStore.getState().sortBy({ field: "title", direction: "asc" });

    expect(keyForCurrentView()).not.toEqual(before);
  });

  it("changes when only the direction does", () => {
    useTaskListStore.getState().sortBy({ field: "title", direction: "asc" });
    const before = keyForCurrentView();

    useTaskListStore.getState().sortBy({ field: "title", direction: "desc" });

    expect(keyForCurrentView()).not.toEqual(before);
  });

  // Clearing the sort is a different question than any sorted one, so the
  // unsorted page cannot be served out of a sorted page's cache entry.
  it("changes when the sort is cleared", () => {
    useTaskListStore.getState().sortBy({ field: "title", direction: "asc" });
    const before = keyForCurrentView();

    useTaskListStore.getState().sortBy(null);

    expect(keyForCurrentView()).not.toEqual(before);
  });

  it("changes when the Status filter does", () => {
    const before = keyForCurrentView();

    useTaskListStore.getState().filterByStatus("DONE");

    expect(keyForCurrentView()).not.toEqual(before);
  });

  it("does not change when only the form opens", () => {
    const before = keyForCurrentView();

    useTaskListStore.getState().openEdit("task-1");

    expect(keyForCurrentView()).toEqual(before);
  });

  // Invalidating the prefix is how a mutation reaches the pages this tab is not
  // looking at — a Transition can move a Task out of a filter cached elsewhere.
  it("sits under the prefix every mutation invalidates", () => {
    useTaskListStore.getState().filterByStatus("DONE");

    expect(keyForCurrentView().slice(0, tasksQueryKey.length)).toEqual([
      ...tasksQueryKey,
    ]);
  });
});
