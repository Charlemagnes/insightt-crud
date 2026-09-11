"use client";

import { Button, Flex, Layout } from "antd";

import { RequireAuth } from "@/components/auth/RequireAuth";
import { AppHeader } from "@/components/shared/AppHeader";
import { ErrorState } from "@/components/shared/ErrorState";
import { TaskFilters } from "@/components/tasks/TaskFilters";
import { TaskFormModal } from "@/components/tasks/TaskFormModal";
import { TaskTable } from "@/components/tasks/TaskTable";
import { useTasks } from "@/hooks/useTasks";
import { useTaskListStore } from "@/stores/taskList";

const { Content } = Layout;

/**
 * The app's only route. Two screens live behind it — the landing panel and the
 * task list — and `RequireAuth` decides which one the person is looking at.
 */
export default function Home() {
  return (
    <RequireAuth>
      <TaskListScreen />
    </RequireAuth>
  );
}

function TaskListScreen() {
  const { data, isPending, isPlaceholderData, isError, error, refetch } =
    useTasks();
  const status = useTaskListStore((state) => state.status);
  const filterByStatus = useTaskListStore((state) => state.filterByStatus);
  const formTarget = useTaskListStore((state) => state.formTarget);
  const openCreate = useTaskListStore((state) => state.openCreate);
  const openEdit = useTaskListStore((state) => state.openEdit);
  const closeForm = useTaskListStore((state) => state.closeForm);

  const items = data?.items ?? [];

  // The Task under edit is looked up in the fetched page rather than kept in
  // the store, which holds only its id: the rows belong to TanStack Query, and
  // a copy would be a second cache to reconcile on every mutation (PLAN.md §12).
  //
  // Not finding it closes the form, which is the honest answer — the Task it
  // was open on has been deleted, or a filter has moved the list off it.
  const editing =
    formTarget?.mode === "edit"
      ? items.find((task) => task.id === formTarget.taskId)
      : undefined;
  const formOpen = formTarget?.mode === "create" || editing !== undefined;

  return (
    <Layout style={{ minHeight: "100vh", background: "transparent" }}>
      <AppHeader />
      <Content
        style={{ padding: 24, maxWidth: 960, width: "100%", margin: "0 auto" }}
      >
        {isError ? (
          <ErrorState
            title="Could not load your tasks"
            description={error.message}
            onRetry={() => void refetch()}
          />
        ) : (
          <Flex vertical gap={16}>
            <Flex justify="space-between" align="center" wrap gap={12}>
              <TaskFilters />
              <Button type="primary" onClick={openCreate}>
                New task
              </Button>
            </Flex>
            <TaskTable
              tasks={items}
              total={data?.total ?? 0}
              // `isPending` is the first load, which has nothing to show;
              // `isPlaceholderData` is a page change, which has the previous
              // page and dims it instead of emptying the table (PLAN.md §13).
              loading={isPending || isPlaceholderData}
              onEdit={(task) => openEdit(task.id)}
              // A filtered list with no rows is not an empty account, and
              // offering to create the first Task there would be answering a
              // question nobody asked — the Tasks exist, this Status has none.
              emptyDescription={
                status ? "No tasks with this status." : "No tasks yet."
              }
              emptyAction={
                status ? (
                  <Button onClick={() => filterByStatus(null)}>
                    Show all statuses
                  </Button>
                ) : (
                  // The same modal the button above opens, reached from the one
                  // place a person with no Tasks is actually looking.
                  <Button type="primary" onClick={openCreate}>
                    Create your first task
                  </Button>
                )
              }
            />
          </Flex>
        )}
      </Content>
      <TaskFormModal open={formOpen} task={editing} onClose={closeForm} />
    </Layout>
  );
}
