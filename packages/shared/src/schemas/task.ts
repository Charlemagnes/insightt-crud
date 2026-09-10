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
