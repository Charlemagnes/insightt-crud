import request from "supertest";

import {
  harness,
  rejectEveryone,
  TEST_USER_ID,
  WEB_ORIGIN,
} from "@/testing/harness";

/**
 * The app factory is the seam every later test depends on, so these exercise it
 * the way the composition root does — the real middleware stack, fake
 * collaborators — rather than reaching past it.
 *
 * What the Task routes themselves do with a request lives in `tasks/routes.test.ts`.
 */
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
      const list = jest.fn(async () => ({ items: [], total: 0 }));
      const { app } = harness({
        requireAuth: rejectEveryone,
        taskRepository: { list },
      });

      await request(app).get("/api/tasks");

      expect(list).not.toHaveBeenCalled();
    });

    it("scopes the list to the Actor read from the token", async () => {
      const list = jest.fn(async () => ({ items: [], total: 0 }));
      const { app } = harness({ taskRepository: { list } });

      await request(app).get("/api/tasks");

      expect(list).toHaveBeenCalledWith(
        expect.objectContaining({ userId: TEST_USER_ID }),
      );
    });
  });

  describe("logging", () => {
    it("logs a rejected request too, with the User ID absent", async () => {
      const { app, lines } = harness({ requireAuth: rejectEveryone });

      await request(app).get("/api/tasks");

      const [inbound] = lines("inbound");
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
      expect(lines("actor")).toHaveLength(0);
    });

    it("carries the query parameters on the inbound line", async () => {
      const { app, lines } = harness();

      await request(app).get("/api/tasks?page=2&pageSize=5");

      expect(lines("inbound")[0].query).toEqual({ page: "2", pageSize: "5" });
    });

    it("logs a CORS preflight, which never reaches a route", async () => {
      const { app, lines } = harness();

      await request(app)
        .options("/api/tasks")
        .set("Origin", WEB_ORIGIN)
        .set("Access-Control-Request-Method", "PATCH");

      expect(lines("inbound")).toHaveLength(1);
      expect(lines("outbound")[0]).toMatchObject({ status: 204 });
    });

    it("logs a body the parser refused, which never reaches a route either", async () => {
      const { app, lines } = harness();

      const response = await request(app)
        .post("/api/tasks")
        .set("Content-Type", "application/json")
        .send("{ not json");

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe("VALIDATION_FAILED");
      expect(lines("inbound")).toHaveLength(1);
      expect(lines("outbound")[0]).toMatchObject({ status: 422 });
    });

    it("attaches the Actor's User ID to the same request id", async () => {
      const { app, lines } = harness();

      await request(app).get("/api/tasks");

      expect(lines("actor")[0]).toMatchObject({
        requestId: lines("inbound")[0].requestId,
        userId: TEST_USER_ID,
      });
    });

    it("logs an outbound line sharing the request id", async () => {
      const { app, lines } = harness();

      await request(app).get("/api/tasks");

      const [outbound] = lines("outbound");
      expect(outbound).toMatchObject({
        requestId: lines("inbound")[0].requestId,
        status: 200,
      });
      expect(outbound.durationMs).toEqual(expect.any(Number));
    });

    it("redacts authorization, cookie and set-cookie headers", async () => {
      const { app, lines, records } = harness();

      await request(app)
        .get("/api/tasks")
        .set("Authorization", "Bearer super-secret")
        .set("Cookie", "session=super-secret");

      const headers = lines("inbound")[0].headers as Record<string, unknown>;
      expect(headers.authorization).toBe("[REDACTED]");
      expect(headers.cookie).toBe("[REDACTED]");
      expect(JSON.stringify(records)).not.toContain("super-secret");
    });

    it("truncates a large body", async () => {
      const { app, lines } = harness();

      await request(app)
        .post("/api/tasks")
        .set("Content-Type", "application/json")
        .send({ title: "x".repeat(5000) });

      expect(JSON.stringify(lines("inbound")[0].body).length).toBeLessThan(2000);
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
