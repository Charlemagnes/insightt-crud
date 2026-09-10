/**
 * `@insightt/shared` — the type authority for everything that crosses the wire
 * between `apps/web` and `apps/api` (PLAN.md §11).
 *
 * The package ships raw TypeScript: there is no build step between workspaces.
 * `apps/web` transpiles it through `transpilePackages`, `apps/api` resolves it
 * through `tsx` in development and a Jest `moduleNameMapper` under test.
 *
 * The Zod schemas and the Status transition rules land in later tickets. Until
 * then the marker below is the package's only export, and it is what proves
 * both resolution paths: `apps/api/src/shared-resolution.test.ts` asserts on it
 * under Jest, and `apps/web` importing it is what makes `next build` fail if
 * `transpilePackages` is ever dropped. It goes away once `schemas/task.ts`
 * gives both apps something real to import.
 */
export const SHARED_PACKAGE_NAME = "@insightt/shared";
