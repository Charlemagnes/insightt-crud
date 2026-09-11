/**
 * `@insightt/shared` — the type authority for everything that crosses the wire
 * between `apps/web` and `apps/api` (PLAN.md §11).
 *
 * The package ships raw TypeScript: there is no build step between workspaces.
 * `apps/web` transpiles it through `transpilePackages`, `apps/api` resolves it
 * through `tsx` in development and a Jest `moduleNameMapper` under test.
 *
 * Nothing that does not cross the wire belongs here. The signed-in person, in
 * particular, does not: `AuthUser` lives in `apps/web` and `Actor` in
 * `apps/api`, because the API never returns a user — it only reads the token.
 */
export * from "./rules/transitions";
export * from "./schemas/errors";
export * from "./schemas/task";
