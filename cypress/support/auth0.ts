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
 * Everything below mirrors `@auth0/auth0-spa-js` v2 internals. The shapes are
 * checked against `@auth0/auth0-spa-js/dist/typings/cache/shared.d.ts`; an SDK
 * major upgrade is the thing that breaks this file.
 */

const PASSWORD_REALM_GRANT = "http://auth0.com/oauth/grant-type/password-realm";

/**
 * What the seeded session is granted. `openid` is what makes Auth0 return an ID
 * token at all, `profile email` is what puts a name in it for the header to
 * show, and `offline_access` is what the SDK appends for itself whenever
 * `useRefreshTokens` is on — so a key built without it would not be the key the
 * SDK goes looking under.
 */
const SCOPE = "openid profile email offline_access";

const CACHE_KEY_PREFIX = "@@auth0spajs@@";

/** The SDK's own suffix for the entry it keeps the ID token under. */
const ID_TOKEN_SUFFIX = "@@user@@";

/**
 * The claims the SDK treats as protocol rather than profile, and strips out of
 * the user object it hands to React. Copied from its `decode()` so the seeded
 * `user` is the object a real login would have produced — anything extra here
 * surfaces as a stray field on `useAuth0().user`.
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

/**
 * The tenant coordinates and the credentials, out of `cypress.env.json`.
 *
 * Two client ids, and they are not interchangeable. The token is *minted* with
 * the Cypress client, because that is the one allowed to use the Password Realm
 * grant; it is *stored* under the SPA client's cache key, because that is the
 * client the browser app boots as and the only key it looks under.
 */
export interface Tenant {
  domain: string;
  audience: string;
  realm: string;
  spaClientId: string;
  cypressClientId: string;
  cypressClientSecret: string;
  email: string;
  password: string;
}

/** The profile the app shows, as the SDK would have decoded it. */
export interface Auth0User {
  sub: string;
  name?: string;
  email?: string;
  [claim: string]: unknown;
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
 * coming back as an `invalid_request` that names none of them.
 *
 * `cy.env` is a command rather than a synchronous read since Cypress 16, hence
 * the chainable. `log: false` because two of the eight are secrets.
 */
export function readTenant(): Cypress.Chainable<Tenant> {
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
export function mintToken(tenant: Tenant): Cypress.Chainable<TokenResponse> {
  return cy
    .request<TokenResponse>({
      method: "POST",
      url: `https://${tenant.domain}/oauth/token`,
      body: {
        grant_type: PASSWORD_REALM_GRANT,
        realm: tenant.realm,
        username: tenant.email,
        password: tenant.password,
        audience: tenant.audience,
        scope: SCOPE,
        client_id: tenant.cypressClientId,
        client_secret: tenant.cypressClientSecret,
      },
      // The password and the client secret are both in that body, and a logged
      // request puts them in the run output for anyone reading CI.
      log: false,
    })
    .its("body");
}

/**
 * Writes the token into the window the app is about to boot in, in the exact
 * three places `@auth0/auth0-spa-js` looks.
 *
 * Called from `cy.visit`'s `onBeforeLoad`, which is the only moment that works:
 * before the visit there is no storage for the origin yet, and after it the SDK
 * has already decided the person is signed out.
 */
export function seedSession(
  win: Window,
  tenant: Tenant,
  token: TokenResponse,
): Auth0User {
  const { claims, user } = decodeIdToken(token.id_token);

  // 1. The access token, under `<prefix>::<clientId>::<audience>::<scope>`.
  //    The SDK asks under a narrower scope than was granted and accepts any
  //    stored key whose scopes are a superset of it, so the granted scope is
  //    what goes in the key — and it is what the entry body says as well.
  win.localStorage.setItem(
    cacheKey(tenant.spaClientId, tenant.audience, SCOPE),
    JSON.stringify({
      body: {
        client_id: tenant.spaClientId,
        audience: tenant.audience,
        scope: SCOPE,
        access_token: token.access_token,
        id_token: token.id_token,
        refresh_token: token.refresh_token,
        token_type: token.token_type,
        expires_in: token.expires_in,
        decodedToken: { claims, user },
      },
      expiresAt: Math.floor(Date.now() / 1000) + token.expires_in,
    }),
  );

  // 2. The ID token, under its own key. Not redundant: `getUser()` builds its
  //    lookup from the per-audience scope map, which holds no entry for this
  //    audience when the app names no scope of its own — so it arrives with no
  //    scope to match on and never falls through to the entry above.
  win.localStorage.setItem(
    cacheKey(tenant.spaClientId, undefined, undefined, ID_TOKEN_SUFFIX),
    JSON.stringify({ id_token: token.id_token, decodedToken: { claims, user } }),
  );

  // 3. The cookie `checkSession()` gates on. Without it the SDK returns early
  //    and never consults the cache — harmless on first paint, where `getUser()`
  //    is called regardless, but it is the difference between a seeded session
  //    and one indistinguishable from a real login.
  win.document.cookie = `auth0.${tenant.spaClientId}.is.authenticated=true; path=/`;

  return user;
}

/** `<prefix>::<clientId>::<audience>::<scope>`, empty segments dropped. */
function cacheKey(
  clientId: string,
  audience?: string,
  scope?: string,
  suffix?: string,
): string {
  return [CACHE_KEY_PREFIX, clientId, audience, scope, suffix]
    .filter(Boolean)
    .join("::");
}

/**
 * Splits an ID token the way the SDK does: `claims` is every claim plus the
 * `__raw` token, `user` is the same set with the protocol claims removed. No
 * signature check — Auth0 minted it seconds ago, and the API is the thing whose
 * job it is to verify tokens here.
 */
function decodeIdToken(idToken: string): {
  claims: Record<string, unknown>;
  user: Auth0User;
} {
  const payload = idToken.split(".")[1];
  if (!payload) throw new Error("The ID token has no payload segment");

  const decoded = JSON.parse(
    atob(payload.replace(/-/g, "+").replace(/_/g, "/")),
  ) as Record<string, unknown>;

  return {
    claims: { __raw: idToken, ...decoded },
    user: Object.fromEntries(
      Object.entries(decoded).filter(([claim]) => !PROTOCOL_CLAIMS.has(claim)),
    ) as Auth0User,
  };
}

function required(env: Record<string, unknown>, name: string): string {
  const value = env[name];

  if (typeof value !== "string" || value === "") {
    throw new Error(
      `Missing ${name}. Run 'bash scripts/setup-auth0.sh' to write cypress.env.json.`,
    );
  }

  return value;
}
