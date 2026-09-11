import { TaskStatus } from "@insightt/shared";

import { taskStatus } from "@/db/schema";

/**
 * The lifecycle is spelled out twice on purpose — once as a Zod enum for the
 * wire, once as a Postgres type for the database — because neither can be
 * derived from the other without dragging the data layer into the frontend's
 * import graph (PLAN.md §11).
 *
 * Written twice, they can drift. This is what holds them together: add a Status
 * to one spelling and this fails until the other agrees.
 */
describe("task_status", () => {
  it("carries exactly the values the wire contract does", () => {
    expect([...taskStatus.enumValues]).toEqual([...TaskStatus.options]);
  });

  it("lists them in lifecycle order", () => {
    expect([...taskStatus.enumValues]).toEqual([
      "PENDING",
      "IN_PROGRESS",
      "DONE",
      "ARCHIVED",
    ]);
  });
});
