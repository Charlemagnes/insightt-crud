"use client";

import {
  Auth0Provider as Auth0ReactProvider,
  useAuth0,
  type AppState,
} from "@auth0/auth0-react";
import { useEffect, type ReactNode } from "react";

import { config } from "@/config";
import { useSessionStore } from "@/stores/session";

/**
 * The callback URL is the app's own root — there is no `/callback` route — so
 * Auth0 returns with `?code=` and `?state=` on the address bar. Replacing the
 * entry strips them without adding a history entry the back button can revisit.
 */
function onRedirectCallback(appState?: AppState) {
  window.history.replaceState(
    {},
    document.title,
    appState?.returnTo ?? window.location.pathname,
  );
}

/**
 * Authorization Code + PKCE against Auth0 Universal Login. The app never
 * renders a credential form; Auth0 hosts login and signup.
 *
 * `cacheLocation: 'localstorage'` with rotating refresh tokens is what makes
 * the session survive a reload in browsers that block third-party cookies —
 * in-memory caching falls back to hidden-iframe silent auth, which Safari and
 * Brave refuse. The cost is that the token is XSS-reachable; the trade is
 * deliberate and stated in the README (ADR-0001).
 */
export function Auth0Provider({ children }: { children: ReactNode }) {
  return (
    <Auth0ReactProvider
      domain={config.auth0Domain}
      clientId={config.auth0ClientId}
      authorizationParams={{
        // Read lazily: this component is prerendered at build time, where there
        // is no `window`.
        redirect_uri:
          typeof window === "undefined" ? undefined : window.location.origin,
        audience: config.auth0Audience,
      }}
      cacheLocation="localstorage"
      useRefreshTokens
      onRedirectCallback={onRedirectCallback}
    >
      <SessionMirror />
      {children}
    </Auth0ReactProvider>
  );
}

/**
 * Copies the Auth0 context into the Zustand store on every change. Renders
 * nothing — it exists so that code outside React, chiefly the API client, can
 * read the session without a hook.
 */
function SessionMirror() {
  const { user, isAuthenticated, isLoading, getAccessTokenSilently, loginWithRedirect } =
    useAuth0();
  const setSession = useSessionStore((state) => state.setSession);

  useEffect(() => {
    setSession({
      user:
        isAuthenticated && user?.sub
          ? {
              userId: user.sub,
              name: user.name ?? user.email ?? user.sub,
              email: user.email ?? "",
            }
          : null,
      isAuthenticated,
      isLoading,
      getAccessToken: () => getAccessTokenSilently(),
      login: () => loginWithRedirect(),
    });
  }, [
    user,
    isAuthenticated,
    isLoading,
    getAccessTokenSilently,
    loginWithRedirect,
    setSession,
  ]);

  return null;
}
