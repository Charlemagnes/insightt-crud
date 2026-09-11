"use client";

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

function TaskListScreen() {
  const { data, isPending, isError, error, refetch } = useTasks();
  // The screen owns whether the create modal is open, because two things open
  // it: the button below and the empty state's call to action.
  const [creating, setCreating] = useState(false);

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
              <Button type="primary" onClick={() => setCreating(true)}>
                New task
              </Button>
            </Flex>
            <TaskTable
              tasks={data?.items ?? []}
              loading={isPending}
              // The same modal the button above opens, reached from the one
              // place a person with no Tasks is actually looking.
              emptyAction={
                <Button type="primary" onClick={() => setCreating(true)}>
                  Create your first task
                </Button>
              }
            />
          </Flex>
        )}
      </Content>
      <TaskFormModal open={creating} onClose={() => setCreating(false)} />
    </Layout>
  );
}
