import {
  CreateTaskInput,
  TaskIdParam,
  TaskListQuery,
  type Task,
  type TaskPage,
  type TaskStatus,
} from "@insightt/shared";
import type { Response } from "express";
import { Router } from "express";

import { actorOf } from "@/middleware/auth";
import { ApiError } from "@/middleware/errors";
import { validate } from "@/middleware/validate";
import type { Refused, TaskRepository } from "@/tasks/repository";

const listValidator = validate({ query: TaskListQuery });
const taskIdValidator = validate({ params: TaskIdParam });
const createValidator = validate({ body: CreateTaskInput });

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

  // No request body on either Transition endpoint: the target Status is in the
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
