import { SHARED_PACKAGE_NAME } from "@insightt/shared";

/**
 * Guards the Jest `moduleNameMapper` in `jest.config.js`. `@insightt/shared`
 * has no build step, so nothing else would catch the mapping going stale until
 * a real test failed for a reason that looked unrelated.
 */
describe("@insightt/shared resolution", () => {
  it("resolves from the CommonJS API workspace under Jest", () => {
    expect(SHARED_PACKAGE_NAME).toBe("@insightt/shared");
  });
});
