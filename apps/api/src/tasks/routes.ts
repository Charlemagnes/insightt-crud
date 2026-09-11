import {
  canEdit,
  changedFields,
  CreateTaskInput,
  EDITABLE_FIELDS,
  TaskIdParam,
  TaskListQuery,
  UpdateTaskInput,
  type EditableField,
  type Task,
  type TaskPage,
  type TaskStatus,
} from "@insightt/shared";
import type { Request, Response } from "express";
import { Router } from "express";

import { actorOf } from "@/middleware/auth";
import { ApiError } from "@/middleware/errors";
import { validate } from "@/middleware/validate";
import type {
  Refused,
  TaskRepository,
  UpdateResult,
} from "@/tasks/repository";

const listValidator = validate({ query: TaskListQuery });
const taskIdValidator = validate({ params: TaskIdParam });
const createValidator = validate({ body: CreateTaskInput });
const updateValidator = validate({ params: TaskIdParam, body: UpdateTaskInput });

/**
 * The Task routes, mounted behind the auth stack — so `actorOf` always has an
 * Actor, and every query below is Owner-scoped by construction.
 *
 * Handlers may be async without a `try`/`catch`: Express 5 forwards a rejected
 * promise to the error middleware.
 */
export function createTaskRoutes(repository: TaskRepository): Router {
  const router = Router();

  router.get("/", listValidator, async (req, res) => {
    const { page, pageSize, status } = listValidator.read(req).query;

    const { items, total } = await repository.list({
      userId: actorOf(req).userId,
      page,
      pageSize,
      status,
    });

    const body: TaskPage = { items, page, pageSize, total };
    res.json(body);
  });

  router.get("/:id", taskIdValidator, async (req, res) => {
    const { id } = taskIdValidator.read(req).params;

    const task = await repository.findById({
      userId: actorOf(req).userId,
      id,
    });

    // Missing and not-owned arrive here as the same `null`, and leave as the
    // same `404`. A `403` would confirm that someone else's Task exists.
    if (!task) {
      throw new ApiError(404, "NOT_FOUND", "Task not found");
    }

    sendTask(res, task);
  });

  router.post("/", createValidator, async (req, res) => {
    const { title, description } = createValidator.read(req).body;

    const created = await repository.create({
      userId: actorOf(req).userId,
      title,
      // Omitted and blank are the same absence, and they are stored as the same
      // `null`. Passing `undefined` through would let the column default decide
      // what "no description" means in a second place.
      description: description ?? null,
    });

    // `201`, with the Task the client did not have all of: it is the id and the
    // Version that the next edit needs, and neither existed until now.
    res.status(201);
    sendTask(res, created);
  });

  router.patch("/:id", updateValidator, async (req, res) => {
    const { params, body: changes } = updateValidator.read(req);
    const userId = actorOf(req).userId;

    // Before anything is read or written: an edit that names no Version is not
    // a request that can be answered safely, only one that would clobber.
    const expectedVersion = requiredVersionOf(req);

    // The whitelist and the no-op check both need the Task, so an edit costs a
    // read before it writes.
    const task = await repository.findById({ userId, id: params.id });

    if (!task) {
      throw new ApiError(404, "NOT_FOUND", "Task not found");
    }

    // The Version first, and before any rule that is read off the Task.
    //
    // Both checks below answer questions about a *particular* Task, and the one
    // just read is only the caller's Task if the Version still matches. Asking
    // them first would report a Task the caller has not seen: an edit written
    // against a `PENDING` Task that has since gone `DONE` would come back
    // `422 FIELD_NOT_EDITABLE`, about a Status the caller never saw, when the
    // truth is that their copy is stale. That is `412`, and `412` is what the
    // frontend refreshes on.
    assertCurrent(task, expectedVersion);
    assertEditable(task, changes);
    assertChangesSomething(task, changes);

    const result = await repository.update({
      userId,
      id: params.id,
      expectedVersion,
      changes,
    });

    // The Version was checked above and is checked again in the `WHERE` of the
    // statement itself. The first is what makes the refusals honest; this one
    // is what makes the write safe, and it closes the window the read opened.
    if (result.outcome !== "changed") {
      throw editRefusalOf(result);
    }

    // The new Version rides back as the ETag, so the next edit from this tab
    // has a fresh `If-Match` and never has to re-read to get one.
    sendTask(res, result.task);
  });

  // No `If-Match`, unlike `PATCH`, and no Status guard, unlike the Transitions
  // below — see `TaskRepository.delete` for why neither belongs here.
  router.delete("/:id", taskIdValidator, async (req, res) => {
    const deleted = await repository.delete({
      userId: actorOf(req).userId,
      id: taskIdValidator.read(req).params.id,
    });

    // Which covers a second delete of the same Task as well as one that was
    // never the Actor's.
    if (!deleted) {
      throw new ApiError(404, "NOT_FOUND", "Task not found");
    }

    // `204`, and no `ETag`: there is no Task left to carry a Version, and a
    // body describing one would describe something that no longer exists.
    res.status(204).end();
  });

  // No request body on any Transition endpoint: the target Status is in the
  // path, so there is nothing to validate and nothing a client can contradict.
  router.post("/:id/start", taskIdValidator, async (req, res) => {
    const result = await repository.start({
      userId: actorOf(req).userId,
      id: taskIdValidator.read(req).params.id,
    });

    if (result.outcome !== "changed") {
      throw refusalOf(result, "IN_PROGRESS");
    }

    sendTask(res, result.task);
  });

  router.post("/:id/done", taskIdValidator, async (req, res) => {
    const result = await repository.markDone({
      userId: actorOf(req).userId,
      id: taskIdValidator.read(req).params.id,
    });

    if (result.outcome === "not_found" || result.outcome === "wrong_status") {
      throw refusalOf(result, "DONE");
    }

    // A Replay is a success — the Task is Done, which is what was asked for.
    // The header is how a client tells a Replay from the request that did the
    // work; CORS exposes it so the browser can read it (PLAN.md §10).
    if (result.outcome === "replayed") {
      res.setHeader("X-Idempotent-Replay", "true");
    }

    sendTask(res, result.task);
  });

  router.post("/:id/archive", taskIdValidator, async (req, res) => {
    const result = await repository.archive({
      userId: actorOf(req).userId,
      id: taskIdValidator.read(req).params.id,
    });

    if (result.outcome !== "changed") {
      throw refusalOf(result, "ARCHIVED");
    }

    // `200` with the Task, not `204`: the Task is still there. Archiving is a
    // Transition, not a delete, and the Archived Task goes on appearing in the
    // list alongside every other one (CONTEXT.md, "Archived").
    sendTask(res, result.task);
  });

  return router;
}

/**
 * The failure a refused Transition is reported as.
 *
 * The two are different failures and the frontend branches on them: `404`
 * means there is no such Task for this Actor, `409` means the Task is real but
 * is not somewhere the move is legal. Neither reveals anything about a Task
 * someone else owns — `404` is also the answer for one that exists.
 */
function refusalOf(result: Refused, to: TaskStatus): ApiError {
  if (result.outcome === "not_found") {
    return new ApiError(404, "NOT_FOUND", "Task not found");
  }

  return new ApiError(
    409,
    "INVALID_TRANSITION",
    `A ${result.task.status} Task cannot be moved to ${to}`,
  );
}

/**
 * The Version an edit claims the Task is at, from `If-Match`.
 *
 * Absent is `428 PRECONDITION_REQUIRED` and not `412`: the caller has not made
 * a stale claim, they have made no claim at all. The two are different mistakes
 * with different fixes: one has to send the header, the other has to re-read the
 * Task and try again.
 *
 * An `If-Match` that is not a Version this API could have issued — a weak tag,
 * a wildcard, anything unquoted — is left to fail the comparison rather than
 * rejected here. No Task is at a Version that cannot be written down, so it can
 * only ever be stale, and `412` is the honest answer.
 *
 * `*` is the deliberate deviation in that: RFC 9110 defines it as matching any
 * existing representation, which would make it a success. An edit that says
 * "whatever Version it is on, write anyway" is the clobbering this endpoint
 * exists to refuse, so it is answered `412` like any other tag naming no
 * Version. PLAN.md §6 records it.
 */
function requiredVersionOf(req: Request): number {
  const header = req.get("If-Match");

  if (header === undefined) {
    throw new ApiError(
      428,
      "PRECONDITION_REQUIRED",
      "This edit needs an If-Match header carrying the Task's version",
    );
  }

  // The quoting is `ETag`'s, and `If-Match` is compared verbatim, so the quotes
  // are part of what was sent and have to come off before the number is read.
  const version = Number(/^"(\d+)"$/.exec(header)?.[1]);

  return Number.isInteger(version) ? version : UNMATCHABLE_VERSION;
}

/**
 * A Version no Task is at, which is what an unreadable `If-Match` becomes. It
 * is negative because `version` starts at 1 and only rises, so nothing can
 * reach it and no check below can match.
 *
 * A sentinel rather than `null` and an early `412`, because an early refusal
 * would answer before the Task had been found — and a `412` for a Task that
 * does not exist, or belongs to someone else, would confirm the existence that
 * every other answer here is careful not to. Carried this way, an unreadable
 * precondition against someone else's Task is the same `404` as anything else.
 */
const UNMATCHABLE_VERSION = -1;

/**
 * Refuses an edit written against a Version the Task has moved past.
 *
 * This is the same comparison the guarded `UPDATE` makes, asked early so that
 * the rules below are applied to the Task the caller actually read. It does not
 * replace the one in the statement: between this and the write the Task can
 * still move, and only the `WHERE` can refuse that.
 */
function assertCurrent(task: Task, expectedVersion: number): void {
  if (task.version !== expectedVersion) {
    throw new ApiError(
      412,
      "VERSION_CONFLICT",
      "This task changed since you loaded it",
    );
  }
}

/**
 * Refuses an edit that names a field the Task's Status has closed.
 *
 * The whitelist is `canEdit` in `@insightt/shared` — the same answer the Edit
 * control asks before it renders an input — so the API and the form cannot
 * disagree about what a `DONE` Task will accept.
 *
 * `422 FIELD_NOT_EDITABLE`, not `409 INVALID_TRANSITION`: nothing about this is
 * a Transition. The Task is not being asked to move, it is being asked to
 * change a field that its Status has put beyond reach.
 */
function assertEditable(task: Task, changes: UpdateTaskInput): void {
  const closed = namedFields(changes).filter(
    (field) => !canEdit(task.status, field),
  );

  if (closed.length > 0) {
    throw new ApiError(
      422,
      "FIELD_NOT_EDITABLE",
      `A ${task.status} Task does not allow ${closed.join(" or ")} to be changed`,
      closed.map((field) => ({
        path: [field],
        message: `${field} cannot be changed on a ${task.status} Task`,
      })),
    );
  }
}

/**
 * Refuses an edit whose every field already holds the value it asks for.
 *
 * A Version is the record that a Task changed, and raising it for a write that
 * changed nothing would invalidate every other tab's `If-Match` over an edit
 * that happened. The empty body `{}` is refused one layer up, by the shared
 * schema; this is the same refusal for a body that is full but inert.
 */
function assertChangesSomething(task: Task, changes: UpdateTaskInput): void {
  if (Object.keys(changedFields(task, changes)).length === 0) {
    throw new ApiError(
      422,
      "VALIDATION_FAILED",
      "This edit would not change anything",
    );
  }
}

/**
 * The fields an edit names, in the whitelist's own order.
 *
 * Built by asking `EDITABLE_FIELDS` what is present rather than by reading the
 * body's keys, so a key the schema does not know about cannot reach the
 * whitelist check — `strictObject` has already refused one, and this is the
 * second lock on the same door.
 */
function namedFields(changes: UpdateTaskInput): EditableField[] {
  return EDITABLE_FIELDS.filter((field) => changes[field] !== undefined);
}

/**
 * The failure a refused edit is reported as.
 *
 * `412` and `404` are the whole vocabulary here, and neither is `409`: an edit
 * is not a Transition, so "that move is not allowed" is not an answer it can
 * get. The frontend branches on exactly this — `412` refreshes the list and
 * says so, `404` means the Task is gone.
 */
function editRefusalOf(
  result: Extract<UpdateResult, { outcome: "stale" | "not_found" }>,
): ApiError {
  if (result.outcome === "not_found") {
    return new ApiError(404, "NOT_FOUND", "Task not found");
  }

  return new ApiError(
    412,
    "VERSION_CONFLICT",
    "This task changed since you loaded it",
  );
}

/**
 * Sends a Task with the `ETag` its Version becomes. The frontend hands the tag
 * straight back as `If-Match` on the next edit, which is how a stale write is
 * refused with `412` instead of silently clobbering someone else's change.
 *
 * The tag is quoted because `ETag` is defined that way, and `If-Match` is
 * compared verbatim — an unquoted tag would never match the one sent back.
 * Express would otherwise compute a hash of the body here, which changes
 * whenever a field the Version does not cover changes, and so would not mean
 * what the precondition needs it to mean.
 */
function sendTask(res: Response, task: Task): void {
  res.setHeader("ETag", `"${task.version}"`);
  res.json(task);
}
