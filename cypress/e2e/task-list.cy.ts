import type { TaskPage } from "@insightt/shared";

/**
 * The third of the three tests the brief asks for (PLAN.md §15): a real sign-in
 * against the real Auth0 tenant, in a real browser, against the real API and
 * the real database. Nothing is mocked here — that is the entire point of it,
 * and what makes it worth the tenant credentials it costs.
 *
 * It is **read-only**. It creates nothing, changes nothing and needs no
 * teardown, which means it cannot arrange the Tasks it then asserts on. So it
 * asserts the stronger thing available to it instead: that what the table shows
 * is what the API just said. That holds on a seeded account and an empty one,
 * and neither can pass it by accident.
 */
describe("Signing in and seeing the task list", () => {
  it("boots signed in and renders the page of Tasks the API returned", () => {
    // Registered before the visit: the app asks for the first page while it is
    // still painting, and an intercept added afterwards would miss it.
    cy.intercept("GET", "**/api/tasks*").as("listTasks");

    cy.signInAndVisit("/").then((profile) => {
      // The header names whoever is signed in, and the value comes off the ID
      // token Auth0 just issued rather than out of `cypress.env.json` — so this
      // asserts the app is showing *this* person, not that two files agree.
      cy.contains(String(profile.name ?? profile.email)).should("be.visible");
    });

    // Past the gate, not on the landing panel.
    cy.contains("button", "Log out").should("be.visible");
    cy.contains("button", "New task").should("be.visible");

    cy.wait("@listTasks").then(({ response }) => {
      // The token was minted by one Auth0 client and stored under another's
      // cache key (see `support/auth0.ts`). A `200` is the proof that survived
      // the round trip: Express validated the signature, the issuer and the
      // audience, and answered with this person's own Tasks.
      expect(response?.statusCode, "the API accepted the seeded token").to.equal(
        200,
      );

      const page = response?.body as TaskPage;

      // `data-row-key` is the Task's own id — `TaskTable` passes `rowKey="id"`
      // — so this is row-for-row identity with the response, not a count that
      // happens to match.
      cy.get("[data-row-key]").should("have.length", page.items.length);
      for (const task of page.items) {
        cy.get(`[data-row-key="${task.id}"]`).should("contain", task.title);
      }

      // And the pager prints the whole result set, which is the one number the
      // rows on screen cannot show. An account with no Tasks says so instead —
      // the empty wording is the list having rendered an answer too.
      cy.contains(
        page.total === 0 ? "No tasks yet." : `of ${page.total} tasks`,
      ).should("be.visible");
    });
  });
});
