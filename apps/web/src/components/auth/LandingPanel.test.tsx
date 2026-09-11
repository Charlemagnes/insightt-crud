import { useAuth0 } from "@auth0/auth0-react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { LandingPanel } from "@/components/auth/LandingPanel";
import { AntdProvider } from "@/providers/Antd";

/**
 * The signed-out screen, and the one thing about it that cannot be seen by
 * looking: which Universal Login screen each button opens. Both call the same
 * SDK function and differ only in an argument, so a mistake here shows up not
 * as a broken page but as a "Sign up" button that lands a person with no
 * account on a login form.
 *
 * `useAuth0` is faked, which the task list harness deliberately refuses to do
 * (`src/testing/harness.tsx`). The difference is what is under test: there the
 * fake would stand in for something the Task list never calls, while here the
 * call into the SDK *is* the behaviour, and the real provider would answer it
 * with a redirect to a tenant that does not exist.
 */
jest.mock("@auth0/auth0-react", () => ({ useAuth0: jest.fn() }));

const loginWithRedirect = jest.fn();

beforeEach(() => {
  loginWithRedirect.mockReset();
  (useAuth0 as jest.Mock).mockReturnValue({
    loginWithRedirect,
    isLoading: false,
  });
});

function renderLandingPanel() {
  return render(
    <AntdProvider>
      <LandingPanel />
    </AntdProvider>,
  );
}

describe("the landing panel", () => {
  it("offers both ways in", () => {
    renderLandingPanel();

    expect(screen.getByRole("button", { name: "Log in" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign up" })).toBeInTheDocument();
  });

  it("opens the login screen from Log in", async () => {
    renderLandingPanel();

    await userEvent.click(screen.getByRole("button", { name: "Log in" }));

    // No `screen_hint` at all: login is what Universal Login opens on, and
    // spelling it out would only invite the two buttons to be read as
    // symmetrical when one of them carries the whole feature.
    expect(loginWithRedirect).toHaveBeenCalledWith();
  });

  it("opens the signup screen from Sign up", async () => {
    renderLandingPanel();

    await userEvent.click(screen.getByRole("button", { name: "Sign up" }));

    expect(loginWithRedirect).toHaveBeenCalledWith({
      authorizationParams: { screen_hint: "signup" },
    });
  });
});
