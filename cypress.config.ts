import { defineConfig } from "cypress";

/**
 * The E2E suite (PLAN.md §15, test 3). It lives at the repo root rather than
 * inside `apps/web` because it is the only thing here that exercises both
 * workspaces at once — the browser app on :3000 and the Express API on :4000 —
 * and `cypress.env.json`, which carries the tenant credentials, is a root file.
 */
export default defineConfig({
  e2e: {
    baseUrl: "http://localhost:3000",
    specPattern: "cypress/e2e/**/*.cy.ts",
    supportFile: "cypress/support/e2e.ts",
    fixturesFolder: false,
    // One spec that either passes or names the assertion it failed on. A
    // recording of it would be a minute of a table not changing; the failure
    // screenshot Cypress takes by default is left on, because that one is
    // worth having.
    video: false,
  },
});
