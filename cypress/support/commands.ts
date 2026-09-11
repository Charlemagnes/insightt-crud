import { mintToken, readTenant, seedSession, type Auth0User } from "./auth0";

declare global {
  namespace Cypress {
    interface Chainable {
      /**
       * Signs the test user in against the real tenant and opens `path` with
       * the session already in place. Yields the profile Auth0 returned, so a
       * spec can assert on the person the app is showing rather than on a name
       * written down twice.
       */
      signInAndVisit(path?: string): Chainable<Auth0User>;
    }
  }
}

/**
 * Minting and visiting are one command rather than two because their order is
 * the whole trick: the session has to be in storage before the app's first
 * script runs, and a separate `cy.signIn()` would be a step a spec could put
 * after `cy.visit` and watch fail as a signed-out landing page.
 */
Cypress.Commands.add("signInAndVisit", (path = "/") =>
  readTenant().then((tenant) =>
    mintToken(tenant).then((token) => {
      // Filled in by `onBeforeLoad`, which Cypress runs during the visit below
      // rather than before it — so the profile is only readable in the `.then`.
      let user: Auth0User | undefined;

      return cy
        .visit(path, {
          onBeforeLoad(win) {
            user = seedSession(win, tenant, token);
          },
        })
        .then(() => {
          if (!user) throw new Error("The visit never seeded a session");
          return user;
        });
    }),
  ),
);
