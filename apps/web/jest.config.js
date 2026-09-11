/**
 * `next/jest` rather than a hand-rolled ts-jest config: it applies the same SWC
 * transform `next dev` does, reads `@/*` out of `tsconfig.json`, and knows how
 * to load `@insightt/shared` as the raw TypeScript it ships (PLAN.md §15).
 *
 * `jest-fixed-jsdom` rather than plain `jsdom` for the reason PLAN.md §15
 * budgets an hour for: MSW intercepts by replacing `fetch`, and jsdom ships a
 * DOM without one — along with no `TextEncoder`, no `TransformStream` and no
 * `BroadcastChannel`, all of which MSW reaches for. `jest-fixed-jsdom` is jsdom
 * with Node's own implementations put back, which is both fewer moving parts
 * than four hand-written polyfills and closer to what a browser actually has.
 */
const nextJest = require("next/jest");

/**
 * The dependencies of MSW that publish ESM and nothing else. Jest loads
 * `node_modules` as CommonJS and skips transforming it, so an `.mjs` with no
 * CJS twin arrives as a syntax error naming the *test* file rather than the
 * package, which is what makes this a landmine rather than a typo.
 *
 * `require(esm)` lands in Node 24.9 and makes the list unnecessary; the engine
 * floor is lower than that, so it stays.
 */
const ESM_ONLY = [
  "msw",
  "@mswjs",
  "@open-draft",
  "@bundled-es-modules",
  "rettime",
  "until-async",
  "outvariant",
  "strict-event-emitter",
  "is-node-process",
  "headers-polyfill",
];

/**
 * One `transformIgnorePatterns` entry, with `ESM_ONLY` added to the packages it
 * already excepts.
 *
 * Injected rather than written from scratch, because the patterns `next/jest`
 * builds are how `transpilePackages` from `next.config.ts` reaches Jest —
 * `@insightt/shared` is in there. Replacing them wholesale drops it, and the
 * suite goes on passing only because a workspace symlink resolves the package
 * to a path outside `node_modules`, where the pattern never applies.
 */
function alsoTransform(pattern) {
  return pattern.includes("node_modules")
    ? pattern.replace("(?!(", `(?!(${ESM_ONLY.join("|")}|`)
    : pattern;
}

const createConfig = nextJest({ dir: "./" })({
  testEnvironment: "jest-fixed-jsdom",
  roots: ["<rootDir>/src"],
  // `setupFiles`, not `setupFilesAfterEnv`: `config.ts` reads its environment
  // at import time, and the later hook runs after the test framework has
  // already pulled the module graph in.
  setupFiles: ["<rootDir>/jest.setup.ts"],
  // This one has to be after, because it extends an `expect` that does not
  // exist yet in `setupFiles`.
  setupFilesAfterEnv: ["<rootDir>/jest.setup.dom.ts"],
});

// `next/jest` documents `transformIgnorePatterns` as append-only and resolves
// its config asynchronously, so the exception above cannot be passed in: a
// pattern appended to the list only ignores *more*, and one passed in is
// overwritten. It has to be edited into the resolved patterns afterwards.
module.exports = async () => {
  const resolved = await createConfig();

  return {
    ...resolved,
    transformIgnorePatterns: resolved.transformIgnorePatterns.map(alsoTransform),
  };
};
