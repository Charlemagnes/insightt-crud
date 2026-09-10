"use client";

import { Layout } from "antd";

import { RequireAuth } from "@/components/auth/RequireAuth";
import { AppHeader } from "@/components/shared/AppHeader";
import { ErrorState } from "@/components/shared/ErrorState";
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

  return (
    <Layout style={{ minHeight: "100vh", background: "transparent" }}>
      <AppHeader />
      <Content style={{ padding: 24, maxWidth: 960, width: "100%", margin: "0 auto" }}>
        {isError ? (
          <ErrorState
            title="Could not load your tasks"
            description={error.message}
            onRetry={() => void refetch()}
          />
        ) : (
          <TaskTable tasks={data?.items ?? []} loading={isPending} />
        )}
      </Content>
    </Layout>
  );
}
