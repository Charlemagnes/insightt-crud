"use client";

import { useAuth0 } from "@auth0/auth0-react";
import { Button } from "antd";

/**
 * Sends the person to Auth0's hosted signup page — the same redirect as
 * `LoginButton`, with `screen_hint` choosing which tab of Universal Login
 * opens. Registration is therefore not a second flow with a second set of
 * failure modes: Auth0 creates the user, signs them in, and returns to the
 * same callback with the same `?code=`, so everything downstream of
 * `onRedirectCallback` is already written.
 *
 * `screen_hint` is honoured by the **New** Universal Login only; a tenant left
 * on the Classic experience lands on the login tab, from which the person can
 * still reach "Sign up". A hint, not a guarantee, which is why the landing
 * copy says what the button does rather than relying on the screen it opens.
 */
export function SignUpButton() {
  const { loginWithRedirect, isLoading } = useAuth0();

  return (
    <Button
      size="large"
      loading={isLoading}
      onClick={() =>
        void loginWithRedirect({
          authorizationParams: { screen_hint: "signup" },
        })
      }
    >
      Sign up
    </Button>
  );
}
