import { TaskPageSchema, TaskSchema } from "@insightt/shared";
import request from "supertest";

import {
  createMemoryTaskRepository,
  type OwnedTask,
} from "@/tasks/repository.memory";
import {
  aTask,
  asWireTask,
  authenticateAs,
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
    // Postgres would raise a type error and the Actor would see a 500.
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
    expect(findById).not.toHaveBeenCalled();
  });
});

describe("POST /api/tasks", () => {
  const draft = { title: "Write the plan" };

  it("creates the Task and returns it as 201", async () => {
    const { app } = harness();

    const response = await request(app).post("/api/tasks").send(draft);

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      title: "Write the plan",
      description: null,
      version: 1,
      completedAt: null,
    });
  });

  it("returns a response the shared schema accepts", async () => {
    const { app } = harness();

    const response = await request(app).post("/api/tasks").send(draft);

    expect(() => TaskSchema.parse(response.body)).not.toThrow();
  });

  it("carries the new Task's Version as an ETag", async () => {
    const { app } = harness();

    const response = await request(app).post("/api/tasks").send(draft);

    // The frontend hands this straight back as `If-Match` on the first edit,
    // so a create that omitted it would make the next edit a round trip longer.
    expect(response.headers.etag).toBe('"1"');
  });

  it("makes the new Task appear in the Actor's list", async () => {
    const { app } = harness();

    const created = await request(app).post("/api/tasks").send(draft);
    const list = await request(app).get("/api/tasks");

    expect(idsOf(list.body.items)).toEqual([created.body.id]);
    expect(list.body.total).toBe(1);
  });

  describe("the starting Status", () => {
    it("creates the Task PENDING", async () => {
      const { app } = harness();

      const response = await request(app).post("/api/tasks").send(draft);

      expect(response.body.status).toBe("PENDING");
    });

    it("refuses a payload that names a Status at all", async () => {
      const { app } = harness();

      const response = await request(app)
        .post("/api/tasks")
        .send({ ...draft, status: "DONE" });

      // Rejected rather than ignored. A silently dropped Status would look, to
      // the caller, exactly like one that had been honoured -- and
      // `mark_task_done()` has to stay the only entrance to DONE (PLAN.md §8).
      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe("VALIDATION_FAILED");
    });
  });

  describe("Owner scoping", () => {
    it("stores the new Task under the Actor", async () => {
      const create = jest.fn(async () => asWireTask(aTask()));
      const { app } = harness({ taskRepository: { create } });

      await request(app).post("/api/tasks").send(draft);

      expect(create).toHaveBeenCalledWith({
        userId: TEST_USER_ID,
        title: "Write the plan",
        description: null,
      });
    });

    it("never publishes the Owner on the created Task", async () => {
      const { app } = harness();

      const response = await request(app).post("/api/tasks").send(draft);

      expect(response.body).not.toHaveProperty("ownerId");
    });

    it("keeps the new Task out of another Owner's list", async () => {
      // One store, two Actors: the Task has to be invisible to the second
      // because of who owns it, not because it is somewhere else entirely.
      const store = createMemoryTaskRepository();
      const { app } = harness({ taskRepository: store });
      const { app: theirApp } = harness({
        taskRepository: store,
        requireAuth: authenticateAs(OTHER_USER_ID),
      });

      await request(app).post("/api/tasks").send(draft);
      const theirs = await request(theirApp).get("/api/tasks");

      expect(theirs.body.items).toEqual([]);
      expect(theirs.body.total).toBe(0);
    });
  });

  describe("the title", () => {
    it("trims it", async () => {
      const { app } = harness();

      const response = await request(app)
        .post("/api/tasks")
        .send({ title: "  Write the plan  " });

      expect(response.body.title).toBe("Write the plan");
    });

    it("rejects a missing title", async () => {
      const { app } = harness();

      const response = await request(app).post("/api/tasks").send({});

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe("VALIDATION_FAILED");
    });

    it("rejects a title that is only whitespace", async () => {
      const { app } = harness();

      const response = await request(app).post("/api/tasks").send({ title: "   " });

      expect(response.status).toBe(422);
    });

    it("rejects a title beyond the cap", async () => {
      const { app } = harness();

      const response = await request(app)
        .post("/api/tasks")
        .send({ title: "a".repeat(201) });

      expect(response.status).toBe(422);
    });

    it("names the offending field in the details", async () => {
      const { app } = harness();

      const response = await request(app).post("/api/tasks").send({ title: "" });

      // The create form reads these issues to mark the field that failed, so
      // the paths travelling intact is the contract, not an implementation
      // detail of the error envelope.
      expect(response.body.error.details).toEqual([
        expect.objectContaining({ path: ["title"] }),
      ]);
    });
  });

  describe("the description", () => {
    it("stores one when given", async () => {
      const { app } = harness();

      const response = await request(app)
        .post("/api/tasks")
        .send({ ...draft, description: "  the details  " });

      expect(response.body.description).toBe("the details");
    });

    it("stores an omitted description as absent, not as text", async () => {
      const { app } = harness();

      const response = await request(app).post("/api/tasks").send(draft);

      // Null, never the four-letter string an unchecked template produces.
      expect(response.body.description).toBeNull();
    });

    it("stores a blank description as absent", async () => {
      const { app } = harness();

      const response = await request(app)
        .post("/api/tasks")
        .send({ ...draft, description: "   " });

      expect(response.body.description).toBeNull();
    });

    it("rejects a description beyond the cap", async () => {
      const { app } = harness();

      const response = await request(app)
        .post("/api/tasks")
        .send({ ...draft, description: "a".repeat(2001) });

      expect(response.status).toBe(422);
    });
  });

  describe("payloads it refuses", () => {
    it("rejects an unknown field rather than dropping it", async () => {
      const { app } = harness();

      const response = await request(app)
        .post("/api/tasks")
        .send({ ...draft, titel: "a typo" });

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe("VALIDATION_FAILED");
    });

    it("rejects a body that is not an object", async () => {
      const { app } = harness();

      const response = await request(app)
        .post("/api/tasks")
        .set("Content-Type", "application/json")
        .send('["a task"]');

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe("VALIDATION_FAILED");
    });

    it("rejects a body the parser could not read", async () => {
      const { app } = harness();

      const response = await request(app)
        .post("/api/tasks")
        .set("Content-Type", "application/json")
        .send("{ not json");

      // `express.json` throws before any schema is reached. Reported as 422
      // rather than the parser's own 400, so PLAN.md §6's error table stays the
      // whole vocabulary.
      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe("VALIDATION_FAILED");
    });

    it("never reaches the repository with a payload it refused", async () => {
      const create = jest.fn(async () => asWireTask(aTask()));
      const { app } = harness({ taskRepository: { create } });

      await request(app).post("/api/tasks").send({ title: "" });

      expect(create).not.toHaveBeenCalled();
    });
  });
});

describe("POST /api/tasks/:id/start", () => {
  it("moves a PENDING Task to IN_PROGRESS", async () => {
    const task = aTask({ status: "PENDING", version: 1 });
    const { app } = harness({ tasks: [task] });

    const response = await request(app).post(`/api/tasks/${task.id}/start`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: task.id,
      status: "IN_PROGRESS",
      // Raised, because the Task changed and the next `If-Match` must not
      // still match the Version the caller was holding.
      version: 2,
      completedAt: null,
    });
  });

  it("returns a response the shared schema accepts, with the new ETag", async () => {
    const task = aTask({ version: 3 });
    const { app } = harness({ tasks: [task] });

    const response = await request(app).post(`/api/tasks/${task.id}/start`);

    expect(() => TaskSchema.parse(response.body)).not.toThrow();
    expect(response.headers.etag).toBe('"4"');
  });

  it("takes no request body into account", async () => {
    const task = aTask();
    const { app } = harness({ tasks: [task] });

    const response = await request(app)
      .post(`/api/tasks/${task.id}/start`)
      .send({ status: "DONE" });

    // The target Status is in the path. There is nothing to contradict.
    expect(response.status).toBe(200);
    expect(response.body.status).toBe("IN_PROGRESS");
  });

  it("scopes the Transition to the Actor", async () => {
    const start = jest.fn(async () => ({ outcome: "not_found" }) as const);
    const { app } = harness({ taskRepository: { start } });

    await request(app).post(`/api/tasks/${ABSENT_ID}/start`);

    expect(start).toHaveBeenCalledWith({
      userId: TEST_USER_ID,
      id: ABSENT_ID,
    });
  });

  describe("the moves it refuses", () => {
    it.each(["IN_PROGRESS", "DONE", "ARCHIVED"] as const)(
      "refuses to start a %s Task as INVALID_TRANSITION",
      async (status) => {
        const task = aTask({ status });
        const { app } = harness({ tasks: [task] });

        const response = await request(app).post(`/api/tasks/${task.id}/start`);

        // 409, not 412: nothing about this is a stale read — the move itself
        // is not one the lifecycle allows.
        expect(response.status).toBe(409);
        expect(response.body.error.code).toBe("INVALID_TRANSITION");
      },
    );

    it("leaves the refused Task exactly as it was", async () => {
      const task = aTask({ status: "DONE", version: 4 });
      const { app } = harness({ tasks: [task] });

      await request(app).post(`/api/tasks/${task.id}/start`);
      const after = await request(app).get(`/api/tasks/${task.id}`);

      expect(after.body).toEqual(asWireTask(task));
    });

    it("reports a Task owned by someone else as NOT_FOUND", async () => {
      const theirs = aTask({ ownerId: OTHER_USER_ID });
      const { app } = harness({ tasks: [theirs] });

      const response = await request(app).post(`/api/tasks/${theirs.id}/start`);

      // 404 and not 409: a Task the Actor cannot see has no Status to refuse.
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe("NOT_FOUND");
    });

    it("answers identically for a Task that exists elsewhere and one that does not", async () => {
      const theirs = aTask({ ownerId: OTHER_USER_ID });
      const { app } = harness({ tasks: [theirs] });

      const [notOwned, absent] = await Promise.all([
        request(app).post(`/api/tasks/${theirs.id}/start`),
        request(app).post(`/api/tasks/${ABSENT_ID}/start`),
      ]);

      expect(notOwned.status).toBe(absent.status);
      expect(notOwned.body).toEqual(absent.body);
    });

    it("reports a malformed id as NOT_FOUND without reaching the repository", async () => {
      const start = jest.fn(async () => ({ outcome: "not_found" }) as const);
      const { app } = harness({ taskRepository: { start } });

      const response = await request(app).post(
        `/api/tasks/${MALFORMED_ID}/start`,
      );

      expect(response.status).toBe(404);
      expect(start).not.toHaveBeenCalled();
    });
  });
});

describe("POST /api/tasks/:id/done", () => {
  /** A Task in the one Status that can be marked Done. */
  const started = (overrides: Partial<OwnedTask> = {}) =>
    aTask({ status: "IN_PROGRESS", ...overrides });

  it("marks an IN_PROGRESS Task DONE and records when", async () => {
    const task = started({ version: 1 });
    const { app } = harness({ tasks: [task] });

    const response = await request(app).post(`/api/tasks/${task.id}/done`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: task.id,
      status: "DONE",
      version: 2,
    });
    expect(response.body.completedAt).not.toBeNull();
  });

  it("returns a response the shared schema accepts, with the new ETag", async () => {
    const task = started({ version: 2 });
    const { app } = harness({ tasks: [task] });

    const response = await request(app).post(`/api/tasks/${task.id}/done`);

    expect(() => TaskSchema.parse(response.body)).not.toThrow();
    expect(response.headers.etag).toBe('"3"');
  });

  it("does not mark a fresh completion as a Replay", async () => {
    const task = started();
    const { app } = harness({ tasks: [task] });

    const response = await request(app).post(`/api/tasks/${task.id}/done`);

    expect(response.headers["x-idempotent-replay"]).toBeUndefined();
  });

  describe("a Replay", () => {
    it("succeeds rather than failing", async () => {
      const task = aTask({
        status: "DONE",
        completedAt: "2026-02-01T00:00:00.000Z",
      });
      const { app } = harness({ tasks: [task] });

      const response = await request(app).post(`/api/tasks/${task.id}/done`);

      // The Task is Done, which is what was asked for. Reporting this as a
      // failure would make a retried request look like a lost one.
      expect(response.status).toBe(200);
      expect(response.body.status).toBe("DONE");
    });

    it("carries the marker header", async () => {
      const task = aTask({
        status: "DONE",
        completedAt: "2026-02-01T00:00:00.000Z",
      });
      const { app } = harness({ tasks: [task] });

      const response = await request(app).post(`/api/tasks/${task.id}/done`);

      expect(response.headers["x-idempotent-replay"]).toBe("true");
    });

    it("never overwrites the original completion", async () => {
      const task = aTask({
        status: "DONE",
        version: 5,
        completedAt: "2026-02-01T00:00:00.000Z",
      });
      const { app } = harness({ tasks: [task] });

      const response = await request(app).post(`/api/tasks/${task.id}/done`);

      // Nothing was written, so neither the completion time nor the Version
      // moved — a Replay that bumped either would invalidate an `If-Match`
      // the caller was right to be holding.
      expect(response.body.completedAt).toBe("2026-02-01T00:00:00.000Z");
      expect(response.body.version).toBe(5);
    });
  });

  it("completes once and succeeds twice when two requests race", async () => {
    const task = started();
    const { app } = harness({ tasks: [task] });

    const [first, second] = await Promise.all([
      request(app).post(`/api/tasks/${task.id}/done`),
      request(app).post(`/api/tasks/${task.id}/done`),
    ]);

    // One completion, two identical successes. Which request won is not the
    // point and is not asserted; that exactly one of them did is.
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(first.body).toEqual(second.body);
    expect(
      [first, second].filter(
        (response) => response.headers["x-idempotent-replay"] === "true",
      ),
    ).toHaveLength(1);
  });

  describe("the moves it refuses", () => {
    it.each(["PENDING", "ARCHIVED"] as const)(
      "refuses to mark a %s Task Done as INVALID_TRANSITION",
      async (status) => {
        const task = aTask({ status });
        const { app } = harness({ tasks: [task] });

        const response = await request(app).post(`/api/tasks/${task.id}/done`);

        expect(response.status).toBe(409);
        expect(response.body.error.code).toBe("INVALID_TRANSITION");
      },
    );

    it("leaves a refused Task uncompleted", async () => {
      const task = aTask({ status: "PENDING" });
      const { app } = harness({ tasks: [task] });

      await request(app).post(`/api/tasks/${task.id}/done`);
      const after = await request(app).get(`/api/tasks/${task.id}`);

      expect(after.body).toEqual(asWireTask(task));
    });

    it("reports another Actor's Task as NOT_FOUND", async () => {
      const theirs = started({ ownerId: OTHER_USER_ID });
      const { app } = harness({ tasks: [theirs] });

      const response = await request(app).post(`/api/tasks/${theirs.id}/done`);

      // Only the Owner can mark a Task Done, and this is how that is
      // enforced: the Task is not addressable at all (PLAN.md §7).
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe("NOT_FOUND");
    });

    it("leaves another Actor's Task untouched", async () => {
      const theirs = started({ ownerId: OTHER_USER_ID });
      const { app } = harness({ tasks: [theirs] });
      const { app: theirApp } = harness({
        tasks: [theirs],
        requireAuth: authenticateAs(OTHER_USER_ID),
      });

      await request(app).post(`/api/tasks/${theirs.id}/done`);
      const after = await request(theirApp).get(`/api/tasks/${theirs.id}`);

      expect(after.body.status).toBe("IN_PROGRESS");
      expect(after.body.completedAt).toBeNull();
    });

    it("reports a malformed id as NOT_FOUND without reaching the repository", async () => {
      const markDone = jest.fn(async () => ({ outcome: "not_found" }) as const);
      const { app } = harness({ taskRepository: { markDone } });

      const response = await request(app).post(
        `/api/tasks/${MALFORMED_ID}/done`,
      );

      expect(response.status).toBe(404);
      expect(markDone).not.toHaveBeenCalled();
    });
  });
});
