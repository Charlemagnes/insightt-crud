"use client";

import { TaskStatus } from "@insightt/shared";
import { Select, Space, Typography } from "antd";

import { STATUS_LABELS } from "@/components/tasks/TaskStatusTag";
import { useTaskListStore } from "@/stores/taskList";

const { Text } = Typography;

/**
 * The value that stands for "no filter". `null` is what the store and the API
 * both mean by it, but a `Select` reads `null` as nothing chosen and falls back
 * to its placeholder — which would leave the control blank rather than saying
 * what the unfiltered list is showing.
 */
const EVERY_STATUS = "ALL";

type FilterValue = typeof EVERY_STATUS | TaskStatus;

/**
 * The options, in lifecycle order, off `TaskStatus.options` rather than a list
 * written here — a Status added to the machine appears in the filter without
 * anyone remembering to add it.
 */
const OPTIONS: { value: FilterValue; label: string }[] = [
  { value: EVERY_STATUS, label: "All statuses" },
  ...TaskStatus.options.map((status) => ({
    value: status,
    label: STATUS_LABELS[status],
  })),
];

/**
 * Narrows the list to one Status (PLAN.md §6).
 *
 * It reads and writes the store directly rather than taking props: the filter
 * is view state, the store is where view state lives, and threading it through
 * the screen would only make the screen a relay. Changing it resets the page —
 * see `filterByStatus`.
 */
export function TaskFilters() {
  const status = useTaskListStore((state) => state.status);
  const filterByStatus = useTaskListStore((state) => state.filterByStatus);

  return (
    <Space size="small">
      <Text type="secondary">Status</Text>
      <Select<FilterValue>
        value={status ?? EVERY_STATUS}
        options={OPTIONS}
        onChange={(value) =>
          filterByStatus(value === EVERY_STATUS ? null : value)
        }
        style={{ width: 160 }}
        aria-label="Filter by status"
      />
    </Space>
  );
}
