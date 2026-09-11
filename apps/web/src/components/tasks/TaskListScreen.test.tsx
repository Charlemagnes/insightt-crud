import type { TaskStatus } from "@insightt/shared";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setupServer } from "msw/node";

import { aTask, fakeTaskApi, renderTaskList } from "@/testing/harness";

/**
 * The integration test the brief asks for (PLAN.md §15, test 2): the real task
 * list, driven the way a person drives it, with the network the only thing
 * standing in.
 *
 * It asserts what someone looking at the screen would see — rows, Statuses,
 * which buttons they may press — and never how many requests went out or what
 * the cache holds. Those are the implementation's business, and a test that
 * pinned them would fail every time the caching policy changed without
 * anything visible having gone wrong.
 */
const api = fakeTaskApi();
const server = setupServer(...api.handlers);

// `error` and not the default warning: an unhandled request means the screen
// reached for something this fake does not describe, and the assertion that
// follows would be measuring an empty list rather than the feature.
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/**
 * One row, found by the title in its first cell.
 *
 * The title is matched as text rather than compiled into a `RegExp`, so a
 * title containing a metacharacter picks its own row instead of quietly
 * becoming a pattern that matches several or none.
 */
function rowFor(title: string): HTMLElement {
  return screen.getByRole("row", { name: (name) => name.includes(title) });
}

/** A control inside one row, so two rows' Start buttons are never confused. */
function buttonIn(title: string, label: string): HTMLElement {
  return within(rowFor(title)).getByRole("button", { name: label });
}

/**
 * Narrows the list the way a person does: open the Status control and pick an
 * option. Going through the control rather than the store is the point — what
 * is being checked is that choosing Archived is what surfaces Archived Tasks.
 *
 * The option is found by role and not by text: every Status label also appears
 * as a tag inside a row, and a bare text query would find the wrong one. That
 * the role is there at all is what `virtual={false}` on the control buys — a
 * windowed list gives the role to two placeholder nodes instead.
 */
async function filterBy(label: string): Promise<void> {
  await userEvent.click(
    screen.getByRole("combobox", { name: "Filter by status" }),
  );
  await userEvent.click(await screen.findByRole("option", { name: label }));
}

describe("the task list", () => {
  it("renders the Tasks the API returned", async () => {
    api.reset([
      aTask({ title: "Write the plan", status: "PENDING" }),
      aTask({ title: "Ship the API", status: "IN_PROGRESS" }),
      aTask({ title: "Bank the result", status: "DONE" }),
    ]);

    renderTaskList();

    expect(await screen.findByText("Write the plan")).toBeInTheDocument();
    expect(
      within(rowFor("Ship the API")).getByText("In progress"),
    ).toBeInTheDocument();
    expect(
      within(rowFor("Bank the result")).getByText("Done"),
    ).toBeInTheDocument();
  });

  /**
   * The list is the work still in front of the person, so an Archived Task is
   * filed away rather than listed (CONTEXT.md, "Archived"). Both halves are one
   * test on purpose: "it is missing" and "it is missing because it was
   * deleted" look identical until the filter brings it back.
   */
  it("hides Archived Tasks until the Archived filter asks for them", async () => {
    api.reset([
      aTask({ title: "Write the plan", status: "PENDING" }),
      aTask({ title: "Retire the spike", status: "ARCHIVED" }),
    ]);

    renderTaskList();

    expect(await screen.findByText("Write the plan")).toBeInTheDocument();
    expect(screen.queryByText("Retire the spike")).not.toBeInTheDocument();

    await filterBy("Archived");

    expect(await screen.findByText("Retire the spike")).toBeInTheDocument();
    expect(screen.queryByText("Write the plan")).not.toBeInTheDocument();
  });

  /**
   * Archiving is the one Transition that takes the row out of the list it was
   * clicked in: a `DONE` Task is archived from either the Done filter or the
   * unfiltered list, and neither shows an Archived Task afterwards.
   */
  it("removes the row when a Done Task is archived", async () => {
    api.reset([
      aTask({ title: "Bank the result", status: "DONE" }),
      aTask({ title: "Write the plan", status: "PENDING" }),
    ]);

    renderTaskList();
    await screen.findByText("Bank the result");

    await userEvent.click(buttonIn("Bank the result", "Archive"));

    expect(await screen.findByText("Task archived")).toBeInTheDocument();
    expect(screen.queryByText("Bank the result")).not.toBeInTheDocument();
    expect(screen.getByText("Write the plan")).toBeInTheDocument();
  });

  it("re-renders the row as Done when an in-progress Task is marked done", async () => {
    api.reset([aTask({ title: "Ship the API", status: "IN_PROGRESS" })]);

    renderTaskList();
    await screen.findByText("Ship the API");

    await userEvent.click(buttonIn("Ship the API", "Mark done"));

    expect(
      await within(rowFor("Ship the API")).findByText("Done"),
    ).toBeInTheDocument();
    expect(await screen.findByText("Task done")).toBeInTheDocument();
  });

  /**
   * The regression this test exists for. A Task finished somewhere else answers
   * the second Mark Done with `200` and `X-Idempotent-Replay: true` — a success
   * that says "already done", not a failure — and the screen must say so rather
   * than show an error over a Task that is in exactly the state that was asked
   * for (CONTEXT.md, "Replay").
   *
   * The message is what carries the assertion. The row reads `DONE` either way,
   * because the Task *is* Done and the list is refetched once the mutation
   * settles: what a mishandled Replay breaks is what the person is told, not
   * where the Task ends up.
   *
   * This covers the reading half only. MSW applies no CORS, so the header is
   * always legible here, and the other way to break Replay — dropping
   * `X-Idempotent-Replay` from `exposedHeaders`, after which a real browser
   * hides it (`apps/web/src/api/tasks.ts`) — is invisible to this test. That
   * one is `apps/api/src/app.test.ts`'s, where the CORS config actually lives.
   */
  it("treats a Replay as success, not an error", async () => {
    const task = aTask({ title: "Ship the API", status: "IN_PROGRESS" });
    api.reset([task]);

    renderTaskList();
    await screen.findByText("Ship the API");

    // Finished in another tab, after this one had already drawn the row.
    api.completeElsewhere(task.id);

    await userEvent.click(buttonIn("Ship the API", "Mark done"));

    expect(
      await screen.findByText("That task was already done"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Task done")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Could not mark the task done"),
    ).not.toBeInTheDocument();
    expect(
      await within(rowFor("Ship the API")).findByText("Done"),
    ).toBeInTheDocument();
  });

  /**
   * The regression this test exists for. antd's form store outlives the modal's
   * contents, and it wins over `initialValues` when the fields remount — so the
   * second Task edited in a session came up wearing the first one's title, and
   * saving it would have renamed the wrong work.
   *
   * The description is asserted too, because the two fields fail separately: a
   * fix that only reseeds what was typed in leaves the untouched one stale.
   */
  it("shows the Task it was opened on when a second row is edited", async () => {
    api.reset([
      aTask({ title: "Write the plan", description: "The plan" }),
      aTask({ title: "Ship the API", description: "The API" }),
    ]);

    renderTaskList();
    await screen.findByText("Write the plan");

    await userEvent.click(buttonIn("Write the plan", "Edit"));
    expect(await screen.findByLabelText("Title")).toHaveValue("Write the plan");

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await userEvent.click(buttonIn("Ship the API", "Edit"));

    expect(await screen.findByLabelText("Title")).toHaveValue("Ship the API");
    expect(screen.getByLabelText("Description")).toHaveValue("The API");
  });

  /**
   * A row offers one Transition, named for the one move its Status allows —
   * the machine is linear, so there is never a second to choose between. What
   * is checked here is that the name matches the Status, and that the terminal
   * one offers nothing.
   *
   * Delete is asserted enabled on the terminal Status on purpose: it is the
   * counterpart to the rest of that row being greyed out, and without it the
   * assertion would also pass on a row that was disabled wholesale.
   *
   * The Archived row is reached through its filter, because that is the only
   * place it appears — which is also why the loop runs per view rather than
   * over one page holding all four.
   */
  it("offers each row the one Transition its Status allows", async () => {
    const step: Record<TaskStatus, string> = {
      PENDING: "Start",
      IN_PROGRESS: "Mark done",
      DONE: "Archive",
      // The label the control wears when there is no move left, so an Archived
      // row still has a third button in the third place, turned off.
      ARCHIVED: "No next step",
    };

    const expectRow = (title: string, status: TaskStatus) => {
      // `toBeDisabled`, not the `disabled` property: it is the state assistive
      // technology reports, so a control turned off with `aria-disabled` alone
      // would still have to say so.
      const next = buttonIn(title, step[status]);
      if (status === "ARCHIVED") {
        expect(next).toBeDisabled();
        expect(buttonIn(title, "Edit")).toBeDisabled();
      } else {
        expect(next).toBeEnabled();
        expect(buttonIn(title, "Edit")).toBeEnabled();
      }

      // No other row is a second Transition in disguise: the labels the other
      // Statuses use are absent, not merely greyed out.
      for (const other of Object.values(step)) {
        if (other !== step[status]) {
          expect(
            within(rowFor(title)).queryByRole("button", { name: other }),
          ).not.toBeInTheDocument();
        }
      }

      // Deletion is legal from every Status, `ARCHIVED` included (PLAN.md §7).
      expect(buttonIn(title, "Delete")).toBeEnabled();
    };

    api.reset([
      aTask({ title: "Write the plan", status: "PENDING" }),
      aTask({ title: "Ship the API", status: "IN_PROGRESS" }),
      aTask({ title: "Bank the result", status: "DONE" }),
      aTask({ title: "Retire the spike", status: "ARCHIVED" }),
    ]);

    renderTaskList();
    await screen.findByText("Write the plan");

    expectRow("Write the plan", "PENDING");
    expectRow("Ship the API", "IN_PROGRESS");
    expectRow("Bank the result", "DONE");

    await filterBy("Archived");
    await screen.findByText("Retire the spike");

    expectRow("Retire the spike", "ARCHIVED");
  });
});
