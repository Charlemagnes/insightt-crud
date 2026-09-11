import { TaskPageSchema, TaskSchema } from "@insightt/shared";
import request from "supertest";

import {
  aTask,
  asWireTask,
  harness,
  OTHER_USER_ID,
  TEST_USER_ID,
} from "@/testing/harness";

const MALFORMED_ID = "not-a-uuid";
/** A syntactically valid id that names nothing. */
const ABSENT_ID = "11111111-1111-4111-8111-111111111111";

const idsOf = (items: { id: string }[]) => items.map((item) => item.id);

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

  it("returns a response the shared schema accepts", async () => {
    const { app } = harness({ tasks: [aTask(), aTask({ status: "DONE" })] });

    const response = await request(app).get("/api/tasks");

    // The frontend parses the response against this same schema, so a shape the
    // API can produce and the contract rejects fails here rather than as an
    // `undefined` three components deep.
    expect(() => TaskPageSchema.parse(response.body)).not.toThrow();
  });

  describe("Owner scoping", () => {
    it("returns the Actor's own Tasks and no one else's", async () => {
      const mine = aTask({ title: "Mine" });
      const theirs = aTask({ title: "Theirs", ownerId: OTHER_USER_ID });
      const { app } = harness({ tasks: [mine, theirs] });

      const response = await request(app).get("/api/tasks");

      expect(response.body.items).toEqual([asWireTask(mine)]);
      expect(response.body.total).toBe(1);
    });

    it("never publishes the Owner on a Task", async () => {
      const { app } = harness({ tasks: [aTask()] });

      const response = await request(app).get("/api/tasks");

      expect(response.body.items[0]).not.toHaveProperty("ownerId");
    });
  });

  describe("ordering", () => {
    it("orders newest first by creation time", async () => {
      const oldest = aTask({ createdAt: "2026-01-01T00:00:00.000Z" });
      const newest = aTask({ createdAt: "2026-03-01T00:00:00.000Z" });
      const middle = aTask({ createdAt: "2026-02-01T00:00:00.000Z" });
      const { app } = harness({ tasks: [oldest, newest, middle] });

      const response = await request(app).get("/api/tasks");

      expect(idsOf(response.body.items)).toEqual([
        newest.id,
        middle.id,
        oldest.id,
      ]);
    });

    it("orders Tasks sharing a creation time deterministically", async () => {
      const sameInstant = "2026-01-01T00:00:00.000Z";
      const { app } = harness({
        tasks: [aTask({ createdAt: sameInstant }), aTask({ createdAt: sameInstant })],
      });

      const [first, second] = await Promise.all([
        request(app).get("/api/tasks"),
        request(app).get("/api/tasks"),
      ]);

      // Not *which* order — that is the tiebreaker's business — but that there
      // is one. On an ordering that is not total, the same Task can come back
      // on two pages, or on none.
      expect(first.body.items).toEqual(second.body.items);
      expect(first.body.items).toHaveLength(2);
    });
  });

  describe("the query string", () => {
    it("defaults to the first page of ten", async () => {
      const { app } = harness();

      const response = await request(app).get("/api/tasks");

      expect(response.body).toMatchObject({ page: 1, pageSize: 10 });
    });

    it("pages, reporting the total across every page", async () => {
      const { app } = harness({ tasks: Array.from({ length: 5 }, () => aTask()) });

      const response = await request(app).get("/api/tasks?page=2&pageSize=2");

      expect(response.body.items).toHaveLength(2);
      expect(response.body).toMatchObject({ page: 2, pageSize: 2, total: 5 });
    });

    it("reports the real total on a page past the end", async () => {
      const { app } = harness({ tasks: [aTask(), aTask()] });

      const response = await request(app).get("/api/tasks?page=9&pageSize=10");

      // An empty page is not an empty list. Reporting 0 here would collapse the
      // pager onto page 1 and hide the Tasks that are really there.
      expect(response.body.items).toEqual([]);
      expect(response.body.total).toBe(2);
    });

    it("filters by Status when asked", async () => {
      const done = aTask({ status: "DONE" });
      const { app } = harness({ tasks: [aTask(), done] });

      const response = await request(app).get("/api/tasks?status=DONE");

      expect(response.body.items).toEqual([asWireTask(done)]);
      expect(response.body.total).toBe(1);
    });

    it("shows Archived Tasks when no Status is asked for", async () => {
      const archived = aTask({ status: "ARCHIVED" });
      const { app } = harness({ tasks: [archived] });

      const response = await request(app).get("/api/tasks");

      // Archived is a Status, not a soft delete (CONTEXT.md, "Archived").
      expect(response.body.items).toEqual([asWireTask(archived)]);
    });

    it("rejects a page size beyond the cap as VALIDATION_FAILED", async () => {
      const { app } = harness();

      const response = await request(app).get("/api/tasks?pageSize=1000");

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe("VALIDATION_FAILED");
      expect(response.body.error.details).toEqual(expect.any(Array));
    });

    it("rejects a Status outside the lifecycle", async () => {
      const { app } = harness();

      const response = await request(app).get("/api/tasks?status=CANCELLED");

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe("VALIDATION_FAILED");
    });
  });
});

describe("GET /api/tasks/:id", () => {
  it("returns the Task with an ETag carrying its Version", async () => {
    const task = aTask({ version: 7 });
    const { app } = harness({ tasks: [task] });

    const response = await request(app).get(`/api/tasks/${task.id}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(asWireTask(task));
    // Quoted, because `If-Match` is compared verbatim against what was sent.
    expect(response.headers.etag).toBe('"7"');
  });

  it("returns a response the shared schema accepts", async () => {
    const task = aTask({
      status: "DONE",
      completedAt: "2026-02-01T00:00:00.000Z",
    });
    const { app } = harness({ tasks: [task] });

    const response = await request(app).get(`/api/tasks/${task.id}`);

    expect(() => TaskSchema.parse(response.body)).not.toThrow();
  });

  it("scopes the read to the Actor", async () => {
    const findById = jest.fn(async () => null);
    const { app } = harness({ taskRepository: { findById } });

    await request(app).get(`/api/tasks/${ABSENT_ID}`);

    expect(findById).toHaveBeenCalledWith({
      userId: TEST_USER_ID,
      id: ABSENT_ID,
    });
  });

  it("reports a Task owned by someone else as NOT_FOUND", async () => {
    const theirs = aTask({ ownerId: OTHER_USER_ID });
    const { app } = harness({ tasks: [theirs] });

    const response = await request(app).get(`/api/tasks/${theirs.id}`);

    // 404 and not 403: a forbidden would confirm the Task exists.
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });

  it("answers identically for a Task that exists elsewhere and one that does not", async () => {
    const theirs = aTask({ ownerId: OTHER_USER_ID });
    const { app } = harness({ tasks: [theirs] });

    const [notOwned, absent] = await Promise.all([
      request(app).get(`/api/tasks/${theirs.id}`),
      request(app).get(`/api/tasks/${ABSENT_ID}`),
    ]);

    expect(notOwned.status).toBe(absent.status);
    expect(notOwned.body).toEqual(absent.body);
  });

  it("reports a malformed id as NOT_FOUND without reaching the repository", async () => {
    const findById = jest.fn(async () => null);
    const { app } = harness({ taskRepository: { findById } });

    const response = await request(app).get(`/api/tasks/${MALFORMED_ID}`);

    // Parsed at the boundary, so `where id = 'not-a-uuid'` never happens —
    // Postgres would raise a type error and the caller would see a 500.
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
    expect(findById).not.toHaveBeenCalled();
  });
});
