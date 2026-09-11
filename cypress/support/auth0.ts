/**
 * Signing the test user in without driving Universal Login.
 *
 * Auth0's login page is a different origin, and a Cypress spec that types into
 * it is a test of Auth0 rather than of this app. Instead the token is minted
 * over HTTP with the Password Realm grant and written straight into the storage
 * the Auth0 SDK reads on boot, so the app starts up already signed in
 * (PLAN.md §15, test 3).
 *
 * **Fallback.** The grant has to be enabled on the tenant — Advanced Settings →
 * Grant Types → Password, on the Regular Web Application, which is why that
 * client exists at all (PLAN.md §10; Auth0 does not offer the grant on the SPA
 * application type). Some tenants forbid it outright, and the mint then fails
 * with `unauthorized_client`. The fallback is to drive Universal Login for real
 * inside `cy.origin('https://<tenant>.auth0.com', ...)` — click Log in, fill
 * the hosted form, and let the redirect land back on :3000. It is slower, it
 * breaks whenever Auth0 restyles that page, and it makes every spec depend on a
 * third party's markup, which is why it is the fallback and not the default.
 *
 * Everything below mirrors `@auth0/auth0-spa-js` v2 internals, checked against
 * the installed 2.24.1 rather than remembered; an SDK major is the thing that
 * breaks this file. Three of its behaviours are load-bearing and each is named
 * at the line that depends on it.
 */

const PASSWORD_REALM_GRANT = "http://auth0.com/oauth/grant-type/password-realm";

/**
 * What the seeded session asks for. `openid` is what makes Auth0 return an ID
 * token at all, and `profile email` is what puts a name in it for the header to
 * show. `offline_access` is not needed for a spec this short, but the SDK adds
 * it to its own requests whenever `useRefreshTokens` is on, and a session that
 * differs from a real one in what it was granted is a session that can behave
 * differently.
 *
 * `scripts/setup-auth0.sh` sends the same grant with the same scope as its
 * post-setup check, so a tenant that cannot serve this spec says so during
 * setup rather than an hour later. The two are written out separately — one in
 * `curl`, one here — and the setup script names this file in return.
 */
const SCOPE = "openid profile email offline_access";

const CACHE_KEY_PREFIX = "@@auth0spajs@@";

/** `cypress.env.json`, typed. Every field is required; see `readAuth0Env`. */
export interface Auth0Env {
  domain: string;
  audience: string;
  realm: string;
  /**
   * The browser app's client. The seeded entries go under *this* id, because
   * it is the only one the app will look under.
   */
  spaClientId: string;
  /**
   * The Regular Web Application, which is the client allowed the Password Realm
   * grant. It mints the token and then has nothing further to do with it: the
   * two ids are not interchangeable, and the `azp` claim is the only place the
   * difference survives — which nothing checks, while the signature, issuer and
   * audience the API does check all hold.
   */
  cypressClientId: string;
  cypressClientSecret: string;
  email: string;
  password: string;
}

/** The profile the app shows, as the SDK would have decoded it. */
export interface Profile {
  name?: string;
  email?: string;
  [claim: string]: unknown;
}

/** An ID token split the way the SDK splits it. */
export interface DecodedIdToken {
  claims: Record<string, unknown>;
  profile: Profile;
}

interface TokenResponse {
  access_token: string;
  id_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

const ENV_KEYS = [
  "AUTH0_DOMAIN",
  "AUTH0_AUDIENCE",
  "AUTH0_REALM",
  "AUTH0_SPA_CLIENT_ID",
  "AUTH0_CYPRESS_CLIENT_ID",
  "AUTH0_CYPRESS_CLIENT_SECRET",
  "AUTH0_TEST_EMAIL",
  "AUTH0_TEST_PASSWORD",
];

/**
 * Reads `cypress.env.json`, checking every value is there. A missing one is
 * worth failing on by name: the alternative is `undefined` reaching Auth0 and
 * coming back as an `invalid_request` naming none of them.
 *
 * `cy.env` is a command rather than a synchronous read as of Cypress 16, hence
 * the chainable. `log: false` because two of the eight are secrets.
 */
export function readAuth0Env(): Cypress.Chainable<Auth0Env> {
  return cy.env(ENV_KEYS, { log: false }).then((env) => ({
    domain: required(env, "AUTH0_DOMAIN"),
    audience: required(env, "AUTH0_AUDIENCE"),
    realm: required(env, "AUTH0_REALM"),
    spaClientId: required(env, "AUTH0_SPA_CLIENT_ID"),
    cypressClientId: required(env, "AUTH0_CYPRESS_CLIENT_ID"),
    cypressClientSecret: required(env, "AUTH0_CYPRESS_CLIENT_SECRET"),
    email: required(env, "AUTH0_TEST_EMAIL"),
    password: required(env, "AUTH0_TEST_PASSWORD"),
  }));
}

/**
 * Exchanges the test user's password for a real access token against the real
 * tenant. `realm` is sent explicitly so the tenant's Default Directory setting
 * never enters into it — left out, the same request fails on a tenant that has
 * no default directory, with an error naming the grant rather than the setting.
 */
export function mintToken(env: Auth0Env): Cypress.Chainable<TokenResponse> {
  return cy
    .request<TokenResponse>({
      method: "POST",
      url: `https://${env.domain}/oauth/token`,
      body: {
        grant_type: PASSWORD_REALM_GRANT,
        realm: env.realm,
        username: env.email,
        password: env.password,
        audience: env.audience,
        scope: SCOPE,
        client_id: env.cypressClientId,
        client_secret: env.cypressClientSecret,
      },
      // The password and the client secret are both in that body, and a logged
      // request puts them in the run output for anyone reading CI.
      log: false,
    })
    .its("body");
}

/**
 * Splits an ID token the way the SDK does: `claims` is every claim plus the
 * `__raw` token, `profile` is the same set with the protocol claims removed. No
 * signature check — Auth0 minted it seconds ago, and the API is the thing whose
 * job it is to verify tokens here.
 */
export function decodeIdToken(idToken: string): DecodedIdToken {
  const payload = idToken.split(".")[1];
  if (!payload) throw new Error("The ID token has no payload segment");

  const decoded = JSON.parse(
    atob(payload.replace(/-/g, "+").replace(/_/g, "/")),
  ) as Record<string, unknown>;

  return {
    claims: { __raw: idToken, ...decoded },
    profile: Object.fromEntries(
      Object.entries(decoded).filter(([claim]) => !PROTOCOL_CLAIMS.has(claim)),
    ),
  };
}

/**
 * Writes the token into the window the app is about to boot in, in the three
 * places `@auth0/auth0-spa-js` looks.
 *
 * Called from `cy.visit`'s `onBeforeLoad`, which is the only moment that works:
 * before the visit there is no storage for the origin yet, and after it the SDK
 * has already decided the person is signed out.
 */
export function seedSession(
  win: Window,
  env: Auth0Env,
  token: TokenResponse,
  { claims, profile }: DecodedIdToken,
): void {
  // 1. The access token, under `<prefix>::<clientId>::<audience>::<scope>`.
  //
  //    This key is deliberately not the one the SDK builds. It asks under
  //    `openid offline_access` — as of 2.24.1 those are the only scopes it
  //    injects by default, and the app names none of its own — so the exact
  //    lookup misses and the entry is found by `matchExistingCacheKey`, which
  //    scans every stored key for one whose scopes are a superset. Writing the
  //    granted scope is what keeps the key honest about what the entry holds;
  //    that scan is what makes it reachable, and it is load-bearing.
  win.localStorage.setItem(
    tokenCacheKey(env.spaClientId, env.audience, SCOPE),
    JSON.stringify({
      body: {
        client_id: env.spaClientId,
        audience: env.audience,
        scope: SCOPE,
        access_token: token.access_token,
        id_token: token.id_token,
        refresh_token: token.refresh_token,
        token_type: token.token_type,
        expires_in: token.expires_in,
        decodedToken: { claims, user: profile },
      },
      expiresAt: Math.floor(Date.now() / 1000) + token.expires_in,
    }),
  );

  // 2. The ID token, under its own key, which is what `getUser()` reads — and
  //    `getUser()` is the whole of `isAuthenticated`. Not redundant with the
  //    entry above: it builds its lookup from the SDK's per-audience scope map,
  //    which holds an entry for `default` only while the app names no scope of
  //    its own, so it arrives with no scope to match on and the fallback to the
  //    scoped entry is skipped.
  win.localStorage.setItem(
    idTokenCacheKey(env.spaClientId),
    JSON.stringify({
      id_token: token.id_token,
      decodedToken: { claims, user: profile },
    }),
  );

  // 3. The cookie `checkSession()` gates on. Without it the SDK returns early
  //    and never consults the cache — harmless on first paint, where `getUser()`
  //    is called regardless, but it is the difference between a seeded session
  //    and one indistinguishable from a real login.
  win.document.cookie = `auth0.${env.spaClientId}.is.authenticated=true; path=/`;
}

/** Where the SDK keeps an access token: one key per client, audience and scope. */
function tokenCacheKey(
  clientId: string,
  audience: string,
  scope: string,
): string {
  return [CACHE_KEY_PREFIX, clientId, audience, scope].join("::");
}

/** Where it keeps the ID token: one key per client, whatever the audience. */
function idTokenCacheKey(clientId: string): string {
  return [CACHE_KEY_PREFIX, clientId, "@@user@@"].join("::");
}

/**
 * The claims the SDK treats as protocol rather than profile, and strips out of
 * the user object it hands to React. Copied from its `decode()` so the seeded
 * profile is the object a real login would have produced — anything extra here
 * surfaces as a stray field on `useAuth0().user`.
 *
 * `session_expiry` is pointedly not among them, and is left alone for the same
 * reason: the SDK clears the whole local session when that claim is in the past,
 * so a hand-written one would be a seeded session that deletes itself.
 */
const PROTOCOL_CLAIMS = new Set([
  "iss",
  "aud",
  "exp",
  "nbf",
  "iat",
  "jti",
  "azp",
  "nonce",
  "auth_time",
  "at_hash",
  "c_hash",
  "acr",
  "amr",
  "sub_jwk",
  "cnf",
  "sip_from_tag",
  "sip_date",
  "sip_callid",
  "sip_cseq_num",
  "sip_via_branch",
  "orig",
  "dest",
  "mky",
  "events",
  "toe",
  "txn",
  "rph",
  "sid",
  "vot",
  "vtm",
]);

function required(env: Record<string, unknown>, name: string): string {
  const value = env[name];

  if (typeof value !== "string" || value === "") {
    throw new Error(
      `Missing ${name}. Run 'bash scripts/setup-auth0.sh' to write cypress.env.json.`,
    );
  }

  return value;
}
