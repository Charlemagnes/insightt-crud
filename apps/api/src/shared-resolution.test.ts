import { TaskStatus } from "@insightt/shared";

/**
 * Guards the Jest `moduleNameMapper` in `jest.config.js` and its twin, the
 * `paths` entry in `tsconfig.json`. `@insightt/shared` has no build step, so a
 * stale mapping would surface as a real test failing for a reason that looked
 * unrelated.
 *
 * It has to touch a *runtime* export: type-only imports are erased, so they
 * would keep compiling long after the mapping broke.
 */
describe("@insightt/shared resolution", () => {
  it("resolves from the CommonJS API workspace under Jest", () => {
    expect(TaskStatus.options).toEqual([
      "PENDING",
      "IN_PROGRESS",
      "DONE",
      "ARCHIVED",
    ]);
  });
});
