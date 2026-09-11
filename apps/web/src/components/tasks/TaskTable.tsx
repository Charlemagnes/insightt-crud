"use client";

import { TASK_PAGE, type Task } from "@insightt/shared";
import { Button, Table, Typography, type TableProps } from "antd";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { ReactNode } from "react";

import { EmptyState } from "@/components/shared/EmptyState";
import { TaskActions } from "@/components/tasks/TaskActions";
import { TaskStatusTag } from "@/components/tasks/TaskStatusTag";
import { useTaskListStore } from "@/stores/taskList";

const { Paragraph, Text } = Typography;

/**
 * The sizes the pager offers. The two that carry a rule — the default the API
 * serves when asked for nothing, and the cap it refuses beyond — come off
 * `TASK_PAGE` rather than being typed here, so no option can ask for a page the
 * API answers with `422`. The steps between them are only steps.
 */
const PAGE_SIZES = [TASK_PAGE.defaultSize, 10, 50, TASK_PAGE.maxSize];

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
    // Declared rather than left to take whatever the other columns do not
    // want: a title is the thing a row is scanned by, and the leftover was
    // narrow enough to wrap most of them onto a second line.
    width: 180,
    // A long title is cut with an ellipsis instead of wrapping, so every row
    // is one line tall and the column cannot stretch the table. `ellipsis` on
    // any column also switches the table to a fixed layout, which is what
    // makes the widths above hold.
    ellipsis: true,
    // The full title on hover, because the cell only ever shows the start of
    // a long one — and the description behind the row's expander is the other
    // half of the same answer.
    render: (title: string) => (
      <Text strong title={title}>
        {title}
      </Text>
    ),
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
    // Three icon buttons wide. A row offers Edit, one Next, and Delete
    // whatever its Status, so the column never has to grow for a wordier
    // control than the last.
    width: 160,
    // Centred on both the header and the cells, so the three icons sit under
    // the word that names them rather than hard against the column's edge.
    align: "center",
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
      bordered={true}
      // Ant Design's overlay dims the rows underneath rather than replacing
      // them, which is what turns `keepPreviousData` into a visible "loading
      // the next page" instead of a table that empties and reflows.
      loading={loading}
      // The description, one row at a time. It is the only field of a Task the
      // list does not otherwise show, and it is the long one — a column of it
      // would either be cut to uselessness or make every row as tall as the
      // wordiest. Behind an expander it costs nothing until someone asks.
      //
      // `rowExpandable` keeps the control off a Task that has no description:
      // an expander that opens onto nothing is a promise the row cannot keep.
      // Ant Design still reserves the cell, so the rows stay aligned.
      expandable={{
        columnWidth: 48,
        rowExpandable: (task) => task.description !== null,
        // A chevron pointing the way the row will move: down to open the
        // description, up to close it again. Ant Design's default is a boxed
        // plus/minus, which reads as add and remove rather than show and hide.
        //
        // A row with no description gets nothing rather than an inert chevron.
        // The cell is still drawn at `columnWidth`, so the rows stay aligned.
        expandIcon: ({ expanded, onExpand, record, expandable }) =>
          expandable ? (
            <Button
              type="text"
              size="small"
              aria-label={expanded ? "Hide description" : "Show description"}
              aria-expanded={expanded}
              icon={
                expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />
              }
              onClick={(event) => onExpand(record, event)}
            />
          ) : null,
        expandedRowRender: (task) => (
          <Paragraph
            // The text is whatever someone typed, newlines included, and the
            // form stored it verbatim. `pre-wrap` shows it back the same way.
            style={{ whiteSpace: "pre-wrap", margin: 0 }}
          >
            {task.description}
          </Paragraph>
        ),
      }}
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
