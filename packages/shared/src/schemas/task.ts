import { z } from "zod";

/**
 * A Task's position in the lifecycle (CONTEXT.md, "Status"). The machine is
 * strictly linear — `PENDING -> IN_PROGRESS -> DONE -> ARCHIVED` — and the
 * rules that enforce it live in `rules/transitions.ts`.
 */
export const TaskStatus = z.enum([
  "PENDING",
  "IN_PROGRESS",
  "DONE",
  "ARCHIVED",
]);
export type TaskStatus = z.infer<typeof TaskStatus>;

/**
 * The wire shape of a Task. camelCase, and timestamps are ISO strings rather
 * than `Date`, so the same schema parses on both sides of the wire without a
 * JSON round trip losing anything (PLAN.md §11).
 *
 * This is deliberately not derived from the Drizzle table. Drizzle types
 * describe DB rows and stay inside `apps/api`; `apps/api/src/tasks/mappers.ts`
 * is the seam between the two layers.
 */
export const TaskSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  description: z.string().nullable(),
  status: TaskStatus,
  version: z.number().int(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
});
export type Task = z.infer<typeof TaskSchema>;

/**
 * The list envelope: `{ items, page, pageSize, total }`. Offset pagination,
 * because Ant Design's `Table` needs a total count to render its pager.
 */
export function paginated<Item extends z.ZodType>(item: Item) {
  return z.object({
    items: z.array(item),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
    total: z.number().int().min(0),
  });
}

export const TaskPageSchema = paginated(TaskSchema);
export type TaskPage = z.infer<typeof TaskPageSchema>;

/**
 * The `GET /api/tasks` query string. `z.coerce` because a query string arrives
 * as text — `?page=2` is `"2"` until something says otherwise.
 *
 * `status` has no default: an unfiltered list shows every Status, Archived
 * included. Archived is a Status, not a soft delete (CONTEXT.md, "Archived").
 */
export const TaskListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  // Capped so a caller cannot ask for the whole table in one round trip.
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  status: TaskStatus.optional(),
});
export type TaskListQuery = z.infer<typeof TaskListQuery>;

/**
 * The `:id` path parameter, parsed as a UUID. This is what keeps a malformed
 * id from reaching Postgres, where `where id = 'nonsense'` is a type error and
 * would surface as `500`. Parsed here it is simply a Task that does not exist,
 * which is the truth, and it is reported as `404` — the same answer a Task
 * owned by someone else gets, so neither leaks existence.
 */
export const TaskIdParam = z.object({ id: z.uuid() });
export type TaskIdParam = z.infer<typeof TaskIdParam>;
