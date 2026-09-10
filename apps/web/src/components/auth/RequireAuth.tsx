"use client";

import { useAuth0 } from "@auth0/auth0-react";
import type { ReactNode } from "react";

import { LandingPanel } from "@/components/auth/LandingPanel";
import { ErrorState } from "@/components/shared/ErrorState";
import { FullPageSpin } from "@/components/shared/FullPageSpin";

/**
 * The gate between the two screens this app has.
 *
 * `isLoading` is checked first and covers the whole viewport, because on a
 * reload Auth0 restores the session asynchronously: rendering the landing panel
 * in the meantime would flash "Log in" at someone who is already signed in.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated, error } = useAuth0();

  if (isLoading) return <FullPageSpin />;

  if (error) {
    return (
      <div style={{ padding: 24 }}>
        <ErrorState title="Could not sign you in" description={error.message} />
      </div>
    );
  }

  if (!isAuthenticated) return <LandingPanel />;

  return <>{children}</>;
}
