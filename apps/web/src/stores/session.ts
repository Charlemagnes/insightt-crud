import { create } from "zustand";

/**
 * The signed-in person, as the SPA needs them. Deliberately not in
 * `@insightt/shared`: no user ever crosses the wire — the API reads the token
 * and returns Tasks, never a profile (PLAN.md §11).
 */
export interface AuthUser {
  /** The Auth0 `sub` claim. The same value the API calls `userId`. */
  userId: string;
  name: string;
  email: string;
}

interface SessionState {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  /**
   * A **function**, not a token string. `getAccessTokenSilently` returns the
   * cached token and refreshes only when it has expired, so calling it per
   * request is cheap — where a cached string would go stale behind a silent
   * refresh and start producing 401s.
   */
  getAccessToken: () => Promise<string>;
  /** Sends the person to Universal Login. Called on a 401. */
  login: () => Promise<void>;
  setSession: (session: Partial<SessionState>) => void;
}

function notReady(): never {
  throw new Error("Auth0 has not finished initialising");
}

/**
 * The session, mirrored out of the Auth0 React context so that non-React code
 * can reach it. This is what lets `api/client.ts` stay a plain function instead
 * of a hook: it reads the token getter from here.
 */
export const useSessionStore = create<SessionState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  getAccessToken: notReady,
  login: notReady,
  setSession: (session) => set(session),
}));
