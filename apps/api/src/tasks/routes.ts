import type { TaskPage } from "@insightt/shared";
import { Router } from "express";

import { actorOf } from "@/middleware/auth";
import type { TaskRepository } from "@/tasks/repository";

/**
 * Pagination defaults, standing in until the query string is validated. They
 * are the same two numbers `TaskListQuery` will carry as Zod `.default()`s in
 * `@insightt/shared`; when that lands these get deleted, not reconciled —
 * nothing in this repo is meant to be hand-typed twice (PLAN.md §11).
 */
const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 10;

/**
 * The Task routes, mounted behind the auth stack — so `actorOf` always has an
 * Actor, and every query below is owner-scoped by construction.
 *
 * Handlers may be async without a `try`/`catch`: Express 5 forwards a rejected
 * promise to the error middleware.
 */
export function createTaskRoutes(repository: TaskRepository): Router {
  const router = Router();

  router.get("/", async (req, res) => {
    const page = DEFAULT_PAGE;
    const pageSize = DEFAULT_PAGE_SIZE;

    const { items, total } = await repository.list({
      userId: actorOf(req).userId,
      page,
      pageSize,
    });

    const body: TaskPage = { items, page, pageSize, total };
    res.json(body);
  });

  return router;
}
