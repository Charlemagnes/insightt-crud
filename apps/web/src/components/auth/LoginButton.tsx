"use client";

import { useAuth0 } from "@auth0/auth0-react";
import { Button } from "antd";

/**
 * Sends the person to Auth0's hosted login page. There is no credential form
 * anywhere in this app, by design — the password never reaches our origin.
 */
export function LoginButton() {
  const { loginWithRedirect, isLoading } = useAuth0();

  return (
    <Button
      type="primary"
      size="large"
      loading={isLoading}
      onClick={() => void loginWithRedirect()}
    >
      Log in
    </Button>
  );
}
