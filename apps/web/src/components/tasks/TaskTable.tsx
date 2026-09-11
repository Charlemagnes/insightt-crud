"use client";

import { TASK_PAGE, type Task } from "@insightt/shared";
import { Table, Typography, type TableProps } from "antd";
import type { ReactNode } from "react";

import { EmptyState } from "@/components/shared/EmptyState";
import { TaskActions } from "@/components/tasks/TaskActions";
import { TaskStatusTag } from "@/components/tasks/TaskStatusTag";
import { useTaskListStore } from "@/stores/taskList";

const { Text } = Typography;

/**
 * The sizes the pager offers. Both ends come off the shared rule rather than
 * being typed here, so no option can ask for a page the API refuses — a size
 * selector that offered 250 would produce a `422` on a control the UI itself
 * put there.
 */
const PAGE_SIZES = [TASK_PAGE.defaultSize, 20, 50, TASK_PAGE.maxSize];

/**
 * The columns, built around the one callback a row needs. A function rather
 * than a constant because the Actions cell has to reach the screen's edit
 * state, and threading it through `Table` as anything else would mean the
 * column list knowing about the screen.
 */
const columnsFor = (
  onEdit: (task: Task) => void,
): NonNullable<TableProps<Task>["columns"]> => [
  {
    title: "Title",
    dataIndex: "title",
    key: "title",
    render: (title: string) => <Text strong>{title}</Text>,
  },
  {
    title: "Status",
    dataIndex: "status",
    key: "status",
    width: 160,
    render: (status: Task["status"]) => <TaskStatusTag status={status} />,
  },
  {
    title: "Created",
    dataIndex: "createdAt",
    key: "createdAt",
    width: 200,
    render: (createdAt: string) => new Date(createdAt).toLocaleString(),
  },
  {
    title: "Actions",
    key: "actions",
    // Wide enough for every control a row shows — the disabled ones take up
    // the same space as the enabled ones.
    width: 420,
    // The whole Task, not one field: which controls a row offers is a question
    // about its Status, and the mutations address it by id.
    render: (_: unknown, task: Task) => (
      <TaskActions task={task} onEdit={onEdit} />
    ),
  },
];

interface TaskTableProps {
  tasks: Task[];
  /**
   * How many Tasks the filter matches in total — every page of them, not the
   * length of `tasks`. It is the number the pager sizes itself from, and only
   * the server knows it.
   */
  total: number;
  loading: boolean;
  /** What an empty list says, which depends on whether a filter is narrowing it. */
  emptyDescription: string;
  /**
   * What an empty list offers to do next. The screen supplies it, so the table
   * renders Tasks and does not also have to know how one is created.
   */
  emptyAction?: ReactNode;
  /** Opens the edit form on a row's Task. */
  onEdit: (task: Task) => void;
}

/**
 * The list, one server-side page of it.
 *
 * Ordering is fixed at newest-first and comes from the API, so no column sorts
 * client-side — a sortable column would reorder one page and silently lie about
 * the rest. Paging is server-side for the same reason: `dataSource` is one page
 * and `total` is the whole result set, so Ant Design draws the pager without
 * ever being given the rows to slice.
 *
 * It reads `page` and `pageSize` from the store rather than taking them as
 * props, because those are the same two values that formed the query key the
 * rows arrived under — a prop path would be a second route for them to travel
 * and a second chance for the pager and the request to disagree.
 */
export function TaskTable({
  tasks,
  total,
  loading,
  emptyDescription,
  emptyAction,
  onEdit,
}: TaskTableProps) {
  const page = useTaskListStore((state) => state.page);
  const pageSize = useTaskListStore((state) => state.pageSize);
  const goToPage = useTaskListStore((state) => state.goToPage);

  return (
    <Table<Task>
      rowKey="id"
      columns={columnsFor(onEdit)}
      dataSource={tasks}
      // Ant Design's overlay dims the rows underneath rather than replacing
      // them, which is what turns `keepPreviousData` into a visible "loading
      // the next page" instead of a table that empties and reflows.
      loading={loading}
      pagination={{
        current: page,
        pageSize,
        total,
        showSizeChanger: true,
        pageSizeOptions: PAGE_SIZES,
        showTotal: (count, [from, to]) =>
          count === 0 ? "No tasks" : `${from}–${to} of ${count} tasks`,
        onChange: goToPage,
      }}
      locale={{
        emptyText: (
          <EmptyState description={emptyDescription} action={emptyAction} />
        ),
      }}
    />
  );
}
