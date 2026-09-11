import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";

import * as schema from "@/db/schema";
import { createDrizzleTaskRepository } from "@/tasks/repository.drizzle";

interface Statement {
  text: string;
  values: unknown[];
}

/**
 * One `tasks` row as `node-postgres` hands it back under Drizzle's
 * `rowMode: "array"` — positional, in the column order `db/schema.ts` declares.
 */
function aTaskRow(): unknown[] {
  return [
    "11111111-1111-4111-8111-111111111111",
    "auth0|owner",
    "A Task",
    null,
    "PENDING",
    1,
    new Date("2026-01-01T00:00:00.000Z"),
    new Date("2026-01-01T00:00:00.000Z"),
    null,
  ];
}

/** The same row as a list query sees it, with the window function's count last. */
function aListRow(total: number): unknown[] {
  return [...aTaskRow(), total];
}

/**
 * One row as `mark_task_done()` returns it: keyed by column name rather than
 * positional, because `db.execute` runs a raw statement with no Drizzle field
 * list to map, and snake_case because those are the table's own column names.
 *
 * The timestamps are Postgres's own text form rather than `Date` objects, for
 * the same reason — Drizzle replaces `node-postgres`'s timestamp parser with
 * one that hands the text straight through, and a raw statement has no column
 * mapper to turn it back.
 */
function aFunctionRow(
  outcome: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    outcome,
    id: "11111111-1111-4111-8111-111111111111",
    owner_id: "auth0|owner",
    title: "A Task",
    description: null,
    status: "DONE",
    version: 2,
    created_at: "2026-01-01 00:00:00+00",
    updated_at: "2026-02-01 00:00:00+00",
    completed_at: "2026-02-01 00:00:00+00",
    ...overrides,
  };
}

/**
 * Drizzle over a client that records the statement instead of sending it. There
 * is no Postgres here — what is under test is the SQL the repository builds,
 * not what Postgres does with it.
 *
 * The in-memory fake the HTTP tests run against cannot reach this. It
 * reimplements Owner scoping in TypeScript, so it proves the routes ask for the
 * right thing and says nothing about whether the SQL asks Postgres for it — a
 * missing `owner_id` predicate would pass every one of those tests while
 * leaking every Task in the table.
 */
function recordingRepository(rows: unknown[] = [], thenRows?: unknown[]) {
  const statements: Statement[] = [];

  const client = {
    query: async (config: { text: string }, values: unknown[]) => {
      statements.push({ text: config.text, values });

      // `thenRows` answers the second statement, which is the follow-up read a
      // guarded Transition makes when its `UPDATE` matched nothing. Without a
      // way to answer the two differently, the read can only ever come back
      // empty and the `wrong_status` arm is unreachable.
      const answer = statements.length === 2 && thenRows ? thenRows : rows;

      return {
        rows: answer,
        rowCount: answer.length,
        command: "SELECT",
        fields: [],
      };
    },
  };

  return {
    statements,
    repository: createDrizzleTaskRepository(
      drizzle(client as unknown as Pool, { schema }),
    ),
  };
}

const normalise = (text: string) => text.replaceAll(/\s+/g, " ").trim();

/**
 * The columns an `UPDATE` assigns — what it writes, as opposed to the columns
 * its `returning` reads back. A test about what a statement leaves alone has
 * to look here and not at the whole text, where every column is named.
 */
const setClauseOf = (text: string) =>
  normalise(text).replace(/^.*?\bset\b\s*/, "").replace(/\s*\bwhere\b.*$/, "");

describe("createDrizzleTaskRepository", () => {
  describe("list", () => {
    it("filters on the Owner, with the User ID bound rather than interpolated", async () => {
      const { repository, statements } = recordingRepository();

      await repository.list({ userId: "auth0|owner", page: 1, pageSize: 10 });

      const [listed] = statements;
      expect(normalise(listed.text)).toContain('"tasks"."owner_id" = $1');
      expect(listed.values).toContain("auth0|owner");
      // Bound, not spliced: a User ID is whatever Auth0 issues, and the query
      // must not care whether it contains a quote.
      expect(listed.text).not.toContain("auth0|owner");
    });

    it("orders newest first, with a tiebreaker", async () => {
      const { repository, statements } = recordingRepository();

      await repository.list({ userId: "auth0|owner", page: 1, pageSize: 10 });

      expect(normalise(statements[0].text)).toContain(
        'order by "tasks"."created_at" desc, "tasks"."id" desc',
      );
    });

    it("reads the page and its total in one round trip", async () => {
      const { repository, statements } = recordingRepository([aListRow(3)]);

      const result = await repository.list({
        userId: "auth0|owner",
        page: 1,
        pageSize: 10,
      });

      expect(result.total).toBe(3);
      expect(statements).toHaveLength(1);
      expect(normalise(statements[0].text)).toContain("count(*) over()");
    });

    it("offsets by whole pages", async () => {
      const { repository, statements } = recordingRepository([aListRow(99)]);

      await repository.list({ userId: "auth0|owner", page: 3, pageSize: 25 });

      // 25 to a page, third page: skip the first 50.
      expect(statements[0].values).toEqual(["auth0|owner", 25, 50]);
    });

    it("adds no Status predicate when none was asked for", async () => {
      const { repository, statements } = recordingRepository([aListRow(1)]);

      await repository.list({ userId: "auth0|owner", page: 1, pageSize: 10 });

      // Archived is a Status, not a soft delete: an unfiltered list shows it.
      expect(statements[0].text).not.toContain('"status" =');
    });

    it("adds one when it was", async () => {
      const { repository, statements } = recordingRepository([aListRow(1)]);

      await repository.list({
        userId: "auth0|owner",
        page: 1,
        pageSize: 10,
        status: "DONE",
      });

      expect(normalise(statements[0].text)).toContain('"tasks"."status" = $2');
      expect(statements[0].values).toContain("DONE");
    });

    it("counts separately when the page came back empty", async () => {
      const { repository, statements } = recordingRepository([]);

      await repository.list({ userId: "auth0|owner", page: 9, pageSize: 10 });

      // A window function has no row to report a count on, so the empty page —
      // and only the empty page — pays for a second statement.
      expect(statements).toHaveLength(2);
      expect(normalise(statements[1].text)).toContain("count(*)");
      // Still Owner-scoped: the fallback must not total the whole table.
      expect(statements[1].values).toEqual(["auth0|owner"]);
    });

    it("keeps the Status filter on the fallback count", async () => {
      const { repository, statements } = recordingRepository([]);

      await repository.list({
        userId: "auth0|owner",
        page: 9,
        pageSize: 10,
        status: "DONE",
      });

      // Otherwise a filtered list past its end reports the unfiltered total and
      // the pager offers pages that are all empty.
      expect(statements[1].values).toEqual(["auth0|owner", "DONE"]);
    });
  });

  describe("findById", () => {
    it("matches on the id and the Owner together", async () => {
      const { repository, statements } = recordingRepository();

      await repository.findById({
        userId: "auth0|owner",
        id: "11111111-1111-4111-8111-111111111111",
      });

      // One predicate, so a Task belonging to someone else simply does not
      // match — there is no branch that could answer `403` by accident.
      expect(normalise(statements[0].text)).toContain(
        '("tasks"."id" = $1 and "tasks"."owner_id" = $2)',
      );
      // The trailing 1 is the `limit`, which is bound like any other value.
      expect(statements[0].values).toEqual([
        "11111111-1111-4111-8111-111111111111",
        "auth0|owner",
        1,
      ]);
    });

    it("returns null when nothing matched", async () => {
      const { repository } = recordingRepository([]);

      await expect(
        repository.findById({
          userId: "auth0|owner",
          id: "11111111-1111-4111-8111-111111111111",
        }),
      ).resolves.toBeNull();
    });

    it("maps a matched row onto the wire shape", async () => {
      const { repository } = recordingRepository([aTaskRow()]);

      const task = await repository.findById({
        userId: "auth0|owner",
        id: "11111111-1111-4111-8111-111111111111",
      });

      expect(task).toEqual({
        id: "11111111-1111-4111-8111-111111111111",
        title: "A Task",
        description: null,
        status: "PENDING",
        version: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        completedAt: null,
      });
    });
  });

  describe("create", () => {
    const draft = {
      userId: "auth0|owner",
      title: "A Task",
      description: null,
    };

    it("inserts under the Actor, with the values bound", async () => {
      const { repository, statements } = recordingRepository([aTaskRow()]);

      await repository.create(draft);

      const [inserted] = statements;
      expect(normalise(inserted.text)).toContain('insert into "tasks"');
      expect(inserted.values).toEqual(["auth0|owner", "A Task", null]);
    });

    it("leaves the starting Status to the column default", async () => {
      const { repository, statements } = recordingRepository([aTaskRow()]);

      await repository.create(draft);

      // Only the Owner, the title and the description are bound; every other
      // column is `default`, Status and Version included. Naming either here
      // would be a second place the lifecycle starts, and the one in the
      // database is the one that holds for writes that do not come from here.
      expect(normalise(statements[0].text)).toContain(
        "values (default, $1, $2, $3, default, default, default, default, default)",
      );
      expect(statements[0].values).toHaveLength(3);
    });

    it("returns the stored Task in one round trip", async () => {
      const { repository, statements } = recordingRepository([aTaskRow()]);

      const created = await repository.create(draft);

      // `returning` rather than an insert followed by a read: the id and the
      // timestamps are the database's, and a second statement could observe a
      // row someone else had already changed.
      expect(statements).toHaveLength(1);
      expect(normalise(statements[0].text)).toContain("returning");
      expect(created).toEqual({
        id: "11111111-1111-4111-8111-111111111111",
        title: "A Task",
        description: null,
        status: "PENDING",
        version: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        completedAt: null,
      });
    });

    it("fails loudly if the insert returned nothing", async () => {
      const { repository } = recordingRepository([]);

      // Not reachable through Postgres, and not worth handing every caller a
      // `Task | undefined` to answer for.
      await expect(repository.create(draft)).rejects.toThrow();
    });
  });

  describe("update", () => {
    const query = {
      userId: "auth0|owner",
      id: "11111111-1111-4111-8111-111111111111",
    };

    it("updates under a guard on the id, the Owner and the Version", async () => {
      const { repository, statements } = recordingRepository([aTaskRow()]);

      await repository.update({
        ...query,
        expectedVersion: 4,
        changes: { title: "After" },
      });

      const [updated] = statements;
      expect(normalise(updated.text)).toContain('update "tasks"');
      // The Version in the `WHERE` is what makes this optimistic locking: two
      // Actors holding the same one both run this and only one matches a row.
      expect(normalise(updated.text)).toContain(
        '("tasks"."id" = $2 and "tasks"."owner_id" = $3 and "tasks"."version" = $4)',
      );
      expect(updated.values).toEqual(["After", query.id, query.userId, 4]);
    });

    it("raises the Version so a held ETag stops matching", async () => {
      const { repository, statements } = recordingRepository([aTaskRow()]);

      await repository.update({
        ...query,
        expectedVersion: 1,
        changes: { title: "After" },
      });

      expect(normalise(statements[0].text)).toContain(
        '"version" = "tasks"."version" + 1',
      );
    });

    it("assigns only the columns the edit named", async () => {
      const { repository, statements } = recordingRepository([aTaskRow()]);

      await repository.update({
        ...query,
        expectedVersion: 1,
        changes: { title: "After" },
      });

      // An unnamed field is not a key in `changes`, so `set` never mentions its
      // column — the difference between "leave the description alone" and
      // "write `undefined` over it".
      const assigned = setClauseOf(statements[0].text);
      expect(assigned).toContain('"title"');
      expect(assigned).not.toContain('"description"');
    });

    it("assigns a null description when the edit asks for one", async () => {
      const { repository, statements } = recordingRepository([aTaskRow()]);

      await repository.update({
        ...query,
        expectedVersion: 1,
        changes: { description: null },
      });

      expect(setClauseOf(statements[0].text)).toContain('"description"');
      expect(statements[0].values).toContain(null);
    });

    it("leaves updated_at to the trigger", async () => {
      const { repository, statements } = recordingRepository([aTaskRow()]);

      await repository.update({
        ...query,
        expectedVersion: 1,
        changes: { title: "After" },
      });

      // `tasks_set_updated_at` maintains it. Assigning it here would be a
      // second place the modification time is decided, and the trigger's is the
      // one that holds for a write that does not come from this process.
      expect(setClauseOf(statements[0].text)).not.toContain("updated_at");
    });

    it("never assigns the Status", async () => {
      const { repository, statements } = recordingRepository([aTaskRow()]);

      await repository.update({
        ...query,
        expectedVersion: 1,
        changes: { title: "After" },
      });

      // A Task moves through the Transition endpoints only, so that
      // `mark_task_done()` stays the single entrance to DONE.
      expect(setClauseOf(statements[0].text)).not.toContain("status");
    });

    it("reads nothing more when the update changed a row", async () => {
      const { repository, statements } = recordingRepository([aTaskRow()]);

      const result = await repository.update({
        ...query,
        expectedVersion: 1,
        changes: { title: "After" },
      });

      expect(result).toMatchObject({ outcome: "changed" });
      expect(statements).toHaveLength(1);
    });

    it("reports a Task that is still there as stale, not missing", async () => {
      // The guarded update matches nothing; the follow-up read finds the Task.
      const { repository, statements } = recordingRepository([], [aTaskRow()]);

      const result = await repository.update({
        ...query,
        expectedVersion: 1,
        changes: { title: "After" },
      });

      expect(statements).toHaveLength(2);
      // 412 rather than 404: the Task is real and owned, it has just moved on.
      expect(result).toMatchObject({ outcome: "stale" });
    });

    it("reports a Task that is not the Actor's as missing", async () => {
      const { repository, statements } = recordingRepository([]);

      const result = await repository.update({
        ...query,
        expectedVersion: 1,
        changes: { title: "After" },
      });

      // Owner-scoped like every other read, so someone else's Task is simply
      // absent rather than forbidden.
      expect(statements[1].values).toEqual([query.id, query.userId, 1]);
      expect(result).toEqual({ outcome: "not_found" });
    });
  });

  describe("start", () => {
    const query = {
      userId: "auth0|owner",
      id: "11111111-1111-4111-8111-111111111111",
    };

    it("updates under a guard on the id, the Owner and the current Status", async () => {
      const { repository, statements } = recordingRepository([aTaskRow()]);

      await repository.start(query);

      const [updated] = statements;
      expect(normalise(updated.text)).toContain('update "tasks"');
      // All three in one statement, so the Transition is atomic: another
      // request moving the Task first simply stops this one matching.
      expect(normalise(updated.text)).toContain(
        '("tasks"."id" = $2 and "tasks"."owner_id" = $3 and "tasks"."status" = $4)',
      );
      expect(updated.values).toEqual([
        "IN_PROGRESS",
        query.id,
        query.userId,
        "PENDING",
      ]);
    });

    it("guards on the Status the shared machine names, not a spelled one", async () => {
      const { repository, statements } = recordingRepository([aTaskRow()]);

      await repository.start(query);

      // `statusBefore('IN_PROGRESS')`. Written here instead, it could disagree
      // with the rule the UI disables its buttons by.
      expect(statements[0].values).toContain("PENDING");
    });

    it("raises the Version so a held ETag stops matching", async () => {
      const { repository, statements } = recordingRepository([aTaskRow()]);

      await repository.start(query);

      expect(normalise(statements[0].text)).toContain(
        '"version" = "tasks"."version" + 1',
      );
    });

    it("reads nothing more when the update changed a row", async () => {
      const { repository, statements } = recordingRepository([aTaskRow()]);

      const result = await repository.start(query);

      expect(result).toMatchObject({ outcome: "changed" });
      expect(statements).toHaveLength(1);
    });

    it("asks why when it changed none", async () => {
      // The update matches nothing, and the follow-up read finds the Task.
      const { repository, statements } = recordingRepository([]);

      const result = await repository.start(query);

      expect(statements).toHaveLength(2);
      expect(normalise(statements[1].text)).toContain('select');
      // Owner-scoped like every other read.
      expect(statements[1].values).toEqual([query.id, query.userId, 1]);
      expect(result).toEqual({ outcome: "not_found" });
    });
  });

  describe("archive", () => {
    const query = {
      userId: "auth0|owner",
      id: "11111111-1111-4111-8111-111111111111",
    };

    it("updates under a guard on the id, the Owner and the current Status", async () => {
      const { repository, statements } = recordingRepository([aTaskRow()]);

      await repository.archive(query);

      const [updated] = statements;
      expect(normalise(updated.text)).toContain('update "tasks"');
      expect(normalise(updated.text)).toContain(
        '("tasks"."id" = $2 and "tasks"."owner_id" = $3 and "tasks"."status" = $4)',
      );
      // `statusBefore('ARCHIVED')`, not a Status written into this file.
      expect(updated.values).toEqual([
        "ARCHIVED",
        query.id,
        query.userId,
        "DONE",
      ]);
    });

    it("raises the Version so a held ETag stops matching", async () => {
      const { repository, statements } = recordingRepository([aTaskRow()]);

      await repository.archive(query);

      expect(normalise(statements[0].text)).toContain(
        '"version" = "tasks"."version" + 1',
      );
    });

    it("writes the Status and the Version and nothing else", async () => {
      const { repository, statements } = recordingRepository([aTaskRow()]);

      await repository.archive(query);

      // An update, not a delete, and `completed_at` is nowhere in what it
      // sets: an Archived Task is still a row and still says when it was
      // finished (CONTEXT.md, "Archived").
      expect(normalise(statements[0].text)).not.toContain("delete");
      expect(setClauseOf(statements[0].text)).toBe(
        '"status" = $1, "version" = "tasks"."version" + 1',
      );
    });

    it("reads nothing more when the update changed a row", async () => {
      const { repository, statements } = recordingRepository([aTaskRow()]);

      const result = await repository.archive(query);

      expect(result).toMatchObject({ outcome: "changed" });
      expect(statements).toHaveLength(1);
    });

    it("asks why when it changed none", async () => {
      const { repository, statements } = recordingRepository([]);

      const result = await repository.archive(query);

      expect(statements).toHaveLength(2);
      expect(statements[1].values).toEqual([query.id, query.userId, 1]);
      expect(result).toEqual({ outcome: "not_found" });
    });

    it("reports the Status that refused it when the Task is the Actor's", async () => {
      // The `UPDATE` matched nothing and the follow-up read found the Task, so
      // it exists and the Actor owns it — the refusal is the Status, and the
      // route turns this into `409` rather than `404`.
      //
      // `start` shares this code path: both Transitions are one call to
      // `transition()`, and a second copy of this test would only exercise the
      // same branch with a different Status.
      const { repository } = recordingRepository([], [aTaskRow()]);

      const result = await repository.archive(query);

      expect(result).toMatchObject({
        outcome: "wrong_status",
        task: { id: query.id, status: "PENDING" },
      });
    });

    it("never publishes the Owner on the Task that refused it", async () => {
      const { repository } = recordingRepository([], [aTaskRow()]);

      const result = await repository.archive(query);

      expect(result).not.toHaveProperty("task.ownerId");
    });
  });

  describe("markDone", () => {
    const query = {
      userId: "auth0|owner",
      id: "11111111-1111-4111-8111-111111111111",
    };

    it("delegates the whole decision to the Postgres function", async () => {
      const { repository, statements } = recordingRepository([
        aFunctionRow("completed"),
      ]);

      await repository.markDone(query);

      // One statement, because the conditional UPDATE and the read that
      // explains a zero-row result have to share a transaction (ADR-0002).
      expect(statements).toHaveLength(1);
      expect(normalise(statements[0].text)).toBe(
        "select * from mark_task_done($1, $2)",
      );
    });

    it("binds the Task id and the Actor rather than splicing them", async () => {
      const { repository, statements } = recordingRepository([
        aFunctionRow("completed"),
      ]);

      await repository.markDone(query);

      expect(statements[0].values).toEqual([query.id, query.userId]);
      expect(statements[0].text).not.toContain("auth0|owner");
    });

    it.each(["completed", "replayed", "wrong_status"] as const)(
      "carries the Task back with a %s outcome",
      async (outcome) => {
        const { repository } = recordingRepository([aFunctionRow(outcome)]);

        const result = await repository.markDone(query);

        expect(result).toEqual({
          outcome,
          task: {
            id: "11111111-1111-4111-8111-111111111111",
            title: "A Task",
            description: null,
            status: "DONE",
            version: 2,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-02-01T00:00:00.000Z",
            completedAt: "2026-02-01T00:00:00.000Z",
          },
        });
      },
    );

    it("never publishes the Owner the function returns", async () => {
      const { repository } = recordingRepository([aFunctionRow("completed")]);

      const result = await repository.markDone(query);

      // The function selects the whole row; the wire shape has no Owner on it.
      expect(result).not.toHaveProperty("task.ownerId");
      expect(result).not.toHaveProperty("task.owner_id");
    });

    it("reports not_found without a Task", async () => {
      // The function returns its columns as NULL when there is no row to
      // report, which is exactly the case the union has no Task for.
      const nulls = Object.fromEntries(
        Object.keys(aFunctionRow("x")).map((column) => [column, null]),
      );
      const { repository } = recordingRepository([
        { ...nulls, outcome: "not_found" },
      ]);

      await expect(repository.markDone(query)).resolves.toEqual({
        outcome: "not_found",
      });
    });

    it("refuses an outcome the function is not documented to return", async () => {
      const { repository } = recordingRepository([aFunctionRow("finished")]);

      // Parsed, not cast. Rename an outcome in the migration and every Mark
      // Done fails loudly here rather than falling through to a branch that
      // happens to be last.
      await expect(repository.markDone(query)).rejects.toThrow();
    });

    it("refuses a completed outcome that came back without a Task", async () => {
      const { repository } = recordingRepository([
        { outcome: "completed", id: null },
      ]);

      await expect(repository.markDone(query)).rejects.toThrow();
    });
  });
});
