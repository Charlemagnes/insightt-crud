"use client";

import { Button, Flex, Layout } from "antd";
import { useEffect } from "react";

import { AppHeader } from "@/components/shared/AppHeader";
import { ErrorState } from "@/components/shared/ErrorState";
import { TaskFilters } from "@/components/tasks/TaskFilters";
import { TaskFormModal } from "@/components/tasks/TaskFormModal";
import { TaskTable } from "@/components/tasks/TaskTable";
import { useTasks } from "@/hooks/useTasks";
import { useTaskListStore } from "@/stores/taskList";

const { Content } = Layout;

/**
 * The task list: the screen behind the auth gate, and everything a signed-in
 * person sees. `app/page.tsx` is the route and the gate; this is the screen.
 *
 * It is a component of its own rather than a function inside the page so that
 * the integration test can render it (PLAN.md §15). The gate is Auth0's, and
 * driving Universal Login under jsdom would be a test of the identity provider
 * — which is what the Cypress spec is for.
 */
export function TaskListScreen() {
  const { data, isFetched, isPending, isPlaceholderData, isError, error, refetch } =
    useTasks();
  const status = useTaskListStore((state) => state.status);
  const filterByStatus = useTaskListStore((state) => state.filterByStatus);
  const formTarget = useTaskListStore((state) => state.formTarget);
  const openCreate = useTaskListStore((state) => state.openCreate);
  const openEdit = useTaskListStore((state) => state.openEdit);
  const closeForm = useTaskListStore((state) => state.closeForm);

  const items = data?.items ?? [];
  const editingTaskId = formTarget?.mode === "edit" ? formTarget.taskId : null;

  // The Task under edit is looked up in the fetched page rather than kept in
  // the store, which holds only its id: the rows belong to TanStack Query, and
  // a copy would be a second cache to reconcile on every mutation (PLAN.md §12).
  const editing =
    editingTaskId === null
      ? undefined
      : items.find((task) => task.id === editingTaskId);
  const formOpen = formTarget?.mode === "create" || editing !== undefined;

  // Nothing else notices when the Task the form is open on leaves the list —
  // deleted in another tab, or moved out from under the current filter. The
  // store has to be cleared and not merely the modal hidden: a target left
  // pointing at a Task that is no longer here would reopen the form by itself
  // the moment the row came back into view.
  //
  // `isFetched` is what keeps this off the first load and off a page change,
  // where the list is legitimately without the Task and nothing has gone
  // anywhere yet.
  useEffect(() => {
    if (isFetched && editingTaskId !== null && editing === undefined) {
      closeForm();
    }
  }, [isFetched, editingTaskId, editing, closeForm]);

  // One question, asked once: a filtered list with no rows is not an empty
  // account, and offering to create a first Task there would answer a question
  // nobody asked — the Tasks exist, this Status has none.
  const empty = status
    ? {
        description: "No tasks with this status.",
        action: (
          <Button onClick={() => filterByStatus(null)}>
            Show all statuses
          </Button>
        ),
      }
    : {
        description: "No tasks yet.",
        // The same modal the button above opens, reached from the one place a
        // person with no Tasks is actually looking.
        action: (
          <Button type="primary" onClick={openCreate}>
            Create your first task
          </Button>
        ),
      };

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
              emptyDescription={empty.description}
              emptyAction={empty.action}
            />
          </Flex>
        )}
      </Content>
      <TaskFormModal open={formOpen} task={editing} onClose={closeForm} />
    </Layout>
  );
}
