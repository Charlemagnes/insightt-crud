"use client";

import type { Task } from "@insightt/shared";
import { Table, Typography, type TableProps } from "antd";
import type { ReactNode } from "react";

import { EmptyState } from "@/components/shared/EmptyState";
import { TaskActions } from "@/components/tasks/TaskActions";
import { TaskStatusTag } from "@/components/tasks/TaskStatusTag";

const { Text } = Typography;

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
    width: 340,
    // The whole Task, not one field: which controls a row offers is a question
    // about its Status, and the mutations address it by id.
    render: (_: unknown, task: Task) => (
      <TaskActions task={task} onEdit={onEdit} />
    ),
  },
];

interface TaskTableProps {
  tasks: Task[];
  loading: boolean;
  /**
   * What an empty list offers to do next. The screen supplies it, so the table
   * renders Tasks and does not also have to know how one is created.
   */
  emptyAction?: ReactNode;
  /** Opens the edit form on a row's Task. */
  onEdit: (task: Task) => void;
}

/**
 * The list. Ordering is fixed at newest-first and comes from the API, so no
 * column sorts client-side — a sortable column would reorder one page and
 * silently lie about the rest.
 */
export function TaskTable({
  tasks,
  loading,
  emptyAction,
  onEdit,
}: TaskTableProps) {
  return (
    <Table<Task>
      rowKey="id"
      columns={columnsFor(onEdit)}
      dataSource={tasks}
      loading={loading}
      pagination={false}
      locale={{
        emptyText: (
          <EmptyState description="No tasks yet." action={emptyAction} />
        ),
      }}
    />
  );
}
