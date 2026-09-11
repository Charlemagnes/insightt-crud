/**
 * The schemas in this package are the contract both apps are held to, so they
 * are unit tested here rather than only through whichever app happens to parse
 * them (PLAN.md §15).
 *
 * `tsconfig.json` targets the bundlers that consume this package, which means
 * ESM. Jest here is CommonJS, for the same reason `apps/api` is: ts-jest on ESM
 * is a config tarpit. The override below is the whole of the difference, and it
 * applies to the test run only — nothing about how `apps/web` or `apps/api`
 * consume the source changes.
 */
/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      { tsconfig: { module: "commonjs", moduleResolution: "node10" } },
    ],
  },
};
