/**
 * CommonJS Jest config — see CLAUDE.md: `apps/api` stays CJS because ts-jest on
 * ESM is a config tarpit. `@insightt/shared` ships raw TypeScript with no build
 * step, so Jest is pointed at its source rather than a `dist` that never exists.
 */
/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  moduleNameMapper: {
    "^@insightt/shared$": "<rootDir>/../../packages/shared/src/index.ts",
    "^@/(.*)$": "<rootDir>/src/$1",
  },
};
