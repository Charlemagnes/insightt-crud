import {
  decodeIdToken,
  mintToken,
  readAuth0Env,
  seedSession,
  type Profile,
} from "./auth0";

declare global {
  namespace Cypress {
    interface Chainable {
      /**
       * Signs the test user in against the real tenant and opens `path` with
       * the session already in place. Yields the profile Auth0 returned, so a
       * spec can assert on the person the app is showing rather than on a name
       * written down twice.
       */
      signInAndVisit(path?: string): Chainable<Profile>;
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
  readAuth0Env().then((env) =>
    mintToken(env).then((token) => {
      // Decoded here rather than inside the seed, so the profile this yields is
      // in hand before the visit rather than smuggled out of `onBeforeLoad`.
      const decoded = decodeIdToken(token.id_token);

      return cy
        .visit(path, {
          onBeforeLoad: (win) => seedSession(win, env, token, decoded),
        })
        .then(() => decoded.profile);
    }),
  ),
);
