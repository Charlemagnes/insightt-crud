import { SHARED_PACKAGE_NAME } from "@insightt/shared";

/**
 * Entry point placeholder. Express, its middleware stack and the app factory
 * arrive in the tickets that follow (PLAN.md §18 steps 5-6); what this file
 * proves today is that the CommonJS API workspace resolves `@insightt/shared`
 * straight from source under `tsx`.
 */
console.log(`@insightt/api scaffold — linked against ${SHARED_PACKAGE_NAME}`);
