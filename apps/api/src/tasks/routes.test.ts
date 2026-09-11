import {
  canEdit,
  canTransition,
  EDITABLE_FIELDS,
  LIFECYCLE,
  statusBefore,
  TASK_PAGE,
  TaskPageSchema,
  TaskSchema,
  type TaskStatus,
} from "@insightt/shared";
import type { Express } from "express";
import request from "supertest";

import {
  createFakeTaskRepository,
  type OwnedTask,
} from "@/tasks/repository.fake";
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
      page: TASK_PAGE.first,
      pageSize: TASK_PAGE.defaultSize,
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
    // Not a sort: no order was asked for, and none is reported back. What is
    // pinned is only that the unsorted list has a stable order at all, which is
    // what paging over it needs.
    it("returns a stable order when no sort was asked for", async () => {
      const oldest = aTask({ createdAt: "2026-01-01T00:00:00.000Z" });
      const newest = aTask({ createdAt: "2026-03-01T00:00:00.000Z" });
      const middle = aTask({ createdAt: "2026-02-01T00:00:00.000Z" });
      const { app } = harness({ tasks: [oldest, newest, middle] });

      const response = await request(app).get("/api/tasks");

      expect(idsOf(response.body.items)).toEqual([
        oldest.id,
        middle.id,
        newest.id,
      ]);
    });

    it("reverses when the direction does", async () => {
      const oldest = aTask({ createdAt: "2026-01-01T00:00:00.000Z" });
      const newest = aTask({ createdAt: "2026-03-01T00:00:00.000Z" });
      const { app } = harness({ tasks: [oldest, newest] });

      const response = await request(app).get(
        "/api/tasks?sort=createdAt&direction=desc",
      );

      expect(idsOf(response.body.items)).toEqual([newest.id, oldest.id]);
    });

    it("orders by title when asked to", async () => {
      const apple = aTask({ title: "Apple" });
      const cherry = aTask({ title: "Cherry" });
      const banana = aTask({ title: "Banana" });
      const { app } = harness({ tasks: [cherry, apple, banana] });

      const response = await request(app).get("/api/tasks?sort=title");

      expect(idsOf(response.body.items)).toEqual([
        apple.id,
        banana.id,
        cherry.id,
      ]);
    });

    // The Postgres enum orders by the order its values were declared, which is
    // the lifecycle. Alphabetically `ARCHIVED` would come first, which is the
    // one order the column does not mean.
    it("orders Status by the lifecycle, not the alphabet", async () => {
      const pending = aTask({ status: "PENDING" });
      const archived = aTask({ status: "ARCHIVED" });
      const done = aTask({ status: "DONE" });
      const { app } = harness({ tasks: [archived, done, pending] });

      // Asked for by name, because an unfiltered list leaves Archived out.
      const [ascending, descending] = await Promise.all([
        request(app).get("/api/tasks?sort=status&status=ARCHIVED"),
        request(app).get("/api/tasks?sort=status"),
      ]);

      expect(idsOf(ascending.body.items)).toEqual([archived.id]);
      expect(idsOf(descending.body.items)).toEqual([pending.id, done.id]);
    });

    it("rejects a sort field the contract does not have", async () => {
      const { app } = harness();

      const response = await request(app).get("/api/tasks?sort=ownerId");

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe("VALIDATION_FAILED");
    });

    it("rejects a direction that is not one of the two", async () => {
      const { app } = harness();

      const response = await request(app).get("/api/tasks?direction=sideways");

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe("VALIDATION_FAILED");
    });

    // A direction has no column to run in, so it orders nothing rather than
    // being a `422`: the request asked for nothing unusual.
    it("ignores a direction sent without a sort", async () => {
      const oldest = aTask({ createdAt: "2026-01-01T00:00:00.000Z" });
      const newest = aTask({ createdAt: "2026-03-01T00:00:00.000Z" });
      const { app } = harness({ tasks: [newest, oldest] });

      const [asked, unsorted] = await Promise.all([
        request(app).get("/api/tasks?direction=desc"),
        request(app).get("/api/tasks"),
      ]);

      expect(idsOf(asked.body.items)).toEqual(idsOf(unsorted.body.items));
    });

    it("orders Tasks sharing a sort value deterministically", async () => {
      const sameInstant = "2026-01-01T00:00:00.000Z";
      const { app } = harness({
        tasks: [
          aTask({ createdAt: sameInstant }),
          aTask({ createdAt: sameInstant }),
        ],
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
    // Named from `TASK_PAGE` rather than repeating the numbers: the defaults
    // are the contract's to choose, and a test that restated them would fail
    // for a changed default rather than for a route that stopped applying one.
    it("defaults to the first page, at the contract's page size", async () => {
      const { app } = harness();

      const response = await request(app).get("/api/tasks");

      expect(response.body).toMatchObject({
        page: TASK_PAGE.first,
        pageSize: TASK_PAGE.defaultSize,
      });
    });

    it("pages, reporting the total across every page", async () => {
      const { app } = harness({
        tasks: Array.from({ length: 5 }, () => aTask()),
      });

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

    it("leaves Archived Tasks out when no Status is asked for", async () => {
      const archived = aTask({ status: "ARCHIVED" });
      const pending = aTask({ status: "PENDING" });
      const { app } = harness({ tasks: [archived, pending] });

      const response = await request(app).get("/api/tasks");

      // Archived Tasks are put away, and the unfiltered list is the work still
      // in front of the Owner (CONTEXT.md, "Archived").
      expect(response.body.items).toEqual([asWireTask(pending)]);
      // The count is of the same rows the page came from, so the pager cannot
      // offer a page of Tasks the list will not show.
      expect(response.body.total).toBe(1);
    });

    it("shows Archived Tasks when the Archived Status is asked for", async () => {
      const archived = aTask({ status: "ARCHIVED" });
      const { app } = harness({ tasks: [archived, aTask({ status: "DONE" })] });

      const response = await request(app).get("/api/tasks?status=ARCHIVED");

      // Not hidden, not deleted — just not selected until asked for by name.
      expect(response.body.items).toEqual([asWireTask(archived)]);
      expect(response.body.total).toBe(1);
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
      const store = createFakeTaskRepository();
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

      const response = await request(app)
        .post("/api/tasks")
        .send({ title: "   " });

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

      const response = await request(app)
        .post("/api/tasks")
        .send({ title: "" });

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

describe("PATCH /api/tasks/:id", () => {
  /** The `If-Match` a client holding `version` would send. */
  const etagFor = (version: number) => `"${version}"`;

  /** An edit request carrying a precondition the caller chose. */
  const editAt = (app: Express, task: OwnedTask, ifMatch: string) =>
    request(app).patch(`/api/tasks/${task.id}`).set("If-Match", ifMatch);

  /**
   * An edit against the Task's Version as it stands right now.
   *
   * Read at call time, not captured: the in-memory repository edits the seeded
   * Task in place, so a tag bound once would go stale the moment a test made
   * two edits — which is a real conflict to assert deliberately, never one to
   * trip over. `editAt` is for that.
   */
  const editing = (app: Express, task: OwnedTask) =>
    editAt(app, task, etagFor(task.version));

  it("changes the title and raises the Version", async () => {
    const task = aTask({ title: "Before", version: 1 });
    const { app } = harness({ tasks: [task] });

    const response = await editing(app, task).send({ title: "After" });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: task.id,
      title: "After",
      // Raised, so the `If-Match` this caller was holding stops matching and a
      // second tab's stale edit is refused rather than applied on top.
      version: 2,
    });
  });

  it("returns a response the shared schema accepts, with the new ETag", async () => {
    const task = aTask({ version: 3 });
    const { app } = harness({ tasks: [task] });

    const response = await editing(app, task).send({ title: "After" });

    expect(() => TaskSchema.parse(response.body)).not.toThrow();
    // The tag the next edit hands back, without re-reading the Task to get it.
    expect(response.headers.etag).toBe('"4"');
  });

  it("leaves a field the edit did not name alone", async () => {
    const task = aTask({ title: "Before", description: "Keep me" });
    const { app } = harness({ tasks: [task] });

    const response = await editing(app, task).send({ title: "After" });

    expect(response.body.description).toBe("Keep me");
  });

  it("clears a description when the edit says null", async () => {
    const task = aTask({ description: "Remove me" });
    const { app } = harness({ tasks: [task] });

    const response = await editing(app, task).send({ description: null });

    // The one thing omitting the key cannot mean.
    expect(response.status).toBe(200);
    expect(response.body.description).toBeNull();
  });

  it("reads an emptied text area as a cleared description", async () => {
    const task = aTask({ description: "Remove me" });
    const { app } = harness({ tasks: [task] });

    const response = await editing(app, task).send({ description: "   " });

    expect(response.body.description).toBeNull();
  });

  it("trims the title, as a create does", async () => {
    const task = aTask({ title: "Before" });
    const { app } = harness({ tasks: [task] });

    const response = await editing(app, task).send({ title: "  After  " });

    expect(response.body.title).toBe("After");
  });

  it("makes the edit visible to the next read", async () => {
    const task = aTask({ title: "Before" });
    const { app } = harness({ tasks: [task] });

    await editing(app, task).send({ title: "After" });
    const after = await request(app).get(`/api/tasks/${task.id}`);

    expect(after.body.title).toBe("After");
    expect(after.headers.etag).toBe('"2"');
  });

  it("scopes the edit to the Actor", async () => {
    const task = aTask();
    const update = jest.fn(async () => ({ outcome: "not_found" }) as const);
    const { app } = harness({ tasks: [task], taskRepository: { update } });

    await editing(app, task).send({ title: "After" });

    expect(update).toHaveBeenCalledWith({
      userId: TEST_USER_ID,
      id: task.id,
      // The Version from the header, not one the body could have named.
      expectedVersion: task.version,
      changes: { title: "After" },
    });
  });

  describe("the precondition", () => {
    it("refuses an edit that sends no If-Match", async () => {
      const task = aTask();
      const { app } = harness({ tasks: [task] });

      const response = await request(app)
        .patch(`/api/tasks/${task.id}`)
        .send({ title: "After" });

      // 428 and not 412: no stale claim was made, no claim was made at all.
      expect(response.status).toBe(428);
      expect(response.body.error.code).toBe("PRECONDITION_REQUIRED");
    });

    it("writes nothing when the precondition is missing", async () => {
      const task = aTask({ title: "Before" });
      const { app } = harness({ tasks: [task] });

      await request(app)
        .patch(`/api/tasks/${task.id}`)
        .send({ title: "After" });
      const after = await request(app).get(`/api/tasks/${task.id}`);

      expect(after.body).toEqual(asWireTask(task));
    });

    it("refuses an edit whose If-Match is a Version the Task has moved past", async () => {
      const task = aTask({ title: "Before", version: 5 });
      const { app } = harness({ tasks: [task] });

      const response = await request(app)
        .patch(`/api/tasks/${task.id}`)
        .set("If-Match", etagFor(4))
        .send({ title: "After" });

      expect(response.status).toBe(412);
      expect(response.body.error.code).toBe("VERSION_CONFLICT");
    });

    it("writes nothing when the precondition is stale", async () => {
      const task = aTask({ title: "Before", version: 5 });
      const { app } = harness({ tasks: [task] });

      await request(app)
        .patch(`/api/tasks/${task.id}`)
        .set("If-Match", etagFor(4))
        .send({ title: "After" });
      const after = await request(app).get(`/api/tasks/${task.id}`);

      expect(after.body).toEqual(asWireTask(task));
    });

    it("refuses an If-Match it cannot read as a Version", async () => {
      const task = aTask();
      const { app } = harness({ tasks: [task] });

      const response = await request(app)
        .patch(`/api/tasks/${task.id}`)
        .set("If-Match", "*")
        .send({ title: "After" });

      // A deliberate deviation from RFC 9110, which defines `*` as matching
      // any existing representation. "Whatever Version it is on, write anyway"
      // is the clobbering this endpoint exists to refuse (PLAN.md §6).
      expect(response.status).toBe(412);
      expect(response.body.error.code).toBe("VERSION_CONFLICT");
    });

    it("lets only one of two edits from the same read succeed", async () => {
      const task = aTask({ title: "Before", version: 1 });
      const { app } = harness({ tasks: [task] });
      // Both tabs read the Task once and hold that tag. Asking the repository
      // for the Version again between the two would be the re-read this whole
      // mechanism exists to make unnecessary.
      const held = etagFor(task.version);

      const first = await editAt(app, task, held).send({ title: "Mine" });
      const second = await editAt(app, task, held).send({ title: "Theirs" });

      expect(first.status).toBe(200);
      // The second held the Version the first consumed. This is the whole
      // point: the loser is told, not silently applied on top.
      expect(second.status).toBe(412);
      expect(second.body.error.code).toBe("VERSION_CONFLICT");
    });

    it("keeps the winner's edit when the loser is refused", async () => {
      const task = aTask({ title: "Before" });
      const { app } = harness({ tasks: [task] });
      const held = etagFor(task.version);

      await editAt(app, task, held).send({ title: "Mine" });
      await editAt(app, task, held).send({ title: "Theirs" });
      const after = await request(app).get(`/api/tasks/${task.id}`);

      expect(after.body.title).toBe("Mine");
      expect(after.body.version).toBe(2);
    });

    it("reports a stale edit as a conflict, not as a closed field", async () => {
      // The Task was PENDING when this caller read it at version 1, and has
      // since been started and finished by someone else.
      const task = aTask({ status: "DONE", version: 3 });
      const { app } = harness({ tasks: [task] });

      const response = await editAt(app, task, etagFor(1)).send({
        description: "Written against the PENDING copy",
      });

      // Not FIELD_NOT_EDITABLE: the description is closed on the Task as it is
      // now, but the caller never saw that Status. Their copy is stale, and a
      // stale copy is what the frontend refreshes on.
      expect(response.status).toBe(412);
      expect(response.body.error.code).toBe("VERSION_CONFLICT");
    });

    it("reports a stale edit as a conflict, not as a no-op", async () => {
      const task = aTask({ title: "Renamed elsewhere", version: 3 });
      const { app } = harness({ tasks: [task] });

      // The same title the Task now has — but arrived at independently, from a
      // copy two Versions old.
      const response = await editAt(app, task, etagFor(1)).send({
        title: "Renamed elsewhere",
      });

      expect(response.status).toBe(412);
      expect(response.body.error.code).toBe("VERSION_CONFLICT");
    });

    it("still reports a missing Task as NOT_FOUND when the precondition is unreadable", async () => {
      const theirs = aTask({ ownerId: OTHER_USER_ID });
      const { app } = harness({ tasks: [theirs] });

      const response = await editAt(app, theirs, "*").send({ title: "After" });

      // The precondition is checked against a Task, never before one is found,
      // so a 412 here would confirm that someone else's Task exists.
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe("NOT_FOUND");
    });

    it("reports a stale Version differently from an illegal Transition", async () => {
      const stale = aTask({ status: "PENDING", version: 2 });
      const archived = aTask({ status: "ARCHIVED" });
      const { app } = harness({ tasks: [stale, archived] });

      const [conflict, transition] = await Promise.all([
        request(app)
          .patch(`/api/tasks/${stale.id}`)
          .set("If-Match", etagFor(1))
          .send({ title: "After" }),
        request(app).post(`/api/tasks/${archived.id}/start`),
      ]);

      // 412 against 409. The frontend branches on the code, and the two have
      // different recoveries: refresh and retry, against nothing to retry.
      expect(conflict.body.error.code).toBe("VERSION_CONFLICT");
      expect(transition.body.error.code).toBe("INVALID_TRANSITION");
    });
  });

  describe("the field whitelist", () => {
    it("lets a DONE Task's title be fixed", async () => {
      const task = aTask({ status: "DONE", title: "Typo" });
      const { app } = harness({ tasks: [task] });

      const response = await editing(app, task).send({ title: "Fixed" });

      expect(response.status).toBe(200);
      expect(response.body.title).toBe("Fixed");
    });

    it("refuses a DONE Task's description", async () => {
      const task = aTask({ status: "DONE", description: "The plan" });
      const { app } = harness({ tasks: [task] });

      const response = await editing(app, task).send({ description: "New" });

      // The description is the plan, and the work is over.
      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe("FIELD_NOT_EDITABLE");
    });

    it("refuses the whole edit when one named field is closed", async () => {
      const task = aTask({ status: "DONE", title: "Typo" });
      const { app } = harness({ tasks: [task] });

      const response = await editing(app, task).send({
        title: "Fixed",
        description: "New",
      });
      const after = await request(app).get(`/api/tasks/${task.id}`);

      expect(response.status).toBe(422);
      // Not partly applied: the title the same request also named is untouched.
      expect(after.body.title).toBe("Typo");
      expect(after.body.version).toBe(task.version);
    });

    it("names the closed field, so a form can mark it", async () => {
      const task = aTask({ status: "DONE" });
      const { app } = harness({ tasks: [task] });

      const response = await editing(app, task).send({ description: "New" });

      expect(response.body.error.details).toEqual([
        expect.objectContaining({ path: ["description"] }),
      ]);
    });

    it("refuses every field on an ARCHIVED Task", async () => {
      const task = aTask({ status: "ARCHIVED" });
      const { app } = harness({ tasks: [task] });

      const [title, description] = await Promise.all([
        editing(app, task).send({ title: "After" }),
        editing(app, task).send({ description: "After" }),
      ]);

      // Archived is finished and put away (CONTEXT.md, "Archived").
      expect(title.body.error.code).toBe("FIELD_NOT_EDITABLE");
      expect(description.body.error.code).toBe("FIELD_NOT_EDITABLE");
    });

    it("reports a closed field differently from an illegal Transition", async () => {
      const task = aTask({ status: "ARCHIVED" });
      const { app } = harness({ tasks: [task] });

      const response = await editing(app, task).send({ title: "After" });

      // Both are "an ARCHIVED Task will not do that", and they are still
      // different answers: nothing here is being asked to move.
      expect(response.status).toBe(422);
      expect(response.body.error.code).not.toBe("INVALID_TRANSITION");
    });

    /** Every Status against every field the whitelist knows about. */
    const everyField = LIFECYCLE.flatMap((status) =>
      EDITABLE_FIELDS.map((field) => ({ status, field })),
    );

    it("tries every field against every Status", () => {
      // The claim the table below rests on: this is the whole whitelist, not a
      // sample of it.
      expect(everyField).toHaveLength(
        LIFECYCLE.length * EDITABLE_FIELDS.length,
      );
    });

    it.each(everyField)(
      "agrees with canEdit about $field on a $status Task",
      async ({ status, field }) => {
        const task = aTask({ status, title: "Before", description: "Before" });
        const { app } = harness({ tasks: [task] });

        const response = await editing(app, task).send({ [field]: "After" });

        // The API and the UI ask the same predicate, so an enabled input can
        // never produce a FIELD_NOT_EDITABLE the person did not expect.
        expect(response.status).toBe(canEdit(status, field) ? 200 : 422);
      },
    );
  });

  describe("edits it refuses outright", () => {
    it("rejects an edit that names nothing", async () => {
      const task = aTask();
      const { app } = harness({ tasks: [task] });

      const response = await editing(app, task).send({});

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe("VALIDATION_FAILED");
    });

    it("rejects an edit whose fields already hold those values", async () => {
      const task = aTask({ title: "Same", description: "Also same" });
      const { app } = harness({ tasks: [task] });

      const response = await editing(app, task).send({
        title: "Same",
        description: "Also same",
      });

      // A Version is the record that a Task changed. Raising it here would
      // invalidate every other tab's If-Match over an edit that never happened.
      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe("VALIDATION_FAILED");
    });

    it("leaves the Version alone when the edit changes nothing", async () => {
      const task = aTask({ title: "Same", version: 1 });
      const { app } = harness({ tasks: [task] });

      await editing(app, task).send({ title: "Same" });
      const after = await request(app).get(`/api/tasks/${task.id}`);

      expect(after.body.version).toBe(1);
    });

    it("accepts an edit where only one of two fields differs", async () => {
      const task = aTask({ title: "Same", description: "Before" });
      const { app } = harness({ tasks: [task] });

      const response = await editing(app, task).send({
        title: "Same",
        description: "After",
      });

      expect(response.status).toBe(200);
    });

    it("rejects a Status rather than silently dropping it", async () => {
      const task = aTask({ status: "PENDING" });
      const { app } = harness({ tasks: [task] });

      const response = await editing(app, task).send({
        title: "After",
        status: "DONE",
      });

      // Status moves through the Transition endpoints only, so that
      // `mark_task_done()` stays the single entrance to DONE.
      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe("VALIDATION_FAILED");
    });

    it("leaves the Status alone when it refuses one", async () => {
      const task = aTask({ status: "PENDING" });
      const { app } = harness({ tasks: [task] });

      await editing(app, task).send({ title: "After", status: "DONE" });
      const after = await request(app).get(`/api/tasks/${task.id}`);

      expect(after.body.status).toBe("PENDING");
    });

    it("rejects a Version in the body, which travels as a header", async () => {
      const task = aTask();
      const { app } = harness({ tasks: [task] });

      const response = await editing(app, task).send({
        title: "After",
        version: 99,
      });

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe("VALIDATION_FAILED");
    });

    it("rejects a title beyond the cap", async () => {
      const task = aTask();
      const { app } = harness({ tasks: [task] });

      const response = await editing(app, task).send({
        title: "a".repeat(201),
      });

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe("VALIDATION_FAILED");
    });

    it("never reaches the repository with an edit it refused", async () => {
      const task = aTask();
      const update = jest.fn(async () => ({ outcome: "not_found" }) as const);
      const { app } = harness({ tasks: [task], taskRepository: { update } });

      await editing(app, task).send({ title: "   " });

      expect(update).not.toHaveBeenCalled();
    });
  });

  describe("Tasks it will not edit", () => {
    it("reports a Task owned by someone else as NOT_FOUND", async () => {
      const theirs = aTask({ ownerId: OTHER_USER_ID });
      const { app } = harness({ tasks: [theirs] });

      const response = await editing(app, theirs).send({ title: "After" });

      // 404 and not 412: a Task the Actor cannot see has no Version to be
      // stale against.
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe("NOT_FOUND");
    });

    it("leaves another Actor's Task untouched", async () => {
      const theirs = aTask({ title: "Theirs", ownerId: OTHER_USER_ID });
      const { app } = harness({ tasks: [theirs] });
      const { app: theirApp } = harness({
        tasks: [theirs],
        requireAuth: authenticateAs(OTHER_USER_ID),
      });

      await editing(app, theirs).send({ title: "Mine now" });
      const after = await request(theirApp).get(`/api/tasks/${theirs.id}`);

      expect(after.body.title).toBe("Theirs");
    });

    it("answers identically for a Task that exists elsewhere and one that does not", async () => {
      const theirs = aTask({ ownerId: OTHER_USER_ID });
      const { app } = harness({ tasks: [theirs] });

      const [notOwned, absent] = await Promise.all([
        editing(app, theirs).send({ title: "After" }),
        request(app)
          .patch(`/api/tasks/${ABSENT_ID}`)
          .set("If-Match", etagFor(theirs.version))
          .send({ title: "After" }),
      ]);

      expect(notOwned.status).toBe(absent.status);
      expect(notOwned.body).toEqual(absent.body);
    });

    it("reports a malformed id as NOT_FOUND without reaching the repository", async () => {
      const update = jest.fn(async () => ({ outcome: "not_found" }) as const);
      const { app } = harness({ taskRepository: { update } });

      const response = await request(app)
        .patch(`/api/tasks/${MALFORMED_ID}`)
        .set("If-Match", etagFor(1))
        .send({ title: "After" });

      expect(response.status).toBe(404);
      expect(update).not.toHaveBeenCalled();
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

  // Which Statuses it refuses to start from is not asserted here: "the Status
  // machine over HTTP" below walks every Status against every Transition
  // endpoint, so a sample would only be a subset of what already runs.
  describe("the moves it refuses", () => {
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
      // failure would make a Replay look like a request that was lost.
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

  it("completes once and succeeds twice when the same Task is asked twice", async () => {
    const task = started();
    const { app } = harness({ tasks: [task] });

    const [first, second] = await Promise.all([
      request(app).post(`/api/tasks/${task.id}/done`),
      request(app).post(`/api/tasks/${task.id}/done`),
    ]);

    // One completion, two identical successes. Which request won is not the
    // point and is not asserted; that exactly one of them did is.
    //
    // This is the *route* holding up its end — two 200s, one body, one marked
    // a Replay. It is not proof of the concurrency design: the fake runs on
    // one event loop, where two requests cannot interleave. What serialises
    // real callers is the single conditional UPDATE in
    // `drizzle/0002_mark_task_done.sql`, and only Postgres can demonstrate it.
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(first.body).toEqual(second.body);
    expect(
      [first, second].filter(
        (response) => response.headers["x-idempotent-replay"] === "true",
      ),
    ).toHaveLength(1);
  });

  describe("the moves it refuses", () => {
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

describe("POST /api/tasks/:id/archive", () => {
  /** A Task in the one Status that can be archived. */
  const finished = (overrides: Partial<OwnedTask> = {}) =>
    aTask({
      status: "DONE",
      completedAt: "2026-02-01T00:00:00.000Z",
      ...overrides,
    });

  it("moves a DONE Task to ARCHIVED", async () => {
    const task = finished({ version: 3 });
    const { app } = harness({ tasks: [task] });

    const response = await request(app).post(`/api/tasks/${task.id}/archive`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: task.id,
      status: "ARCHIVED",
      version: 4,
    });
  });

  it("returns a response the shared schema accepts, with the new ETag", async () => {
    const task = finished({ version: 3 });
    const { app } = harness({ tasks: [task] });

    const response = await request(app).post(`/api/tasks/${task.id}/archive`);

    expect(() => TaskSchema.parse(response.body)).not.toThrow();
    expect(response.headers.etag).toBe('"4"');
  });

  it("keeps the completion time it was archived with", async () => {
    const task = finished();
    const { app } = harness({ tasks: [task] });

    const response = await request(app).post(`/api/tasks/${task.id}/archive`);

    // Archiving files the work away; it does not un-finish it, and the record
    // of when it was finished is the part worth keeping.
    expect(response.body.completedAt).toBe("2026-02-01T00:00:00.000Z");
  });

  it("takes the archived Task out of the unfiltered list", async () => {
    const task = finished();
    const { app } = harness({ tasks: [task] });

    await request(app).post(`/api/tasks/${task.id}/archive`);
    const list = await request(app).get("/api/tasks");

    // Archiving files the Task away, and the list a person works from is what
    // it is filed away from (CONTEXT.md, "Archived").
    expect(list.body.items).toEqual([]);
    expect(list.body.total).toBe(0);
  });

  it("keeps it reachable through the Archived filter", async () => {
    const task = finished();
    const { app } = harness({ tasks: [task] });

    await request(app).post(`/api/tasks/${task.id}/archive`);
    const list = await request(app).get("/api/tasks?status=ARCHIVED");

    // Which is what makes the line above a default and not a soft delete: the
    // row is still there, and one filter away.
    expect(idsOf(list.body.items)).toEqual([task.id]);
    expect(list.body.items[0].status).toBe("ARCHIVED");
    expect(list.body.total).toBe(1);
  });

  it("takes no request body into account", async () => {
    const task = finished();
    const { app } = harness({ tasks: [task] });

    const response = await request(app)
      .post(`/api/tasks/${task.id}/archive`)
      .send({ status: "DONE" });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ARCHIVED");
  });

  it("scopes the Transition to the Actor", async () => {
    const archive = jest.fn(async () => ({ outcome: "not_found" }) as const);
    const { app } = harness({ taskRepository: { archive } });

    await request(app).post(`/api/tasks/${ABSENT_ID}/archive`);

    expect(archive).toHaveBeenCalledWith({
      userId: TEST_USER_ID,
      id: ABSENT_ID,
    });
  });

  describe("the moves it refuses", () => {
    it("reports a Task owned by someone else as NOT_FOUND", async () => {
      const theirs = finished({ ownerId: OTHER_USER_ID });
      const { app } = harness({ tasks: [theirs] });

      const response = await request(app).post(
        `/api/tasks/${theirs.id}/archive`,
      );

      // 404 and not 409: a Task the Actor cannot see has no Status to refuse.
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe("NOT_FOUND");
    });

    it("leaves another Actor's Task untouched", async () => {
      const theirs = finished({ ownerId: OTHER_USER_ID });
      const { app } = harness({ tasks: [theirs] });
      const { app: theirApp } = harness({
        tasks: [theirs],
        requireAuth: authenticateAs(OTHER_USER_ID),
      });

      await request(app).post(`/api/tasks/${theirs.id}/archive`);
      const after = await request(theirApp).get(`/api/tasks/${theirs.id}`);

      expect(after.body.status).toBe("DONE");
    });

    it("answers identically for a Task that exists elsewhere and one that does not", async () => {
      const theirs = finished({ ownerId: OTHER_USER_ID });
      const { app } = harness({ tasks: [theirs] });

      const [notOwned, absent] = await Promise.all([
        request(app).post(`/api/tasks/${theirs.id}/archive`),
        request(app).post(`/api/tasks/${ABSENT_ID}/archive`),
      ]);

      expect(notOwned.status).toBe(absent.status);
      expect(notOwned.body).toEqual(absent.body);
    });

    it("reports a malformed id as NOT_FOUND without reaching the repository", async () => {
      const archive = jest.fn(async () => ({ outcome: "not_found" }) as const);
      const { app } = harness({ taskRepository: { archive } });

      const response = await request(app).post(
        `/api/tasks/${MALFORMED_ID}/archive`,
      );

      expect(response.status).toBe(404);
      expect(archive).not.toHaveBeenCalled();
    });
  });
});

describe("DELETE /api/tasks/:id", () => {
  it("removes the Task and answers with no content", async () => {
    const task = aTask();
    const { app } = harness({ tasks: [task] });

    const response = await request(app).delete(`/api/tasks/${task.id}`);

    // `204`, not `200` with the Task: there is no Task any more, and a body
    // describing one would be describing something that no longer exists.
    expect(response.status).toBe(204);
    expect(response.body).toEqual({});
  });

  it("takes the Task out of the list", async () => {
    const kept = aTask();
    const deleted = aTask();
    const { app } = harness({ tasks: [kept, deleted] });

    await request(app).delete(`/api/tasks/${deleted.id}`);
    const list = await request(app).get("/api/tasks");

    // Unlike Archived, which leaves the list but stays one filter away, a
    // deleted Task is gone — and `total` has to say so, or the pager offers a
    // page that is no longer there.
    expect(idsOf(list.body.items)).toEqual([kept.id]);
    expect(list.body.total).toBe(1);
  });

  it("leaves nothing to find afterwards", async () => {
    const task = aTask();
    const { app } = harness({ tasks: [task] });

    await request(app).delete(`/api/tasks/${task.id}`);
    const after = await request(app).get(`/api/tasks/${task.id}`);

    expect(after.status).toBe(404);
  });

  it("scopes the delete to the Actor", async () => {
    const remove = jest.fn(async () => false);
    const { app } = harness({ taskRepository: { delete: remove } });

    await request(app).delete(`/api/tasks/${ABSENT_ID}`);

    expect(remove).toHaveBeenCalledWith({
      userId: TEST_USER_ID,
      id: ABSENT_ID,
    });
  });

  it("needs no If-Match, because there is no Version a delete could clobber", async () => {
    const task = aTask({ version: 7 });
    const { app } = harness({ tasks: [task] });

    const response = await request(app).delete(`/api/tasks/${task.id}`);

    // The `428` a bodiless `PATCH` gets is about protecting an edit from
    // overwriting someone else's words. A delete has no words to overwrite.
    expect(response.status).toBe(204);
  });

  describe("every Status it deletes from", () => {
    it("covers the whole lifecycle", () => {
      // Guards the table below: add a Status and this fails until the case is
      // covered, rather than silently testing three of four.
      expect(LIFECYCLE).toHaveLength(4);
    });

    it.each(LIFECYCLE)("deletes a %s Task", async (status) => {
      const task = aTask({ status });
      const { app } = harness({ tasks: [task] });

      const response = await request(app).delete(`/api/tasks/${task.id}`);

      // Deliberately unrestricted: the brief says "Delete Task" flat, and a
      // restriction it does not ask for would be the worse deviation
      // (PLAN.md §7). `ARCHIVED` is terminal for Transitions, not for this.
      expect(response.status).toBe(204);
    });
  });

  describe("the deletes it refuses", () => {
    it("reports a second delete of the same Task as NOT_FOUND", async () => {
      const task = aTask();
      const { app } = harness({ tasks: [task] });

      const first = await request(app).delete(`/api/tasks/${task.id}`);
      const second = await request(app).delete(`/api/tasks/${task.id}`);

      // Not a Replay. Mark Done can repeat because the Task is still there to
      // report as finished; a deleted Task is not there to report anything
      // about, so the honest answer is that it is gone.
      expect(first.status).toBe(204);
      expect(second.status).toBe(404);
      expect(second.body.error.code).toBe("NOT_FOUND");
    });

    it("reports a Task owned by someone else as NOT_FOUND", async () => {
      const theirs = aTask({ ownerId: OTHER_USER_ID });
      const { app } = harness({ tasks: [theirs] });

      const response = await request(app).delete(`/api/tasks/${theirs.id}`);

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe("NOT_FOUND");
    });

    it("leaves another Actor's Task where it was", async () => {
      const theirs = aTask({ ownerId: OTHER_USER_ID });
      const { app } = harness({ tasks: [theirs] });
      const { app: theirApp } = harness({
        tasks: [theirs],
        requireAuth: authenticateAs(OTHER_USER_ID),
      });

      await request(app).delete(`/api/tasks/${theirs.id}`);
      const after = await request(theirApp).get(`/api/tasks/${theirs.id}`);

      expect(after.status).toBe(200);
    });

    it("answers identically for a Task that exists elsewhere and one that does not", async () => {
      const theirs = aTask({ ownerId: OTHER_USER_ID });
      const { app } = harness({ tasks: [theirs] });

      const [notOwned, absent] = await Promise.all([
        request(app).delete(`/api/tasks/${theirs.id}`),
        request(app).delete(`/api/tasks/${ABSENT_ID}`),
      ]);

      expect(notOwned.status).toBe(absent.status);
      expect(notOwned.body).toEqual(absent.body);
    });

    it("reports a malformed id as NOT_FOUND without reaching the repository", async () => {
      const remove = jest.fn(async () => false);
      const { app } = harness({ taskRepository: { delete: remove } });

      const response = await request(app).delete(`/api/tasks/${MALFORMED_ID}`);

      expect(response.status).toBe(404);
      expect(remove).not.toHaveBeenCalled();
    });
  });
});

/**
 * Each Transition endpoint, and the Status the machine calls its destination.
 * The table below is built from this and `LIFECYCLE`, so it covers every
 * Transition the API can be asked for rather than the ones anyone thought to
 * list — add a Status to the lifecycle and the missing cases appear on their
 * own.
 */
const TRANSITION_ENDPOINTS = [
  { path: "start", to: "IN_PROGRESS" },
  { path: "done", to: "DONE" },
  { path: "archive", to: "ARCHIVED" },
] as const satisfies readonly { path: string; to: TaskStatus }[];

/** Every Status a Task could be in, against every Transition it could be asked to make. */
const everyMove = TRANSITION_ENDPOINTS.flatMap(({ path, to }) =>
  LIFECYCLE.map((from) => ({ path, to, from })),
);

/**
 * Marking an already-`DONE` Task Done. Not an illegal move and not a legal
 * one: nothing is written and the request still succeeds (CONTEXT.md,
 * "Replay"). It is asserted in the `/done` block above, and excluded here.
 */
const isReplay = ({ from, to }: { from: TaskStatus; to: TaskStatus }) =>
  from === "DONE" && to === "DONE";

const legalMoves = everyMove.filter(({ from, to }) => canTransition(from, to));
const illegalMoves = everyMove.filter(
  (move) => !canTransition(move.from, move.to) && !isReplay(move),
);

describe("the Status machine over HTTP", () => {
  it("exposes one endpoint per Transition the machine allows", () => {
    // Every Status something transitions into — which is every Status except
    // the one Tasks start in — has an endpoint that moves a Task there. Add a
    // Status to the lifecycle without a route and this fails.
    expect(TRANSITION_ENDPOINTS.map(({ to }) => to)).toEqual(
      LIFECYCLE.filter((status) => statusBefore(status) !== null),
    );
  });

  it("tries every Status against every endpoint", () => {
    // The claim the table below rests on: this is the whole machine, not a
    // sample of it.
    expect(everyMove).toHaveLength(
      LIFECYCLE.length * TRANSITION_ENDPOINTS.length,
    );
    expect(legalMoves.length + illegalMoves.length + 1).toBe(everyMove.length);
  });

  it.each(legalMoves)(
    "moves a $from Task to $to",
    async ({ from, path, to }) => {
      const task = aTask({ status: from });
      const { app } = harness({ tasks: [task] });

      const response = await request(app).post(`/api/tasks/${task.id}/${path}`);

      expect(response.status).toBe(200);
      expect(response.body.status).toBe(to);
    },
  );

  it.each(illegalMoves)(
    "refuses $from → $to as INVALID_TRANSITION",
    async ({ from, path }) => {
      const task = aTask({ status: from });
      const { app } = harness({ tasks: [task] });

      const response = await request(app).post(`/api/tasks/${task.id}/${path}`);

      // 409, not 412: nothing about this is a stale read — the move itself is
      // not one the lifecycle allows. Skipping a step, reverting, and asking
      // anything at all of an ARCHIVED Task all arrive here.
      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe("INVALID_TRANSITION");
    },
  );

  it.each(illegalMoves)(
    "leaves a $from Task refused $to exactly as it was",
    async ({ from, path }) => {
      const task = aTask({ status: from, version: 4 });
      const { app } = harness({ tasks: [task] });

      await request(app).post(`/api/tasks/${task.id}/${path}`);
      const after = await request(app).get(`/api/tasks/${task.id}`);

      expect(after.body).toEqual(asWireTask(task));
    },
  );

  it.each(everyMove)(
    "reports another Actor's $from Task as NOT_FOUND on $path",
    async ({ from, path }) => {
      const theirs = aTask({ status: from, ownerId: OTHER_USER_ID });
      const { app } = harness({ tasks: [theirs] });

      const response = await request(app).post(
        `/api/tasks/${theirs.id}/${path}`,
      );

      // Not owned is not found, whatever Status it is in — otherwise a 409
      // would confirm that someone else's Task exists and say where it is in
      // its lifecycle.
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe("NOT_FOUND");
    },
  );
});
