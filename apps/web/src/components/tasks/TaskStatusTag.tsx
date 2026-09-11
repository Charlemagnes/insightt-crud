"use client";

import type { TaskStatus } from "@insightt/shared";
import { Tag } from "antd";

/**
 * How each Status reads to a person. The enum values are the wire's spelling,
 * not a label — `IN_PROGRESS` shouted in a table cell is the database leaking
 * into the interface.
 *
 * Exported because the Status filter offers the same four words, and a second
 * mapping would let a tag and the option that selects it disagree about what
 * the Status is called.
 */
export const STATUS_LABELS: Record<TaskStatus, string> = {
  PENDING: "Pending",
  IN_PROGRESS: "In progress",
  DONE: "Done",
  ARCHIVED: "Archived",
};

/**
 * Colour carries the lifecycle: nothing yet, something happening, something
 * finished, something put away. `processing` is the one that animates, which
 * is the only Status where that is true of the Task as well.
 */
const COLOURS: Record<TaskStatus, string> = {
  PENDING: "default",
  IN_PROGRESS: "processing",
  DONE: "success",
  ARCHIVED: "purple",
};

/** A Task's Status, as a reader sees it. */
export function TaskStatusTag({ status }: { status: TaskStatus }) {
  return <Tag color={COLOURS[status]}>{STATUS_LABELS[status]}</Tag>;
}
