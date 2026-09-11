import { TaskSchema } from "@insightt/shared";

import type { TaskRow } from "@/db/schema";
import { toTask } from "@/tasks/mappers";

function aRow(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    ownerId: "auth0|owner",
    title: "Write the mapper test",
    description: "The seam between the row and the wire.",
    status: "IN_PROGRESS",
    version: 2,
    createdAt: new Date("2026-01-01T10:00:00.000Z"),
    updatedAt: new Date("2026-01-02T11:30:00.000Z"),
    completedAt: null,
    ...overrides,
  };
}

describe("toTask", () => {
  it("produces a Task the shared schema accepts", () => {
    expect(() => TaskSchema.parse(toTask(aRow()))).not.toThrow();
  });

  it("renders timestamps as ISO strings, not Dates", () => {
    const task = toTask(
      aRow({ completedAt: new Date("2026-01-03T12:00:00.000Z") }),
    );

    expect(task.createdAt).toBe("2026-01-01T10:00:00.000Z");
    expect(task.updatedAt).toBe("2026-01-02T11:30:00.000Z");
    expect(task.completedAt).toBe("2026-01-03T12:00:00.000Z");
  });

  it("keeps a Task that was never completed null rather than undefined", () => {
    // `undefined` disappears through `JSON.stringify`, and the field would
    // simply be missing from the response — which the contract does not allow.
    expect(toTask(aRow({ completedAt: null })).completedAt).toBeNull();
  });

  it("drops the Owner", () => {
    expect(toTask(aRow())).not.toHaveProperty("ownerId");
  });
});
