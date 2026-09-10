/**
 * `@insightt/shared` — the type authority for everything that crosses the wire
 * between `apps/web` and `apps/api` (PLAN.md §11).
 *
 * The package ships raw TypeScript: there is no build step between workspaces.
 * `apps/web` transpiles it through `transpilePackages`, `apps/api` resolves it
 * through `tsx` in development and a Jest `moduleNameMapper` under test.
 *
 * The Zod schemas and the Status transition rules land in later tickets. Until
 * then the marker below is the package's only export — it is what the
 * resolution tests in both apps assert against, and it goes away once
 * `schemas/task.ts` gives them something real to import.
 */
export const SHARED_PACKAGE_NAME = "@insightt/shared";
