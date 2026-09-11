"use client";

import { TaskStatus } from "@insightt/shared";
import { Select, Space, Typography } from "antd";

import { ALL_STATUSES, type StatusFilter } from "@/api/tasks";
import { STATUS_LABELS } from "@/components/tasks/TaskStatusTag";
import { useTaskListStore } from "@/stores/taskList";

const { Text } = Typography;

/**
 * Everything the filter offers: every Status in lifecycle order, behind the one
 * value that asks for all of them.
 *
 * The Statuses come off `TaskStatus.options` rather than a list written here,
 * so one added to the machine appears in the filter without anyone remembering
 * to add it — and every label comes off `STATUS_LABELS`, including `ALL`, so
 * the control cannot call a Status something a tag does not.
 *
 * Archived is one of the options, and selecting it is the only way to see an
 * Archived Task: the list leaves them out until this control asks for them.
 */
const OPTIONS: { value: StatusFilter; label: string }[] = [
  ALL_STATUSES,
  ...TaskStatus.options,
].map((status) => ({ value: status, label: STATUS_LABELS[status] }));

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
      <Select<StatusFilter>
        value={status}
        options={OPTIONS}
        onChange={filterByStatus}
        style={{ width: 180 }}
        aria-label="Filter by status"
        // Five options do not need a windowed list, and virtualising them
        // costs something real: the `listbox` Ant Design exposes to assistive
        // technology mirrors the window rather than the options, so a screen
        // reader is offered whichever two happen to be scrolled into view.
        virtual={false}
      />
    </Space>
  );
}
