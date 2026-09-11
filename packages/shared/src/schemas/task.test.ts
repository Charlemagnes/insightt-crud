import {
  CreateTaskInput,
  SortDirection,
  TASK_LIMITS,
  TASK_PAGE,
  TaskListQuery,
  TaskPageSchema,
  TaskSchema,
  TaskSortField,
  UpdateTaskInput,
} from "./task";

const valid = { title: "Write the plan" };

describe("CreateTaskInput", () => {
  describe("title", () => {
    it("accepts a title and trims it", () => {
      const parsed = CreateTaskInput.parse({ title: "  Write the plan  " });

      expect(parsed.title).toBe("Write the plan");
    });

    it("rejects a missing title", () => {
      expect(CreateTaskInput.safeParse({}).success).toBe(false);
    });

    it("rejects a title that is only whitespace", () => {
      // Trimmed before it is measured, so this is the empty title in disguise
      // — the case a `min(1)` on the raw string would wave through.
      expect(CreateTaskInput.safeParse({ title: "   " }).success).toBe(false);
    });

    it("names the field it rejected", () => {
      const result = CreateTaskInput.safeParse({ title: "" });

      // The form helper reads `issue.path` to decide which input to mark, so a
      // path-less issue would fail the form silently.
      expect(result.error?.issues[0]?.path).toEqual(["title"]);
    });

    it("bounds the title's length", () => {
      expect(
        CreateTaskInput.safeParse({ title: "a".repeat(200) }).success,
      ).toBe(true);
      expect(
        CreateTaskInput.safeParse({ title: "a".repeat(201) }).success,
      ).toBe(false);
    });
  });

  describe("description", () => {
    it("is optional", () => {
      expect(CreateTaskInput.parse(valid).description).toBeUndefined();
    });

    it("trims it", () => {
      const parsed = CreateTaskInput.parse({
        ...valid,
        description: "  the details  ",
      });

      expect(parsed.description).toBe("the details");
    });

    it("reads a blank description as no description", () => {
      // An empty text area is someone leaving the field alone, not someone
      // asking for a description that is the empty string.
      expect(
        CreateTaskInput.parse({ ...valid, description: "   " }).description,
      ).toBeNull();
    });

    it("accepts an explicit null", () => {
      expect(
        CreateTaskInput.parse({ ...valid, description: null }).description,
      ).toBeNull();
    });

    it("bounds the description's length", () => {
      expect(
        CreateTaskInput.safeParse({ ...valid, description: "a".repeat(2000) })
          .success,
      ).toBe(true);
      expect(
        CreateTaskInput.safeParse({ ...valid, description: "a".repeat(2001) })
          .success,
      ).toBe(false);
    });
  });

  describe("TASK_LIMITS", () => {
    // The create form counts characters against these as the person types, and
    // shows the limit beside the field. They are the published spelling of a
    // rule only the schema enforces, so a limit that said one number while the
    // schema rejected at another would count someone down to a cap that was
    // not there. The literals below are deliberate: reusing TASK_LIMITS to
    // build the input would make the test agree with itself.
    it("says where the title rule actually rejects", () => {
      expect(TASK_LIMITS.title).toBe(200);
      expect(
        CreateTaskInput.safeParse({ title: "a".repeat(200) }).success,
      ).toBe(true);
      expect(
        CreateTaskInput.safeParse({ title: "a".repeat(201) }).success,
      ).toBe(false);
    });

    it("says where the description rule actually rejects", () => {
      expect(TASK_LIMITS.description).toBe(2000);
      expect(
        CreateTaskInput.safeParse({ ...valid, description: "a".repeat(2000) })
          .success,
      ).toBe(true);
      expect(
        CreateTaskInput.safeParse({ ...valid, description: "a".repeat(2001) })
          .success,
      ).toBe(false);
    });

    it("names the limit in the message the field shows", () => {
      const result = CreateTaskInput.safeParse({ title: "a".repeat(201) });

      // The person reads this under the input, beside a counter reading
      // 201 / 200. The two have to be talking about the same number.
      expect(result.error?.issues[0]?.message).toContain(
        String(TASK_LIMITS.title),
      );
    });
  });

  describe("strictness", () => {
    it("rejects a Status rather than silently dropping it", () => {
      // The whole idempotency guarantee rests on `mark_task_done()` being the
      // only entrance to DONE (PLAN.md §8). A create that quietly ignored a
      // Status would read as though it had honoured it.
      const result = CreateTaskInput.safeParse({ ...valid, status: "DONE" });

      expect(result.success).toBe(false);
    });

    it("rejects a mistyped field name", () => {
      const result = CreateTaskInput.safeParse({ ...valid, titel: "oops" });

      expect(result.success).toBe(false);
    });

    it("carries no Status of its own", () => {
      expect(CreateTaskInput.parse(valid)).not.toHaveProperty("status");
    });
  });
});

describe("UpdateTaskInput", () => {
  it("accepts an edit that names only the title", () => {
    expect(UpdateTaskInput.parse({ title: "Renamed" })).toEqual({
      title: "Renamed",
    });
  });

  it("accepts an edit that names only the description", () => {
    expect(UpdateTaskInput.parse({ description: "More detail" })).toEqual({
      description: "More detail",
    });
  });

  it("leaves an unnamed field out rather than nulling it", () => {
    // Omitted means "leave it alone". If the absent key arrived as `null` the
    // repository would clear a description nobody asked it to clear.
    expect(UpdateTaskInput.parse({ title: "Renamed" })).not.toHaveProperty(
      "description",
    );
  });

  it("applies the same rules to the title that a create does", () => {
    expect(UpdateTaskInput.parse({ title: "  Renamed  " }).title).toBe(
      "Renamed",
    );
    expect(UpdateTaskInput.safeParse({ title: "   " }).success).toBe(false);
    expect(
      UpdateTaskInput.safeParse({ title: "a".repeat(TASK_LIMITS.title + 1) })
        .success,
    ).toBe(false);
  });

  describe("clearing the description", () => {
    it("accepts an explicit null", () => {
      // The one thing omitting the key cannot say.
      expect(UpdateTaskInput.parse({ description: null })).toEqual({
        description: null,
      });
    });

    it("reads an emptied text area as a cleared description", () => {
      expect(UpdateTaskInput.parse({ description: "   " })).toEqual({
        description: null,
      });
    });
  });

  describe("an edit that names nothing", () => {
    it("rejects an empty object", () => {
      expect(UpdateTaskInput.safeParse({}).success).toBe(false);
    });

    it("rejects fields explicitly set to undefined", () => {
      const result = UpdateTaskInput.safeParse({
        title: undefined,
        description: undefined,
      });

      expect(result.success).toBe(false);
    });

    it("blames the edit rather than a field", () => {
      const result = UpdateTaskInput.safeParse({});

      // Path-less on purpose: no single input is at fault, so the form reports
      // it as a message instead of marking a field that is fine.
      expect(result.error?.issues[0]?.path).toEqual([]);
    });
  });

  describe("strictness", () => {
    it("rejects a Status rather than silently dropping it", () => {
      // Status moves through the Transition endpoints only. A PATCH that
      // quietly ignored one would look, from outside, like a PATCH that
      // honoured it.
      const result = UpdateTaskInput.safeParse({
        title: "Renamed",
        status: "DONE",
      });

      expect(result.success).toBe(false);
    });

    it("rejects a mistyped field name", () => {
      expect(UpdateTaskInput.safeParse({ titel: "oops" }).success).toBe(false);
    });

    it("rejects the Version, which travels as a header and not a field", () => {
      expect(
        UpdateTaskInput.safeParse({ title: "Renamed", version: 2 }).success,
      ).toBe(false);
    });
  });
});

describe("TaskSchema", () => {
  it("still describes what the API returns for a created Task", () => {
    const created = {
      id: "00000000-0000-4000-8000-000000000001",
      title: "Write the plan",
      description: null,
      status: "PENDING",
      version: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      completedAt: null,
    };

    expect(() => TaskSchema.parse(created)).not.toThrow();
  });
});

describe("TaskListQuery", () => {
  describe("defaults", () => {
    it("reads an absent query string as the first page", () => {
      expect(TaskListQuery.parse({})).toEqual({
        page: TASK_PAGE.first,
        pageSize: TASK_PAGE.defaultSize,
      });
    });

    // Like `status`, and for the same reason: a default here would be an order
    // the client never asked for, shown under a column claiming it did.
    it("has no sort default, so an unasked-for list is unsorted", () => {
      const parsed = TaskListQuery.parse({});

      expect(parsed).not.toHaveProperty("sort");
      expect(parsed).not.toHaveProperty("direction");
    });

    it("leaves the Status unset, so the list shows every Status", () => {
      expect(TaskListQuery.parse({}).status).toBeUndefined();
    });

    it("has no Status default to accidentally hide Archived Tasks", () => {
      expect(TaskListQuery.parse({})).not.toHaveProperty("status");
    });
  });

  describe("coercion", () => {
    it("reads the numbers a query string spells as text", () => {
      expect(TaskListQuery.parse({ page: "3", pageSize: "25" })).toMatchObject({
        page: 3,
        pageSize: 25,
      });
    });

    it("rejects a page that is not a number at all", () => {
      expect(TaskListQuery.safeParse({ page: "later" }).success).toBe(false);
    });

    it("rejects a fractional page", () => {
      expect(TaskListQuery.safeParse({ page: "1.5" }).success).toBe(false);
    });
  });

  describe("sorting", () => {
    it("takes a sort field the contract names", () => {
      expect(TaskListQuery.parse({ sort: "title" }).sort).toBe("title");
    });

    it("takes a direction alongside it", () => {
      const parsed = TaskListQuery.parse({ sort: "title", direction: "desc" });

      expect(parsed).toMatchObject({ sort: "title", direction: "desc" });
      expect(SortDirection.options).toContain(parsed.direction);
      expect(TaskSortField.options).toContain(parsed.sort);
    });

    // The value reaches an `ORDER BY`. A field the whitelist does not name is a
    // `422` rather than a column the query string got to choose.
    it("refuses a field that is not one of them", () => {
      expect(TaskListQuery.safeParse({ sort: "ownerId" }).success).toBe(false);
    });

    it("refuses a direction that is not one of the two", () => {
      expect(TaskListQuery.safeParse({ direction: "up" }).success).toBe(false);
    });
  });

  describe("bounds", () => {
    it("rejects a page before the first", () => {
      expect(
        TaskListQuery.safeParse({ page: TASK_PAGE.first - 1 }).success,
      ).toBe(false);
    });

    it("accepts a page size at the cap", () => {
      expect(
        TaskListQuery.parse({ pageSize: TASK_PAGE.maxSize }).pageSize,
      ).toBe(TASK_PAGE.maxSize);
    });

    it("rejects a page size beyond the cap rather than clamping it", () => {
      expect(
        TaskListQuery.safeParse({ pageSize: TASK_PAGE.maxSize + 1 }).success,
      ).toBe(false);
    });

    it("rejects a page size of nothing", () => {
      expect(TaskListQuery.safeParse({ pageSize: 0 }).success).toBe(false);
    });
  });

  describe("the Status filter", () => {
    it("accepts a Status in the lifecycle", () => {
      expect(TaskListQuery.parse({ status: "DONE" }).status).toBe("DONE");
    });

    it("accepts ARCHIVED, which is a Status and not a soft delete", () => {
      expect(TaskListQuery.parse({ status: "ARCHIVED" }).status).toBe(
        "ARCHIVED",
      );
    });

    it("rejects a Status outside the lifecycle", () => {
      expect(TaskListQuery.safeParse({ status: "BLOCKED" }).success).toBe(
        false,
      );
    });

    it("rejects a Status in the wrong case, rather than guessing", () => {
      expect(TaskListQuery.safeParse({ status: "done" }).success).toBe(false);
    });
  });

  describe("TASK_PAGE", () => {
    // The paginator offers these sizes; the schema is what rejects one the API
    // will not serve. These hold the two together.
    it("says where the page-size rule actually rejects", () => {
      expect(
        TaskListQuery.safeParse({ pageSize: TASK_PAGE.maxSize }).success,
      ).toBe(true);
      expect(
        TaskListQuery.safeParse({ pageSize: TASK_PAGE.maxSize + 1 }).success,
      ).toBe(false);
    });

    it("names a default the schema would accept if it were sent explicitly", () => {
      expect(
        TaskListQuery.safeParse({ pageSize: TASK_PAGE.defaultSize }).success,
      ).toBe(true);
    });
  });
});

describe("TaskPageSchema", () => {
  const page = {
    items: [],
    page: TASK_PAGE.first,
    pageSize: TASK_PAGE.defaultSize,
    total: 0,
  };

  it("describes an empty page, which still carries the total", () => {
    expect(TaskPageSchema.parse(page)).toEqual(page);
  });

  it("requires the total, which is what the pager sizes itself from", () => {
    const { total: _total, ...withoutTotal } = page;

    expect(TaskPageSchema.safeParse(withoutTotal).success).toBe(false);
  });

  it("rejects a negative total", () => {
    expect(TaskPageSchema.safeParse({ ...page, total: -1 }).success).toBe(
      false,
    );
  });
});
