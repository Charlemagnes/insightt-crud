"use client";

import type { TaskStatus } from "@insightt/shared";
import { Tag } from "antd";

import { ALL_STATUSES, type StatusFilter } from "@/api/tasks";

/**
 * How each Status reads to a person. The enum values are the wire's spelling,
 * not a label — `IN_PROGRESS` shouted in a table cell is the database leaking
 * into the interface.
 *
 * Exported because the Status filter offers the same words, and a second
 * mapping would let a tag and the option that selects it disagree about what
 * the Status is called.
 *
 * `ALL_STATUSES` is in here for that reason and no other: it is the one thing
 * the filter offers that is not a Status, and leaving it out would mean the
 * control read four of its five labels from one place and wrote the fifth
 * itself. No tag ever renders it — a Task is never in it.
 */
export const STATUS_LABELS: Record<StatusFilter, string> = {
  [ALL_STATUSES]: "All",
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
