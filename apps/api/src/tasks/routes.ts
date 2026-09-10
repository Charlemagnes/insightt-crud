import type { TaskPage } from "@insightt/shared";
import { Router } from "express";

import { actorOf } from "@/middleware/auth";
import type { TaskRepository } from "@/tasks/repository";

/**
 * Pagination defaults. They become the parsed `TaskListQuery` once the query
 * string is validated; until then every page is the first one.
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
