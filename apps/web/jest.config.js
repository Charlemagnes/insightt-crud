/**
 * `next/jest` rather than a hand-rolled ts-jest config: it applies the same SWC
 * transform `next dev` does, reads `@/*` out of `tsconfig.json`, and knows how
 * to load `@insightt/shared` as the raw TypeScript it ships (PLAN.md §15).
 *
 * `jsdom` because the tests that matter here render components. A store test
 * would run in `node`, but splitting the project in two to save a DOM nobody
 * notices would cost more than it saves.
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
