"use client";

import { RequireAuth } from "@/components/auth/RequireAuth";
import { TaskListScreen } from "@/components/tasks/TaskListScreen";

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
