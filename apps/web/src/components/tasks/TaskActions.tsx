"use client";

import { canTransition, type Task } from "@insightt/shared";
import { App, Button, Space } from "antd";

import { useMarkTaskDone, useStartTask } from "@/hooks/useTaskMutations";

/**
 * The Transitions a row offers.
 *
 * Each control is enabled by `canTransition` — the same predicate the API
 * enforces — so an enabled button cannot produce a `409`. A Task that has
 * nowhere left to go shows both controls disabled rather than an empty cell,
 * because a cell that changes shape per row is harder to scan than one that
 * greys out.
 */
export function TaskActions({ task }: { task: Task }) {
  const { message } = App.useApp();
  const start = useStartTask();
  const done = useMarkTaskDone();

  async function runStart() {
    try {
      await start.mutateAsync(task.id);
      message.success("Task started");
    } catch (error) {
      message.error(reasonFor(error, "Could not start the task"));
    }
  }

  async function runDone() {
    try {
      const { replayed } = await done.mutateAsync(task.id);

      // A Replay is a success, and saying so plainly is better than a second
      // "Task marked done" for work the person already finished elsewhere.
      message.success(replayed ? "That task was already done" : "Task done");
    } catch (error) {
      message.error(reasonFor(error, "Could not mark the task done"));
    }
  }

  return (
    <Space>
      <Button
        size="small"
        disabled={!canTransition(task.status, "IN_PROGRESS")}
        loading={start.isPending}
        onClick={() => void runStart()}
      >
        Start
      </Button>
      <Button
        size="small"
        type="primary"
        disabled={!canTransition(task.status, "DONE")}
        loading={done.isPending}
        onClick={() => void runDone()}
      >
        Mark done
      </Button>
    </Space>
  );
}

/**
 * What went wrong, in the API's own words where it named something. The
 * fallback is for a failure that never reached the API at all — an offline
 * browser has no message worth repeating.
 */
function reasonFor(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
