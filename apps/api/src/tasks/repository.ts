import type { Task } from "@insightt/shared";

/** What a list query needs to know. Every read is scoped to one Owner. */
export interface TaskListQuery {
  userId: string;
  page: number;
  pageSize: number;
}

/** One page of Tasks, plus the count the pager needs to size itself. */
export interface TaskListResult {
  items: Task[];
  total: number;
}

/**
 * The Task repository, named as an interface so the app factory can be handed
 * a fake. `apps/api` never imports a concrete repository above this line.
 *
 * It returns wire-shaped `Task` values, not Drizzle rows: the snake_case DB row
 * stops at `mappers.ts`, one layer below (PLAN.md §11).
 */
export interface TaskRepository {
  list(query: TaskListQuery): Promise<TaskListResult>;
}

/**
 * Stands in until the Postgres-backed repository lands. The list endpoint is
 * real, owner-scoped and authenticated today; what it has to list is nothing.
 */
export const emptyTaskRepository: TaskRepository = {
  async list(): Promise<TaskListResult> {
    return { items: [], total: 0 };
  },
};
