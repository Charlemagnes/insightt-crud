"use client";

import { useAuth0 } from "@auth0/auth0-react";
import { Button } from "antd";

/**
 * Ends the session at Auth0 as well as locally — a local-only sign-out would
 * leave the tenant session standing, and the next "Log in" would sail straight
 * back through without a prompt.
 */
export function LogoutButton() {
  const { logout } = useAuth0();

  return (
    <Button
      onClick={() =>
        void logout({ logoutParams: { returnTo: window.location.origin } })
      }
    >
      Log out
    </Button>
  );
}
