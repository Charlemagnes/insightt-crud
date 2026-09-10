"use client";

import type { Task } from "@insightt/shared";
import { Table, Tag, Typography, type TableProps } from "antd";

import { EmptyState } from "@/components/shared/EmptyState";

const { Text } = Typography;

const columns: NonNullable<TableProps<Task>["columns"]> = [
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
    render: (status: Task["status"]) => <Tag>{status.replace("_", " ")}</Tag>,
  },
  {
    title: "Created",
    dataIndex: "createdAt",
    key: "createdAt",
    width: 200,
    render: (createdAt: string) => new Date(createdAt).toLocaleString(),
  },
];

interface TaskTableProps {
  tasks: Task[];
  loading: boolean;
}

/**
 * The list. Ordering is fixed at newest-first and comes from the API, so no
 * column sorts client-side — a sortable column would reorder one page and
 * silently lie about the rest.
 */
export function TaskTable({ tasks, loading }: TaskTableProps) {
  return (
    <Table<Task>
      rowKey="id"
      columns={columns}
      dataSource={tasks}
      loading={loading}
      pagination={false}
      locale={{
        emptyText: <EmptyState description="No tasks yet." />,
      }}
    />
  );
}
