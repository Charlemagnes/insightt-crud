/**
 * `next/jest` rather than a hand-rolled ts-jest config: it applies the same SWC
 * transform `next dev` does, reads `@/*` out of `tsconfig.json`, and knows how
 * to load `@insightt/shared` as the raw TypeScript it ships (PLAN.md §15).
 *
 * `jsdom` because §15's integration test renders the list through React
 * Testing Library. The view-state tests here would run under `node`, but
 * splitting the workspace into two Jest projects to spare them a DOM they never
 * touch would cost more than the DOM does.
 */
const nextJest = require("next/jest");

/** @type {import('jest').Config} */
module.exports = nextJest({ dir: "./" })({
  testEnvironment: "jsdom",
  roots: ["<rootDir>/src"],
  // `setupFiles`, not `setupFilesAfterEnv`: `config.ts` reads its environment
  // at import time, and the later hook runs after the test framework has
  // already pulled the module graph in.
  setupFiles: ["<rootDir>/jest.setup.ts"],
});
