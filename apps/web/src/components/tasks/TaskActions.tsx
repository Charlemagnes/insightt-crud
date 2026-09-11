"use client";

import {
  canEditAnything,
  nextStatus,
  type Task,
  type TaskStatus,
} from "@insightt/shared";
import { App, Button, Popconfirm, Space, Tooltip } from "antd";
import { ArrowRight, Pencil, Trash2 } from "lucide-react";
import type { ReactElement, ReactNode } from "react";

import {
  useArchiveTask,
  useDeleteTask,
  useMarkTaskDone,
  useStartTask,
} from "@/hooks/useTaskMutations";

/**
 * The controls a row offers: Edit, Next, Delete.
 *
 * Next is one control and not three. The Status machine is strictly linear, so
 * a Task has at most one legal move at any moment (CONTEXT.md, "Transition") —
 * three buttons of which two are always greyed out state the same fact three
 * times. `nextStatus` names the one move, and the tooltip says which it is, so
 * the lifecycle stays legible without a row of dead controls.
 *
 * Edit asks a different question: `canEditAnything`, which is `false` only for
 * `ARCHIVED` — a Task that is finished and put away has no field left to
 * change.
 *
 * Delete asks nothing at all. It is legal from every Status including
 * `ARCHIVED` (PLAN.md §7), so it is the one control that is never disabled —
 * and the only one behind a confirmation, because it is the only one that
 * cannot be undone by another click.
 *
 * All three are icons with a tooltip for their name. The icon is what is drawn
 * and the `aria-label` is what is announced, so the name is never only a
 * hover away.
 */
export function TaskActions({ task, onEdit }: TaskActionsProps) {
  const { message } = App.useApp();
  const start = useStartTask();
  const done = useMarkTaskDone();
  const archive = useArchiveTask();
  const deletion = useDeleteTask();

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

  /**
   * Every step the machine has, keyed by the Status it arrives at — which is
   * exactly what `nextStatus` answers, so the row below looks its control up
   * rather than deciding anything. `PENDING` is absent because nothing
   * transitions into it: every Task starts there.
   */
  const steps: Record<Exclude<TaskStatus, "PENDING">, Step> = {
    IN_PROGRESS: {
      label: "Start",
      pending: start.isPending,
      run: () =>
        run(async () => {
          await start.mutateAsync(task.id);
          return "Task started";
        }, "Could not start the task"),
    },
    DONE: {
      label: "Mark done",
      pending: done.isPending,
      run: () =>
        run(async () => {
          const { replayed } = await done.mutateAsync(task.id);

          // A Replay is a success, and saying so plainly is better than a
          // second "Task done" for work the person already finished elsewhere.
          return replayed ? "That task was already done" : "Task done";
        }, "Could not mark the task done"),
    },
    ARCHIVED: {
      label: "Archive",
      pending: archive.isPending,
      run: () =>
        run(async () => {
          await archive.mutateAsync(task.id);
          return "Task archived";
        }, "Could not archive the task"),
    },
  };

  const runDelete = () =>
    run(async () => {
      await deletion.mutateAsync(task.id);
      return "Task deleted";
    }, "Could not delete the task");

  const to = nextStatus(task.status);
  const step = to === null || to === "PENDING" ? null : steps[to];

  return (
    <Space size={12}>
      <IconAction label="Edit">
        <Button
          size="medium"
          aria-label="Edit"
          icon={<Pencil size={16} />}
          disabled={!canEditAnything(task.status)}
          onClick={() => onEdit(task)}
        />
      </IconAction>
      {/* The terminal Status keeps the control rather than dropping it, so the
          three cells stay in the same three places down the column — and the
          tooltip says why it is off instead of leaving a gap to interpret. */}
      <IconAction label={step?.label ?? "No next step"}>
        <Button
          size="medium"
          type="primary"
          aria-label={step?.label ?? "No next step"}
          icon={<ArrowRight size={16} />}
          disabled={step === null}
          loading={step?.pending ?? false}
          onClick={() => void step?.run()}
        />
      </IconAction>
      <Popconfirm
        title="Delete this task?"
        description="It will not be recoverable."
        okText="Delete"
        cancelText="Cancel"
        // The loading state belongs on the confirm control, not the row's
        // button: the person is looking at the popover when the request goes,
        // and it is the control they pressed.
        okButtonProps={{ danger: true, loading: deletion.isPending }}
        // The promise is returned rather than discarded, and that is what makes
        // the line above visible: antd closes the popover the moment `onConfirm`
        // hands back anything that is not thenable, which would take the confirm
        // control away before it could ever show a spinner. Returned, the
        // popover stays until the request settles and a second press is ignored
        // while it is in flight. `runDelete` reports its own failures, so it
        // always resolves and the popover always closes.
        onConfirm={() => runDelete()}
      >
        {/* Tooltip directly, without the wrapper the other two need: this
            control is never disabled, and Popconfirm has to reach the element
            it opens from — a plain `<span>` in between would swallow the click
            handler it clones onto its child. */}
        <Tooltip title="Delete">
          <Button
            size="medium"
            danger
            aria-label="Delete"
            icon={<Trash2 size={16} />}
          />
        </Tooltip>
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

/** One step of the machine, as the row has to offer it. */
interface Step {
  /** What the step is called, in the tooltip and to a screen reader. */
  label: string;
  pending: boolean;
  run: () => Promise<void>;
}

/**
 * An icon button's name, on hover and to assistive technology.
 *
 * The `<span>` is load-bearing. A disabled button fires no pointer events, so
 * a tooltip anchored straight to one never opens — and the control that most
 * needs to explain itself is the one that is off. Wrapping restores the hover
 * target; `inline-flex` keeps the wrapper the size of the button so the row's
 * spacing does not change.
 */
function IconAction({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): ReactElement {
  return (
    <Tooltip title={label}>
      <span style={{ display: "inline-flex" }}>{children}</span>
    </Tooltip>
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
