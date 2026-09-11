"use client";

import type { Task } from "@insightt/shared";
import { Table, Tag, Typography, type TableProps } from "antd";
import type { ReactNode } from "react";

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
    // A plain Tag until `TaskStatusTag` arrives with the transition tickets and
    // gives each Status its colour and its label.
    render: (status: Task["status"]) => <Tag>{status.replaceAll("_", " ")}</Tag>,
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
  /**
   * What an empty list offers to do next. The screen supplies it, so the table
   * renders Tasks and does not also have to know how one is created.
   */
  emptyAction?: ReactNode;
}

/**
 * The list. Ordering is fixed at newest-first and comes from the API, so no
 * column sorts client-side — a sortable column would reorder one page and
 * silently lie about the rest.
 */
export function TaskTable({ tasks, loading, emptyAction }: TaskTableProps) {
  return (
    <Table<Task>
      rowKey="id"
      columns={columns}
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
