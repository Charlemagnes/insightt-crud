"use client";

import {
  canEditAnything,
  canTransition,
  type Task,
  type TaskStatus,
} from "@insightt/shared";
import { App, Button, Popconfirm, Space } from "antd";
import type { ButtonProps } from "antd";

import {
  useArchiveTask,
  useDeleteTask,
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
 * `ARCHIVED` Task shows all of them disabled, which is what terminal looks
 * like.
 *
 * Edit is the one control that is not a Transition, and it asks a different
 * question: `canEditAnything`, which is `false` only for `ARCHIVED` — a Task
 * that is finished and put away has no field left to change.
 *
 * Delete asks nothing at all. It is legal from every Status including
 * `ARCHIVED` (PLAN.md §7), so it is the one control that is never disabled —
 * and the only one behind a confirmation, because it is the only one that
 * cannot be undone by another click.
 */
export function TaskActions({ task, onEdit }: TaskActionsProps) {
  const { message } = App.useApp();
  const start = useStartTask();
  const done = useMarkTaskDone();
  const archive = useArchiveTask();
  const remove = useDeleteTask();

  /**
   * Runs a Transition and says what happened. The success line is whatever the
   * Transition returns, so Mark Done can report a Replay in its own words
   * without a second copy of this.
   *
   * A refusal the UI believed impossible still reaches the person, in the
   * API's own words: the disabled buttons are a courtesy, and the browser's
   * idea of a Task's Status can be a moment out of date.
   */
  async function run(
    transition: () => Promise<string>,
    failure: string,
  ): Promise<void> {
    try {
      message.success(await transition());
    } catch (error) {
      message.error(reasonFor(error, failure));
    }
  }

  const runStart = () =>
    run(async () => {
      await start.mutateAsync(task.id);
      return "Task started";
    }, "Could not start the task");

  const runDone = () =>
    run(async () => {
      const { replayed } = await done.mutateAsync(task.id);

      // A Replay is a success, and saying so plainly is better than a second
      // "Task done" for work the person already finished elsewhere.
      return replayed ? "That task was already done" : "Task done";
    }, "Could not mark the task done");

  const runArchive = () =>
    run(async () => {
      await archive.mutateAsync(task.id);
      return "Task archived";
    }, "Could not archive the task");

  const runDelete = () =>
    run(async () => {
      await remove.mutateAsync(task.id);
      return "Task deleted";
    }, "Could not delete the task");

  return (
    <Space>
      <Button size="small" disabled={!canEditAnything(task.status)} onClick={() => onEdit(task)}>
        Edit
      </Button>
      <TransitionButton
        task={task}
        to="IN_PROGRESS"
        label="Start"
        pending={start.isPending}
        onRun={runStart}
      />
      <TransitionButton
        task={task}
        to="DONE"
        label="Mark done"
        type="primary"
        pending={done.isPending}
        onRun={runDone}
      />
      <TransitionButton
        task={task}
        to="ARCHIVED"
        label="Archive"
        pending={archive.isPending}
        onRun={runArchive}
      />
      <Popconfirm
        title="Delete this task?"
        description="It will not be recoverable."
        okText="Delete"
        cancelText="Cancel"
        // The loading state belongs on the confirm control, not the row's
        // button: the person is looking at the popover when the request goes,
        // and it is the control they pressed.
        okButtonProps={{ danger: true, loading: remove.isPending }}
        onConfirm={() => void runDelete()}
      >
        <Button size="small" danger>
          Delete
        </Button>
      </Popconfirm>
    </Space>
  );
}

interface TaskActionsProps {
  task: Task;
  /**
   * Opens the edit form on this Task. The screen owns which Task is being
   * edited, so there is one form for the whole table rather than one per row.
   */
  onEdit: (task: Task) => void;
}

interface TransitionButtonProps {
  task: Task;
  /** Where this control would move the Task, which is what decides its state. */
  to: TaskStatus;
  label: string;
  pending: boolean;
  onRun: () => Promise<void>;
  type?: ButtonProps["type"];
}

/**
 * One Transition control, written once for all of them. Whether it is enabled
 * is not a prop: it is `canTransition`, asked here, so no control can be
 * offered for a move the machine refuses — and adding a fourth is a matter of
 * naming the Status it moves to.
 */
function TransitionButton({
  task,
  to,
  label,
  pending,
  onRun,
  type,
}: TransitionButtonProps) {
  return (
    <Button
      size="small"
      type={type}
      disabled={!canTransition(task.status, to)}
      loading={pending}
      onClick={() => void onRun()}
    >
      {label}
    </Button>
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
