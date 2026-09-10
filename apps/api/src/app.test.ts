import type { RequestHandler } from "express";
import { UnauthorizedError } from "express-oauth2-jwt-bearer";
import request from "supertest";

import { createApp } from "@/app";
import type { LogRecord } from "@/middleware/logging";
import type { TaskRepository } from "@/tasks/repository";

const WEB_ORIGIN = "http://localhost:3000";
const TEST_USER_ID = "auth0|test-actor";

/** Stands in for `express-oauth2-jwt-bearer` on the happy path. */
function authenticateAs(userId: string): RequestHandler {
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
const rejectEveryone: RequestHandler = (_req, _res, next) => {
  next(new UnauthorizedError("Missing bearer token"));
};

/**
 * The app factory is the seam every later test depends on, so these exercise it
 * the way the composition root does — the real middleware stack, fake
 * collaborators — rather than reaching past it.
 */
function harness(
  overrides: {
    requireAuth?: RequestHandler;
    taskRepository?: Partial<TaskRepository>;
  } = {},
) {
  const records: LogRecord[] = [];

  const taskRepository: TaskRepository = {
    list: jest.fn(async () => ({ items: [], total: 0 })),
    ...overrides.taskRepository,
  };

  const app = createApp({
    taskRepository,
    requireAuth: overrides.requireAuth ?? authenticateAs(TEST_USER_ID),
    webOrigin: WEB_ORIGIN,
    log: (record) => records.push(record),
  });

  return { app, records, taskRepository };
}

function lines(records: LogRecord[], direction: LogRecord["direction"]) {
  return records.filter((record) => record.direction === direction);
}

describe("createApp", () => {
  describe("authentication", () => {
    it("rejects an unauthenticated request with UNAUTHENTICATED", async () => {
      const { app } = harness({ requireAuth: rejectEveryone });

      const response = await request(app).get("/api/tasks");

      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        error: { code: "UNAUTHENTICATED", message: expect.any(String) },
      });
    });

    it("rejects before any handler runs", async () => {
      const { app, taskRepository } = harness({ requireAuth: rejectEveryone });

      await request(app).get("/api/tasks");

      expect(taskRepository.list).not.toHaveBeenCalled();
    });

    it("scopes the list to the Actor read from the token", async () => {
      const { app, taskRepository } = harness();

      await request(app).get("/api/tasks");

      expect(taskRepository.list).toHaveBeenCalledWith(
        expect.objectContaining({ userId: TEST_USER_ID }),
      );
    });
  });

  describe("GET /api/tasks", () => {
    it("returns a well-formed empty page envelope", async () => {
      const { app } = harness();

      const response = await request(app).get("/api/tasks");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        items: [],
        page: 1,
        pageSize: 10,
        total: 0,
      });
    });
  });

  describe("logging", () => {
    it("logs a rejected request too, with the User ID absent", async () => {
      const { app, records } = harness({ requireAuth: rejectEveryone });

      await request(app).get("/api/tasks");

      const [inbound] = lines(records, "inbound");
      expect(inbound).toMatchObject({
        userId: null,
        method: "GET",
        path: "/api/tasks",
      });
      expect(inbound.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(inbound.requestId).toEqual(expect.any(String));
      expect(inbound).toHaveProperty("params");
      expect(inbound).toHaveProperty("query");
      expect(inbound).toHaveProperty("headers");
      expect(lines(records, "actor")).toHaveLength(0);
    });

    it("carries route and query parameters on the inbound line", async () => {
      const { app, records } = harness();

      await request(app).get("/api/tasks?page=2&pageSize=5");

      const [inbound] = lines(records, "inbound");
      expect(inbound.query).toEqual({ page: "2", pageSize: "5" });
      expect(inbound.params).toEqual({});
    });

    it("attaches the Actor's User ID to the same request id", async () => {
      const { app, records } = harness();

      await request(app).get("/api/tasks");

      const [inbound] = lines(records, "inbound");
      const [actor] = lines(records, "actor");
      expect(actor).toMatchObject({
        requestId: inbound.requestId,
        userId: TEST_USER_ID,
      });
    });

    it("logs an outbound line sharing the request id", async () => {
      const { app, records } = harness();

      await request(app).get("/api/tasks");

      const [inbound] = lines(records, "inbound");
      const [outbound] = lines(records, "outbound");
      expect(outbound).toMatchObject({
        requestId: inbound.requestId,
        status: 200,
      });
      expect(outbound.durationMs).toEqual(expect.any(Number));
    });

    it("redacts authorization, cookie and set-cookie headers", async () => {
      const { app, records } = harness();

      await request(app)
        .get("/api/tasks")
        .set("Authorization", "Bearer super-secret")
        .set("Cookie", "session=super-secret");

      const [inbound] = lines(records, "inbound");
      const headers = inbound.headers as Record<string, unknown>;
      expect(headers.authorization).toBe("[REDACTED]");
      expect(headers.cookie).toBe("[REDACTED]");
      expect(JSON.stringify(records)).not.toContain("super-secret");
    });

    it("truncates a large body", async () => {
      const { app, records } = harness();

      await request(app)
        .post("/api/tasks")
        .set("Content-Type", "application/json")
        .send({ title: "x".repeat(5000) });

      const [inbound] = lines(records, "inbound");
      expect(JSON.stringify(inbound.body).length).toBeLessThan(2000);
    });
  });

  describe("failures", () => {
    it("returns a generic INTERNAL error with no stack trace", async () => {
      const { app } = harness({
        taskRepository: {
          list: jest.fn(async () => {
            throw new Error("connection to the database went away");
          }),
        },
      });

      const response = await request(app).get("/api/tasks");

      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        error: { code: "INTERNAL", message: expect.any(String) },
      });
      const serialised = JSON.stringify(response.body);
      expect(serialised).not.toContain("connection to the database");
      expect(serialised).not.toContain("at ");
    });

    it("reports an unknown path as NOT_FOUND", async () => {
      const { app } = harness();

      const response = await request(app).get("/nope");

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe("NOT_FOUND");
    });
  });

  describe("CORS", () => {
    it("allows the web app origin and the precondition request header", async () => {
      const { app } = harness();

      const response = await request(app)
        .options("/api/tasks")
        .set("Origin", WEB_ORIGIN)
        .set("Access-Control-Request-Method", "PATCH")
        .set("Access-Control-Request-Headers", "if-match");

      expect(response.headers["access-control-allow-origin"]).toBe(WEB_ORIGIN);
      expect(response.headers["access-control-allow-headers"]).toContain(
        "If-Match",
      );
    });

    it("exposes the ETag and Replay marker response headers", async () => {
      const { app } = harness();

      const response = await request(app)
        .get("/api/tasks")
        .set("Origin", WEB_ORIGIN);

      const exposed = response.headers["access-control-expose-headers"] ?? "";
      expect(exposed).toContain("ETag");
      expect(exposed).toContain("X-Idempotent-Replay");
    });
  });
});
