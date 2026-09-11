import cors from "cors";
import express, { type Express, type RequestHandler, Router } from "express";

import { createDocsRoutes } from "@/docs/router";
import { attachActor } from "@/middleware/auth";
import { createErrorHandler, notFoundHandler } from "@/middleware/errors";
import {
  consoleLogSink,
  createRequestLogging,
  type LogSink,
} from "@/middleware/logging";
import { createTaskRoutes } from "@/tasks/routes";
import type { TaskRepository } from "@/tasks/repository";

/**
 * Everything the app is built from, passed in rather than imported at module
 * scope. This is the seam the whole test suite hangs off: a test supplies a
 * fake repository and a fake auth middleware and gets the real stack around
 * them, with no network, no tenant and no database.
 */
export interface AppDependencies {
  taskRepository: TaskRepository;
  /** Token validation. The real one talks to the tenant JWKS; tests do not. */
  requireAuth: RequestHandler;
  /** The single browser origin CORS admits. */
  webOrigin: string;
  /** Mounts the generated API description at `/api/docs`. See `docs/router.ts`. */
  serveDocs?: boolean;
  log?: LogSink;
}

/** A body larger than this is not a Task, it is an attack or a mistake. */
const MAX_BODY_SIZE = "100kb";

export function createApp({
  taskRepository,
  requireAuth,
  webOrigin,
  serveDocs = false,
  log = consoleLogSink,
}: AppDependencies): Express {
  const app = express();
  app.disable("x-powered-by");

  // Logging goes first, ahead of everything that can end a request on its own:
  // `cors` answers a preflight itself, `express.json` throws on a body it
  // cannot read, and auth rejects a bad token. Mounted any lower, each of those
  // would escape the log entirely. It writes its lines when the response
  // closes — see `createRequestLogging`.
  app.use(createRequestLogging(log));

  app.use(
    cors({
      origin: webOrigin,
      allowedHeaders: ["Authorization", "Content-Type", "If-Match"],
      // Neither header is CORS-safelisted, so without this the browser strips
      // both: the frontend could read neither the Version it needs for the next
      // `If-Match` nor the marker that says a Mark Done was a Replay.
      exposedHeaders: ["ETag", "X-Idempotent-Replay"],
    }),
  );
  app.use(express.json({ limit: MAX_BODY_SIZE }));

  // Ahead of the `/api` router, which puts everything under it behind a token —
  // which is exactly what the docs cannot sit behind. See `docs/router.ts`.
  if (serveDocs) {
    app.use("/api/docs", createDocsRoutes());
  }

  const api = Router();
  api.use(requireAuth, attachActor);
  api.use("/tasks", createTaskRoutes(taskRepository));
  app.use("/api", api);

  app.use(notFoundHandler);
  app.use(createErrorHandler(log));

  return app;
}
