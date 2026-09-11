import { TaskStatus, type Task } from "../schemas/task";
import {
  canEdit,
  canEditAnything,
  canTransition,
  changedFields,
  EDITABLE_FIELDS,
  LIFECYCLE,
  nextStatus,
  statusBefore,
} from "./transitions";

/** Every ordered pair of Statuses, which is what "no other move" has to mean. */
const everyPair = TaskStatus.options.flatMap((from) =>
  TaskStatus.options.map((to) => [from, to] as const),
);

describe("the Status machine", () => {
  it("runs PENDING to ARCHIVED in order", () => {
    expect([...LIFECYCLE]).toEqual([
      "PENDING",
      "IN_PROGRESS",
      "DONE",
      "ARCHIVED",
    ]);
  });

  describe("nextStatus", () => {
    it("advances one step", () => {
      expect(nextStatus("PENDING")).toBe("IN_PROGRESS");
      expect(nextStatus("IN_PROGRESS")).toBe("DONE");
      expect(nextStatus("DONE")).toBe("ARCHIVED");
    });

    it("has nowhere to go from ARCHIVED", () => {
      expect(nextStatus("ARCHIVED")).toBeNull();
    });
  });

  describe("statusBefore", () => {
    it("names the one Status a Transition may come from", () => {
      expect(statusBefore("IN_PROGRESS")).toBe("PENDING");
      expect(statusBefore("DONE")).toBe("IN_PROGRESS");
      expect(statusBefore("ARCHIVED")).toBe("DONE");
    });

    it("has nothing before PENDING, where every Task starts", () => {
      expect(statusBefore("PENDING")).toBeNull();
    });

    it("is the inverse of nextStatus wherever both are defined", () => {
      // The guarded `UPDATE` in the API reads its `WHERE` Status off
      // `statusBefore`, and the UI enables its controls off `nextStatus`. If
      // the two disagreed, a button the UI offered would be refused by the SQL.
      for (const status of TaskStatus.options) {
        const next = nextStatus(status);
        if (next) expect(statusBefore(next)).toBe(status);
      }
    });
  });

  describe("canTransition", () => {
    it("permits exactly the three forward steps", () => {
      const permitted = everyPair.filter(([from, to]) =>
        canTransition(from, to),
      );

      expect(permitted).toEqual([
        ["PENDING", "IN_PROGRESS"],
        ["IN_PROGRESS", "DONE"],
        ["DONE", "ARCHIVED"],
      ]);
    });

    it("refuses every move backwards", () => {
      expect(canTransition("IN_PROGRESS", "PENDING")).toBe(false);
      expect(canTransition("DONE", "IN_PROGRESS")).toBe(false);
      expect(canTransition("ARCHIVED", "DONE")).toBe(false);
    });

    it("refuses skipping a step", () => {
      expect(canTransition("PENDING", "DONE")).toBe(false);
      expect(canTransition("IN_PROGRESS", "ARCHIVED")).toBe(false);
    });

    it("refuses staying put", () => {
      for (const status of TaskStatus.options) {
        expect(canTransition(status, status)).toBe(false);
      }
    });

    it("lets nothing out of ARCHIVED", () => {
      for (const to of TaskStatus.options) {
        expect(canTransition("ARCHIVED", to)).toBe(false);
      }
    });

    it("names exactly one Status that may be marked DONE", () => {
      // The same claim `mark_task_done()` hardcodes in its `WHERE` clause. The
      // drift test in `apps/api` holds this answer and that SQL together.
      const intoDone = TaskStatus.options.filter((from) =>
        canTransition(from, "DONE"),
      );

      expect(intoDone).toEqual(["IN_PROGRESS"]);
    });
  });
});

describe("field editability", () => {
  it("leaves a Task open while the work is ahead of it", () => {
    for (const status of ["PENDING", "IN_PROGRESS"] as const) {
      for (const field of EDITABLE_FIELDS) {
        expect(canEdit(status, field)).toBe(true);
      }
    }
  });

  it("keeps a DONE title fixable and its description frozen", () => {
    // A typo outlives the work; the plan does not (PLAN.md §7).
    expect(canEdit("DONE", "title")).toBe(true);
    expect(canEdit("DONE", "description")).toBe(false);
  });

  it("closes an ARCHIVED Task to everything", () => {
    for (const field of EDITABLE_FIELDS) {
      expect(canEdit("ARCHIVED", field)).toBe(false);
    }
    expect(canEditAnything("ARCHIVED")).toBe(false);
  });

  it("reports which Statuses can be edited at all", () => {
    expect(canEditAnything("PENDING")).toBe(true);
    expect(canEditAnything("IN_PROGRESS")).toBe(true);
    // Still editable, just not in every field — an Edit control stays enabled.
    expect(canEditAnything("DONE")).toBe(true);
  });
});

describe("changedFields", () => {
  const task: Task = {
    id: "00000000-0000-4000-8000-000000000001",
    title: "Before",
    description: "Also before",
    status: "PENDING",
    version: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    completedAt: null,
  };

  it("keeps a field whose value differs", () => {
    expect(changedFields(task, { title: "After" })).toEqual({ title: "After" });
  });

  it("drops a field that already holds the value it asks for", () => {
    expect(changedFields(task, { title: "Before" })).toEqual({});
  });

  it("drops only the unchanged half of an edit", () => {
    expect(
      changedFields(task, { title: "Before", description: "After" }),
    ).toEqual({ description: "After" });
  });

  it("treats a field the edit did not name as no change", () => {
    // Omitting a key means "leave it alone", which is what leaving it out of
    // the answer means too.
    expect(changedFields(task, { title: "After" })).not.toHaveProperty(
      "description",
    );
  });

  it("keeps a cleared description, which is a change", () => {
    expect(changedFields(task, { description: null })).toEqual({
      description: null,
    });
  });

  it("drops a cleared description on a Task that has none", () => {
    const blank = { ...task, description: null };

    // Clearing what is already clear raises the Version for nothing.
    expect(changedFields(blank, { description: null })).toEqual({});
  });
});
