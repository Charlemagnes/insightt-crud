/**
 * The third of the three tests the brief asks for (PLAN.md §15): a real sign-in
 * against the real Auth0 tenant, in a real browser, against the real API and
 * the real database. Nothing is mocked here — that is the entire point of it,
 * and what makes it worth the tenant credentials it costs.
 *
 * It is **read-only**. Every assertion below holds whether the test user has a
 * hundred Tasks or none, so the spec creates nothing, changes nothing, and
 * needs no teardown — which is also what lets it run against whatever the
 * seeded account happens to hold.
 */
describe("Signing in and seeing the task list", () => {
  it("boots signed in and renders the list the API returned", () => {
    // Registered before the visit: the app asks for the first page while it is
    // still painting, and an intercept added afterwards would miss it.
    cy.intercept("GET", "**/api/tasks*").as("listTasks");

    cy.signInAndVisit("/").then((user) => {
      // The header names whoever is signed in, and the value comes off the ID
      // token Auth0 just issued rather than out of `cypress.env.json` — so this
      // asserts the app is showing *this* person, not that two files agree.
      cy.contains(String(user.name ?? user.email)).should("be.visible");
    });

    // The token was minted by one Auth0 client and stored under another's cache
    // key (see `support/auth0.ts`). A `200` here is the proof that survived the
    // round trip: Express validated the signature, the audience and the issuer,
    // and answered with this person's own Tasks.
    cy.wait("@listTasks").its("response.statusCode").should("eq", 200);

    // Past the gate, not on the landing panel.
    cy.contains("button", "Log out").should("be.visible");
    cy.contains("button", "New task").should("be.visible");

    cy.get("table").within(() => {
      cy.contains("th", "Title").should("be.visible");
      cy.contains("th", "Status").should("be.visible");
      cy.contains("th", "Actions").should("be.visible");
    });

    // The pager prints what the API said the total is, so this is the list
    // having rendered an answer rather than a spinner — either wording is a
    // pass, because which one appears is the account's business, not the test's.
    cy.contains(/No tasks|of \d+ tasks/).should("be.visible");
  });
});
