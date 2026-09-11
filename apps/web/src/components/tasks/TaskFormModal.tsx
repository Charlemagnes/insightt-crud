"use client";

import {
  CreateTaskInput,
  TASK_LIMITS,
  type CreateTaskDraft,
} from "@insightt/shared";
import { App, Form, Input, Modal } from "antd";

import { ApiError } from "@/api/client";
import {
  attachIssues,
  attachZodErrors,
  clearFieldErrors,
  issuesIn,
} from "@/forms/zodFieldErrors";
import { useCreateTask } from "@/hooks/useTaskMutations";

/**
 * The inputs this form has, taken from the schema rather than listed again.
 * Spelling them a second time is how a renamed field quietly stops being
 * marked when it is the one that failed.
 */
const FIELDS = Object.keys(CreateTaskInput.shape) as (keyof CreateTaskDraft)[];

/**
 * Empty strings rather than `undefined`, so a submit with nothing typed is
 * rejected by the rule that reads "Title is required" instead of by the one
 * about a value of the wrong type.
 */
const BLANK: CreateTaskDraft = { title: "", description: "" };

interface TaskFormModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * The create form. Validation is the shared schema's, run on submit and
 * attached to the fields by `attachZodErrors` — the browser and the API
 * therefore apply the same rules to the same text, and the API applies them
 * again regardless.
 *
 * On failure the modal stays open with everything typed still in it. A create
 * that was refused is a create worth retrying, and the text is the part that
 * cost the person something.
 */
export function TaskFormModal({ open, onClose }: TaskFormModalProps) {
  const [form] = Form.useForm<CreateTaskDraft>();
  const { message } = App.useApp();
  const create = useCreateTask();

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
    if (create.isPending) return;

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
      showFailure(error);
    }
  }

  /**
   * The API validates independently of the browser, so a `422` here means the
   * two disagreed — a rule only the server has, or a schema that has drifted.
   * Its issues carry the same paths the local parse does, so they mark the same
   * fields rather than arriving as a toast about a field the person cannot see.
   */
  function showFailure(error: unknown) {
    if (error instanceof ApiError && error.code === "VALIDATION_FAILED") {
      report(attachIssues(form, issuesIn(error.details), FIELDS), error.message);
      return;
    }

    message.error(
      error instanceof Error ? error.message : "Could not create the task",
    );
  }

  return (
    <Modal
      open={open}
      title="New task"
      okText="Create"
      // One flight at a time: the button spins and stops accepting clicks, so a
      // second press cannot produce a second Task.
      okButtonProps={{ loading: create.isPending }}
      cancelButtonProps={{ disabled: create.isPending }}
      onOk={() => void submit()}
      onCancel={close}
      // The text is only worth keeping while the modal is open; a reopened form
      // starting on the last abandoned draft would be a surprise.
      destroyOnHidden
      maskClosable={!create.isPending}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={BLANK}
        onValuesChange={(changed: Partial<CreateTaskDraft>) =>
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
            disabled={create.isPending}
          />
        </Form.Item>
        <Form.Item label="Description" name="description">
          <Input.TextArea
            rows={4}
            placeholder="Optional detail"
            count={{ show: true, max: TASK_LIMITS.description }}
            disabled={create.isPending}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
