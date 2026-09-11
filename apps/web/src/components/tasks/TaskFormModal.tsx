"use client";

import {
  canEdit,
  CreateTaskInput,
  EDITABLE_FIELDS,
  TASK_LIMITS,
  UpdateTaskInput,
  type Task,
} from "@insightt/shared";
import { App, Form, Input, Modal } from "antd";

import { ApiError } from "@/api/client";
import {
  attachIssues,
  attachZodErrors,
  clearFieldErrors,
  issuesIn,
} from "@/forms/zodFieldErrors";
import {
  useCreateTask,
  useUpdateTask,
  type TaskEditVariables,
} from "@/hooks/useTaskMutations";

/**
 * What the two inputs hold. Always both, always strings: a text area that was
 * emptied is `""` here, and the shared schema is what turns that into the
 * absent description it means.
 */
interface TaskFormValues {
  title: string;
  description: string;
}

/** A form with nothing typed in it, which is what a create starts from. */
const BLANK: TaskFormValues = { title: "", description: "" };

/**
 * The inputs this form has, taken from the whitelist rather than listed again.
 * It is the same list `canEdit` answers questions about, so a field that the
 * rules know and the form does not would be a `FIELD_NOT_EDITABLE` nothing
 * could be marked with.
 */
const FIELDS = EDITABLE_FIELDS;

interface TaskFormModalProps {
  open: boolean;
  onClose: () => void;
  /** The Task being edited. Absent means the form is creating a new one. */
  task?: Task;
}

/**
 * The Task form, for both creating and editing (PLAN.md §13). One component
 * because the two differ in what they submit and almost nothing else: the same
 * two inputs, the same limits, and the same shared schema deciding what is
 * acceptable in the browser and again at the API.
 *
 * Validation runs on submit and is attached to the fields by `attachZodErrors`,
 * so the browser and the API apply the same rules to the same text — and the
 * API applies them again regardless.
 *
 * On failure the modal stays open with everything typed still in it. A refused
 * submit is one worth retrying, and the text is the part that cost the person
 * something. The exception is a version conflict, which is not retryable from
 * this form: the Task it was written against no longer exists in that shape.
 */
export function TaskFormModal({ open, onClose, task }: TaskFormModalProps) {
  const [form] = Form.useForm<TaskFormValues>();
  const { message, notification } = App.useApp();
  const create = useCreateTask();
  const update = useUpdateTask();

  const editing = task !== undefined;
  const pending = editing ? update.isPending : create.isPending;

  function close() {
    form.resetFields();
    onClose();
  }

  /**
   * Whatever could not be attached to a field still has to be seen, or a
   * refused submit looks like a submit that did nothing. When there is nothing
   * left over, the fields are already showing the problem and a toast would be
   * saying it twice — the `fallback` is for a rejection that named no field.
   */
  function report(unattached: string[], fallback?: string) {
    const problems =
      unattached.length > 0 ? unattached : fallback ? [fallback] : [];

    for (const problem of problems) {
      message.error(problem);
    }
  }

  async function submit() {
    // The OK button refuses clicks while it spins, but Enter in the title field
    // submits the form directly and would not otherwise notice.
    if (pending) return;

    await (task ? submitEdit(task) : submitCreate());
  }

  async function submitCreate() {
    const parsed = CreateTaskInput.safeParse(form.getFieldsValue());

    if (!parsed.success) {
      report(attachZodErrors(form, parsed.error, FIELDS));
      return;
    }

    try {
      await create.mutateAsync(parsed.data);
      message.success("Task created");
      close();
    } catch (error) {
      showFailure(error, "Could not create the task");
    }
  }

  async function submitEdit(edited: Task) {
    const parsed = UpdateTaskInput.safeParse(form.getFieldsValue());

    if (!parsed.success) {
      report(attachZodErrors(form, parsed.error, FIELDS));
      return;
    }

    const changes = changedFields(edited, parsed.data);

    // An edit that changes nothing is refused here as well as at the API,
    // because a Version raised for no reason invalidates every other tab's
    // `If-Match` over an edit that never happened. Refusing it in the browser
    // only saves the round trip; the API is what actually enforces it.
    if (Object.keys(changes).length === 0) {
      message.info("Nothing to save — no field was changed");
      return;
    }

    try {
      await update.mutateAsync({ task: edited, changes });
      message.success("Task updated");
      close();
    } catch (error) {
      showFailure(error, "Could not save the task");
    }
  }

  /**
   * What to do with a rejection, by the code the API named.
   *
   * `VERSION_CONFLICT` is the one that is not the person's mistake: the Task
   * moved on somewhere else, the optimistic row has already rolled back, and
   * the list has already been refetched. A warning that says so is the honest
   * answer — a silent rollback would look like a save that quietly did nothing.
   *
   * The two `422`s carry issues with the same paths a local parse produces, so
   * they mark the fields rather than arriving as a toast about an input the
   * person cannot see.
   */
  function showFailure(error: unknown, fallback: string) {
    if (error instanceof ApiError) {
      if (error.code === "VERSION_CONFLICT") {
        notification.warning({
          message: "That task changed elsewhere",
          description:
            "Your edit was not saved, and the list has been refreshed with what the task says now.",
        });
        close();
        return;
      }

      if (
        error.code === "VALIDATION_FAILED" ||
        error.code === "FIELD_NOT_EDITABLE"
      ) {
        report(
          attachIssues(form, issuesIn(error.details), FIELDS),
          error.message,
        );
        return;
      }
    }

    message.error(error instanceof Error ? error.message : fallback);
  }

  return (
    <Modal
      open={open}
      title={editing ? "Edit task" : "New task"}
      okText={editing ? "Save" : "Create"}
      // One flight at a time: the button spins and stops accepting clicks, so a
      // second press cannot produce a second Task or a second edit.
      okButtonProps={{ loading: pending }}
      cancelButtonProps={{ disabled: pending }}
      onOk={() => void submit()}
      onCancel={close}
      // The text is only worth keeping while the modal is open, and destroying
      // it is also what re-seeds the inputs: reopened on another Task, the form
      // remounts and reads that Task's `initialValues` rather than the last
      // one's.
      destroyOnHidden
      mask={{ closable: !pending }}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={task ? valuesOf(task) : BLANK}
        onValuesChange={(changed: Partial<TaskFormValues>) =>
          clearFieldErrors(form, Object.keys(changed))
        }
        onFinish={() => void submit()}
      >
        <Form.Item label="Title" name="title" required>
          {/* `count` rather than `maxLength`: it shows the limit and marks the
              overflow, where `maxLength` would quietly drop the tail of a
              pasted title and leave the rule that bounds it nothing to say.
              Without an `exceedFormatter` it counts past the max instead of
              truncating, so the schema stays the only thing that rejects. */}
          <Input
            autoFocus
            placeholder="What needs doing?"
            count={{ show: true, max: TASK_LIMITS.title }}
            disabled={pending || !isEditable(task, "title")}
          />
        </Form.Item>
        <Form.Item
          label="Description"
          name="description"
          // A DONE Task keeps its title editable so a typo can be fixed, but
          // not its description: the description is the plan, and the work is
          // over (PLAN.md §7).
          extra={
            isEditable(task, "description")
              ? undefined
              : `The description cannot be changed on a ${task?.status} task.`
          }
        >
          <Input.TextArea
            rows={4}
            placeholder="Optional detail"
            count={{ show: true, max: TASK_LIMITS.description }}
            disabled={pending || !isEditable(task, "description")}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}

/** A Task as the inputs hold it: no description is the empty text area. */
function valuesOf(task: Task): TaskFormValues {
  return { title: task.title, description: task.description ?? "" };
}

/**
 * Whether the form may offer `field`. A new Task has no Status yet and nothing
 * to protect, so everything is open; an existing one answers by the whitelist —
 * the same predicate the API enforces, so no enabled input can produce a
 * `FIELD_NOT_EDITABLE`.
 */
function isEditable(task: Task | undefined, field: (typeof FIELDS)[number]) {
  return task === undefined || canEdit(task.status, field);
}

/**
 * The fields this edit actually changes, which is what gets sent.
 *
 * Sending the whole form instead would name every field on every save, and a
 * field the Task's Status has closed would then be refused even when the
 * person had not touched it. A disabled input still holds the Task's own value,
 * so it never appears here.
 */
function changedFields(
  task: Task,
  edited: UpdateTaskInput,
): TaskEditVariables["changes"] {
  const changes: TaskEditVariables["changes"] = {};

  if (edited.title !== undefined && edited.title !== task.title) {
    changes.title = edited.title;
  }

  if (
    edited.description !== undefined &&
    edited.description !== task.description
  ) {
    changes.description = edited.description;
  }

  return changes;
}
