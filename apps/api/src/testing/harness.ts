import type { Task } from "@insightt/shared";
import type { Express, RequestHandler } from "express";
import { UnauthorizedError } from "express-oauth2-jwt-bearer";

import { createApp } from "@/app";
import type { LogRecord } from "@/middleware/logging";
import type { TaskRepository } from "@/tasks/repository";
import {
  createFakeTaskRepository,
  withoutOwner,
  type OwnedTask,
} from "@/tasks/repository.fake";

export const WEB_ORIGIN = "http://localhost:3000";
export const TEST_USER_ID = "auth0|test-actor";
export const OTHER_USER_ID = "auth0|someone-else";

/** Stands in for `express-oauth2-jwt-bearer` on the happy path. */
export function authenticateAs(userId: string): RequestHandler {
  return (req, _res, next) => {
    req.auth = {
      header: { alg: "RS256" },
      payload: { sub: userId },
      token: "test-token",
    };
    next();
  };
}

/** Stands in for it on the rejection path: the real middleware throws this. */
export const rejectEveryone: RequestHandler = (_req, _res, next) => {
  next(new UnauthorizedError("Missing bearer token"));
};

export interface Harness {
  app: Express;
  /** Every line the app logged, in the order it logged them. */
  records: LogRecord[];
  taskRepository: TaskRepository;
  /** The lines of one direction, which is how every logging assertion reads. */
  lines(direction: LogRecord["direction"]): LogRecord[];
}

export interface HarnessOptions {
  requireAuth?: RequestHandler;
  /** Tasks the in-memory repository starts with, Owner and all. */
  tasks?: OwnedTask[];
  /** Replaces the in-memory repository outright, for the failure paths. */
  taskRepository?: Partial<TaskRepository>;
  /** Mounts `/api/docs`, which the composition root does outside production. */
  serveDocs?: boolean;
}

/**
 * Builds the app the way the composition root does — the real middleware stack,
 * fake collaborators — and hands back what a test needs to drive it over HTTP.
 *
 * Reaching past `createApp` to call a route handler directly would skip the
 * parts most likely to be wrong: CORS, the body parser, the auth boundary, the
 * error mapper. Every one of those is real here; only the tenant and the
 * database are not.
 */
export function harness(options: HarnessOptions = {}): Harness {
  const records: LogRecord[] = [];

  const taskRepository: TaskRepository = {
    ...createFakeTaskRepository(options.tasks),
    ...options.taskRepository,
  };

  const app = createApp({
    taskRepository,
    requireAuth: options.requireAuth ?? authenticateAs(TEST_USER_ID),
    webOrigin: WEB_ORIGIN,
    serveDocs: options.serveDocs,
    log: (record) => records.push(record),
  });

  return {
    app,
    records,
    taskRepository,
    lines: (direction) =>
      records.filter((record) => record.direction === direction),
  };
}

let sequence = 0;

/**
 * A stored Task, with everything a test does not care about filled in. Pass
 * `createdAt` when ordering is the point; the default walks forward one second
 * per call so declaration order is also newest-last, and a test that omits it
 * still gets a stable, total ordering rather than five rows sharing a timestamp.
 */
export function aTask(overrides: Partial<OwnedTask> = {}): OwnedTask {
  sequence += 1;

  const task: OwnedTask = {
    id: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    ownerId: TEST_USER_ID,
    title: `Task ${sequence}`,
    description: null,
    status: "PENDING",
    version: 1,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)).toISOString(),
    updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)).toISOString(),
    completedAt: null,
    ...overrides,
  };

  return task;
}

/** The wire shape of a stored Task: what the API should return for it. */
export const asWireTask = withoutOwner;
