import type { TaskPage } from "@insightt/shared";

/**
 * Test 3 of the three the brief asks for (PLAN.md §15): real tenant, real
 * browser, real API, real database, nothing mocked.
 *
 * Read-only, so it cannot arrange the Tasks it asserts on — it asserts the
 * table against the response instead, which holds on a seeded account and an
 * empty one alike.
 */
describe("Signing in and seeing the task list", () => {
  it("boots signed in and renders the page of Tasks the API returned", () => {
    // Registered before the visit: the app asks for the first page while it is
    // still painting, and an intercept added afterwards would miss it.
    cy.intercept("GET", "**/api/tasks*").as("listTasks");

    cy.signInAndVisit("/").then((profile) => {
      // Off the ID token Auth0 just issued, not `cypress.env.json`: this
      // asserts the app is showing *this* person, not that two files agree.
      cy.contains(String(profile.name ?? profile.email)).should("be.visible");
    });

    // Past the gate, not on the landing panel.
    cy.contains("button", "Log out").should("be.visible");
    cy.contains("button", "New task").should("be.visible");

    cy.wait("@listTasks").then(({ response }) => {
      // Minted by one Auth0 client, stored under another's cache key (see
      // `support/auth0.ts`): a `200` is Express having accepted it anyway.
      expect(response?.statusCode, "the API accepted the seeded token").to.equal(
        200,
      );

      const page = response?.body as TaskPage;

      // `data-row-key` is the Task's own id (`TaskTable` passes `rowKey="id"`),
      // so this is identity with the response, not a count that happens to match.
      cy.get("[data-row-key]").should("have.length", page.items.length);
      for (const task of page.items) {
        cy.get(`[data-row-key="${task.id}"]`).should("contain", task.title);
      }

      // The total is the one number the rows on screen cannot show. An account
      // with no Tasks says so instead, which is an answer rendered too.
      cy.contains(
        page.total === 0 ? "No tasks yet." : `of ${page.total} tasks`,
      ).should("be.visible");
    });
  });
});
