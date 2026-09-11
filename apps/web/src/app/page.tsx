"use client";

import type { Task } from "@insightt/shared";
import { Button, Flex, Layout } from "antd";
import { useState } from "react";

import { RequireAuth } from "@/components/auth/RequireAuth";
import { AppHeader } from "@/components/shared/AppHeader";
import { ErrorState } from "@/components/shared/ErrorState";
import { TaskFormModal } from "@/components/tasks/TaskFormModal";
import { TaskTable } from "@/components/tasks/TaskTable";
import { useTasks } from "@/hooks/useTasks";

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

/**
 * What the Task form is open for: a new Task when there is no `task`, an
 * existing one when there is, and nothing at all when it is `null`.
 *
 * One piece of state rather than two, because the form is one modal and
 * "creating" and "editing" are the same modal being open — two booleans could
 * disagree and leave it open with no answer about what it is editing.
 */
type FormTarget = { task?: Task } | null;

function TaskListScreen() {
  const { data, isPending, isError, error, refetch } = useTasks();
  // The screen owns the form, because three things open it: the button below,
  // the empty state's call to action, and every row's Edit control.
  const [formTarget, setFormTarget] = useState<FormTarget>(null);
  const openCreate = () => setFormTarget({});

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
            <Flex justify="flex-end">
              <Button type="primary" onClick={openCreate}>
                New task
              </Button>
            </Flex>
            <TaskTable
              tasks={data?.items ?? []}
              loading={isPending}
              onEdit={(task) => setFormTarget({ task })}
              // The same modal the button above opens, reached from the one
              // place a person with no Tasks is actually looking.
              emptyAction={
                <Button type="primary" onClick={openCreate}>
                  Create your first task
                </Button>
              }
            />
          </Flex>
        )}
      </Content>
      <TaskFormModal
        open={formTarget !== null}
        task={formTarget?.task}
        onClose={() => setFormTarget(null)}
      />
    </Layout>
  );
}
