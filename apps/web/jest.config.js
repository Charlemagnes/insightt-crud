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
 * Node's own `require(esm)` does not retire this list. It is unflagged from
 * Node 22.12, well under what this repo runs, but Jest resolves `node_modules`
 * through its own module registry rather than Node's `require`, so the
 * interoperability Node gained never reaches the code under test.
 *
 * Scopes as well as packages, because several of these publish under one:
 * matching the scope covers every package MSW pulls from it.
 */
const ESM_ONLY = [
  "msw",
  "@mswjs",
  "@open-draft",
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
 *
 * The exception list is what `(?!(` opens, so a pattern without one has
 * nowhere to put it. `next/jest` emits exactly that — a bare `/node_modules/`
 * — when `transpilePackages` is empty, which is why the caller below counts
 * the injections instead of trusting them: a silent no-op here comes back as a
 * syntax error naming a test file, the landmine `ESM_ONLY` exists to defuse.
 */
function alsoTransform(pattern) {
  if (!pattern.includes("node_modules") || !pattern.includes("(?!(")) {
    return pattern;
  }

  return pattern.replace("(?!(", `(?!(${ESM_ONLY.join("|")}|`);
}

const createConfig = nextJest({ dir: "./" })({
  testEnvironment: "jest-fixed-jsdom",
  roots: ["<rootDir>/src"],
  // Jest's five-second default is a unit test's budget, and these are
  // integration tests: a single one renders the whole screen, waits on MSW and
  // drives antd's Table and Modal through jsdom, which has no layout engine and
  // no compositor to make animation cheap. Several seconds is normal here, and
  // they are slower again when the suites run in parallel — so the default
  // fails on a busy machine rather than on a broken change, which is the one
  // thing a timeout must not do.
  testTimeout: 20_000,
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
  const patterns = resolved.transformIgnorePatterns.map(alsoTransform);

  if (
    patterns.every(
      (pattern, i) => pattern === resolved.transformIgnorePatterns[i],
    )
  ) {
    throw new Error(
      "jest.config.js: transformIgnorePatterns took none of the ESM_ONLY " +
        "exceptions. `transpilePackages` in next.config.ts is the usual cause — " +
        "without it `next/jest` emits no exception list to inject into. See the " +
        "comment on `alsoTransform`.",
    );
  }

  return { ...resolved, transformIgnorePatterns: patterns };
};
