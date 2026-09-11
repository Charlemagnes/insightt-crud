import { CreateTaskInput, TASK_LIMITS, TaskSchema } from "./task";

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
