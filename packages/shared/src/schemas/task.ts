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
 * How long each text field may be.
 *
 * Exported because the create form counts characters against these as the
 * person types, and a form that carried its own copy would drift from the rule
 * that actually rejects the value. The schema below is the only enforcement;
 * this is what lets the UI say the same number without restating it.
 */
export const TASK_LIMITS = {
  title: 200,
  description: 2000,
} as const;

/**
 * A Task's title, as a client may submit it. Trimmed first, so the length
 * rules measure what will actually be stored: `"   "` is the empty title in
 * disguise, and a `min(1)` on the untrimmed string would wave it through.
 *
 * The messages are written for a person, because these are the strings the
 * create form shows under the field (`zodFieldErrors` in `apps/web`).
 */
const title = z
  .string()
  .trim()
  .min(1, "Title is required")
  .max(
    TASK_LIMITS.title,
    `Title must be ${TASK_LIMITS.title} characters or fewer`,
  );

/**
 * A Task's description, as a client may submit it.
 *
 * A blank description becomes `null` rather than `""`. An empty text area is
 * someone leaving the field alone, not someone asking for a description that is
 * the empty string, and storing both spellings would make "has a description"
 * two questions instead of one.
 *
 * `null` is accepted explicitly as well as by omission, because an edit needs a
 * way to say "clear this" that omitting the key cannot mean.
 */
const description = z
  .string()
  .trim()
  .max(
    TASK_LIMITS.description,
    `Description must be ${TASK_LIMITS.description} characters or fewer`,
  )
  .transform((value) => (value === "" ? null : value))
  .nullable();

/**
 * The body of `POST /api/tasks`.
 *
 * **`status` is absent, deliberately.** A Task is always created `PENDING` and
 * only ever moves through the dedicated transition endpoints, which is what
 * keeps `mark_task_done()` the single entrance to `DONE` that PLAN.md §8's
 * idempotency guarantee depends on. Adding `status` here would break it.
 *
 * `strictObject` is what makes that stick: a stray `status`, or a typo in a
 * field name, is a `422 VALIDATION_FAILED` rather than a key silently dropped
 * on the floor. A create that quietly ignored a Status would read, from the
 * outside, exactly like one that had honoured it.
 */
export const CreateTaskInput = z.strictObject({
  title,
  description: description.optional(),
});
/** What a handler receives: trimmed, with a blank description already `null`. */
export type CreateTaskInput = z.infer<typeof CreateTaskInput>;
/** What a client may send: the form's shape, before any of that has happened. */
export type CreateTaskDraft = z.input<typeof CreateTaskInput>;

/**
 * The body of `PATCH /api/tasks/:id`.
 *
 * Both fields are optional because an edit names what it is changing and leaves
 * everything else alone. What it may not do is name nothing at all: the
 * refinement below refuses `{}`, so a request that asks for no change is a
 * `422` rather than a Version raised for nothing.
 *
 * `description` accepts an explicit `null`, which is the one thing omitting the
 * key cannot mean. Omitted is "leave the description as it is"; `null` — and a
 * text area someone emptied, which the transform makes the same value — is
 * "clear it".
 *
 * **`status` is absent here too**, for the reason it is absent from
 * `CreateTaskInput`: the Transition endpoints are the only way a Task moves,
 * and `strictObject` turns a `status` key into a `422` instead of a field
 * quietly ignored.
 *
 * Which of the two fields an edit may actually name depends on the Task's
 * Status, and that whitelist is not expressible here — it needs the Task. It
 * lives in `rules/transitions.ts` as `canEdit`, and the API answers a violation
 * with `422 FIELD_NOT_EDITABLE`.
 */
export const UpdateTaskInput = z
  .strictObject({
    title: title.optional(),
    description: description.optional(),
  })
  .refine(
    (input) => input.title !== undefined || input.description !== undefined,
    // Pathless on purpose: it is the edit as a whole that is empty, and no
    // single field is at fault. `attachIssues` in `apps/web` reports an issue
    // it cannot place on a field rather than dropping it.
    { message: "An edit must change the title or the description" },
  );
/** What a handler receives: trimmed, with a blank description already `null`. */
export type UpdateTaskInput = z.infer<typeof UpdateTaskInput>;
/** What a client may send: the form's shape, before any of that has happened. */
export type UpdateTaskDraft = z.input<typeof UpdateTaskInput>;

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
 * How the list pages, as numbers rather than prose.
 *
 * Exported for the reason `TASK_LIMITS` is: the paginator offers page sizes and
 * has to offer ones the API will accept. A size selector carrying its own copy
 * of the cap would drift from the schema that actually rejects `?pageSize=250`,
 * and the drift would show up as a `422` on a control the UI itself offered.
 */
export const TASK_PAGE = {
  /** Where an unpaged list starts, and where a changed filter goes back to. */
  first: 1,
  defaultSize: 10,
  /** No request may ask for the whole table in a single round trip. */
  maxSize: 100,
} as const;

/**
 * The `GET /api/tasks` query string. `z.coerce` because a query string arrives
 * as text — `?page=2` is `"2"` until something says otherwise.
 *
 * `status` has no default, and leaving it out is not the same as asking for
 * everything: the list then shows every Status **except** `ARCHIVED`, because
 * an Archived Task is finished and put away (CONTEXT.md, "Archived"). It is
 * still a Status and not a soft delete — `?status=ARCHIVED` asks for those
 * Tasks by name, and is the only thing that shows them.
 */
export const TaskListQuery = z.object({
  page: z.coerce.number().int().min(TASK_PAGE.first).default(TASK_PAGE.first),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(TASK_PAGE.maxSize)
    .default(TASK_PAGE.defaultSize),
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
