"use client";

import { canTransition, type Task } from "@insightt/shared";
import { App, Button, Space } from "antd";

import {
  useArchiveTask,
  useMarkTaskDone,
  useStartTask,
} from "@/hooks/useTaskMutations";

/**
 * The Transitions a row offers.
 *
 * Each control is enabled by `canTransition` — the same predicate the API
 * enforces — so an enabled button cannot produce a `409`. Every row shows
 * every control, disabled where the move is not legal from that Status rather
 * than hidden: the shape of the lifecycle stays visible, and a cell that
 * changes shape per row is harder to scan than one that greys out. An
 * `ARCHIVED` Task shows all three disabled, which is what terminal looks like.
 */
export function TaskActions({ task }: { task: Task }) {
  const { message } = App.useApp();
  const start = useStartTask();
  const done = useMarkTaskDone();
  const archive = useArchiveTask();

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

  async function runArchive() {
    try {
      await archive.mutateAsync(task.id);
      message.success("Task archived");
    } catch (error) {
      message.error(reasonFor(error, "Could not archive the task"));
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
      <Button
        size="small"
        disabled={!canTransition(task.status, "ARCHIVED")}
        loading={archive.isPending}
        onClick={() => void runArchive()}
      >
        Archive
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
