"use client";

import { TASK_PAGE, TaskSortField, type Task } from "@insightt/shared";
import { Button, Table, Typography, type TableProps } from "antd";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { ReactNode } from "react";

import { EmptyState } from "@/components/shared/EmptyState";
import { TaskActions } from "@/components/tasks/TaskActions";
import { TaskStatusTag } from "@/components/tasks/TaskStatusTag";
import { useTaskListStore, type TaskSort } from "@/stores/taskList";

const { Paragraph, Text } = Typography;

/**
 * The sizes the pager offers. The two that carry a rule — the default the API
 * serves when asked for nothing, and the cap it refuses beyond — come off
 * `TASK_PAGE` rather than being typed here, so no option can ask for a page the
 * API answers with `422`. The steps between them are only steps.
 */
const PAGE_SIZES = [TASK_PAGE.defaultSize, 10, 50, TASK_PAGE.maxSize];

/**
 * The two spellings of a sort direction, and the translation between them. The
 * wire says `asc`/`desc` because that is what an `ORDER BY` says; Ant Design
 * says `ascend`/`descend`. Neither is wrong and neither is going to change, so
 * the mapping is written once here rather than at each of the three places a
 * direction crosses the boundary.
 */
const ANTD_ORDER: Record<TaskSort["direction"], NonNullable<SortOrder>> = {
  asc: "ascend",
  desc: "descend",
};

const WIRE_DIRECTION: Record<NonNullable<SortOrder>, TaskSort["direction"]> = {
  ascend: "asc",
  descend: "desc",
};

/**
 * Ant Design's own `SortOrder`, reached through the props rather than a deep
 * import into `antd/es/table/interface`. Only `undefined` is excluded: `null`
 * is a value the type carries and the one that means "this column is not the
 * sorted one".
 */
type SortOrder = Exclude<
  NonNullable<TableProps<Task>["columns"]>[number]["sortOrder"],
  undefined
>;

/** The `onChange` argument the handler below reads. */
type ChangeSorter = Parameters<NonNullable<TableProps<Task>["onChange"]>>[2];

/**
 * The sort a `Table` change is reporting, or `null` for no sort at all.
 *
 * `null` is a real answer here and not a failure to read one: Ant Design's
 * header cycles ascending, descending, and then *cleared*, and the third click
 * is how a person puts the list back the way they found it. It arrives with
 * the column key, the field and the order all blanked, which is why nothing
 * below reaches for the column it used to name.
 *
 * The sorter is either one result or an array of them — the array is for
 * multi-column sorting, which this table does not offer.
 */
function sortFromChange(sorter: ChangeSorter): TaskSort | null {
  const { columnKey, order } = Array.isArray(sorter)
    ? (sorter[0] ?? {})
    : sorter;

  if (!order) return null;

  // The key is `Key | undefined` as far as the types know. Parsing rather than
  // casting is what keeps a column key that stops being a sortable field an
  // unsorted list instead of a `422` from the API.
  const field = TaskSortField.safeParse(columnKey);

  return field.success
    ? { field: field.data, direction: WIRE_DIRECTION[order] }
    : null;
}

/**
 * The columns, built around the one callback a row needs and the sort currently
 * in force. A function rather than a constant because the Actions cell has to
 * reach the screen's edit state, and threading it through `Table` as anything
 * else would mean the column list knowing about the screen.
 *
 * The sort is passed in rather than left to Ant Design's own bookkeeping: every
 * sortable column below is `sorter: true`, which means "the server did this",
 * and a controlled `sortOrder` is what stops the header's arrow from claiming
 * an order the rows on screen were not fetched in.
 *
 * `sortDirections` is left at Ant Design's default, because its default cycle
 * is the one wanted: ascending, descending, then no sort at all.
 */
const columnsFor = (
  onEdit: (task: Task) => void,
  sort: TaskSort | null,
): NonNullable<TableProps<Task>["columns"]> => {
  /**
   * The arrow this column shows: one at most, on the column the rows are
   * sorted by, and none at all while the list is unsorted.
   */
  const orderOf = (field: TaskSortField): SortOrder =>
    field === sort?.field ? ANTD_ORDER[sort.direction] : null;

  return [
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
      // `true`, not a comparator: the rows are one server-side page, so the
      // sorting happens in the `ORDER BY` and the header only says so.
      sorter: true,
      sortOrder: orderOf("title"),
    },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      width: 160,
      render: (status: Task["status"]) => <TaskStatusTag status={status} />,
      // Sorted by the lifecycle rather than by the alphabet — the Postgres enum
      // orders by the order its values were declared, so ascending runs Pending
      // to Archived, which is the order the column means.
      sorter: true,
      sortOrder: orderOf("status"),
    },
    {
      title: "Created",
      dataIndex: "createdAt",
      key: "createdAt",
      width: 200,
      render: (createdAt: string) => new Date(createdAt).toLocaleString(),
      sorter: true,
      sortOrder: orderOf("createdAt"),
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
};

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
 * Sorting and paging are both the server's: `dataSource` is one page and
 * `total` is the whole result set, so Ant Design draws the pager and the sort
 * arrows without ever being given the rows to slice or reorder. A column that
 * sorted client-side would reorder the page on screen and silently lie about
 * every other one.
 *
 * It reads `page`, `pageSize` and `sort` from the store rather than taking them
 * as props, because those are the same values that formed the query key the
 * rows arrived under — a prop path would be a second route for them to travel
 * and a second chance for the header and the request to disagree.
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
  const sort = useTaskListStore((state) => state.sort);
  const goToPage = useTaskListStore((state) => state.goToPage);
  const sortBy = useTaskListStore((state) => state.sortBy);

  return (
    <Table<Task>
      rowKey="id"
      columns={columnsFor(onEdit, sort)}
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
      // Sorting arrives here rather than through a prop of its own, because
      // `onChange` is the only place Ant Design reports a header click. Paging
      // keeps its own `pagination.onChange`: this fires for a page turn too,
      // carrying the sort already in force, and acting on that would send a
      // redundant request and put the person back on page one.
      onChange={(_pagination, _filters, sorter, extra) => {
        if (extra.action === "sort") sortBy(sortFromChange(sorter));
      }}
      // On, and left to Ant Design's own wording: the cycle has three steps, so
      // "click to sort descending" and "click to cancel sorting" are worth
      // saying — the arrows alone do not tell you the third click exists.
      showSorterTooltip={true}
      locale={{
        emptyText: (
          <EmptyState description={emptyDescription} action={emptyAction} />
        ),
      }}
    />
  );
}
