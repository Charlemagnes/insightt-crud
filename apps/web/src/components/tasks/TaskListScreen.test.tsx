import { TASK_PAGE, type TaskStatus } from "@insightt/shared";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setupServer } from "msw/node";

import { useTaskListStore } from "@/stores/taskList";
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

/**
 * Every row's title, top to bottom — the list's order as the person sees it.
 * The first cell of each row, so a title that also appears in a description or
 * a form field behind the table cannot join the list.
 */
function titlesInOrder(): string[] {
  return screen
    .getAllByRole("row")
    .slice(1) // the header row, which has no Task
    .map((row) => within(row).getAllByRole("cell")[1]?.textContent ?? "");
}

/** A control inside one row, so two rows' Start buttons are never confused. */
function buttonIn(title: string, label: string): HTMLElement {
  return within(rowFor(title)).getByRole("button", { name: label });
}

/**
 * A field of the open form, looked up inside the dialog rather than across the
 * page. The scope is not incidental: a sortable column header carries an
 * `aria-label` of the column's name, so "Title" on the page as a whole is two
 * elements — the header and the field — and an unscoped query finds both.
 */
function formField(label: string): Promise<HTMLElement> {
  return screen
    .findByRole("dialog")
    .then((dialog) => within(dialog).findByLabelText(label));
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
   * Sorting is the server's, so what is checked here is the whole round trip:
   * the header click reaches the store, the store reaches the query key, and
   * the rows that come back are in the order the header now claims.
   *
   * The titles are read off the rendered rows rather than asserted one at a
   * time, because the order *is* the assertion — a test that only checked the
   * first row would pass on a list that reversed everything after it.
   */
  it("reorders the list from the server when a column header is clicked", async () => {
    api.reset([
      aTask({ title: "Bank the result" }),
      aTask({ title: "Alphabetise the shelf" }),
      aTask({ title: "Correct the record" }),
    ]);

    renderTaskList();
    await screen.findByText("Bank the result");

    // Unsorted, which is where the list starts: no column claims it, and the
    // rows arrive in creation order — the order the fixtures are written in.
    expect(titlesInOrder()).toEqual([
      "Bank the result",
      "Alphabetise the shelf",
      "Correct the record",
    ]);

    await userEvent.click(screen.getByRole("columnheader", { name: "Title" }));

    await waitFor(() =>
      expect(titlesInOrder()).toEqual([
        "Alphabetise the shelf",
        "Bank the result",
        "Correct the record",
      ]),
    );
  });

  /**
   * The header is a three-step cycle, and the third step is the way back: a
   * person who sorted a column can put the list the way they found it without
   * having to remember what order it was in.
   *
   * The rows are checked and not just the header, because clearing the sort has
   * to reach the server — a column that only dropped its own arrow would leave
   * the list sitting in an order nothing was claiming any more.
   */
  it("clears the sort on the third click, and the rows come back unsorted", async () => {
    api.reset([aTask({ title: "Beta" }), aTask({ title: "Alpha" })]);

    renderTaskList();
    await screen.findByText("Beta");

    // Unsorted: creation order, which is the order the fixtures are written in.
    expect(titlesInOrder()).toEqual(["Beta", "Alpha"]);

    const header = screen.getByRole("columnheader", { name: "Title" });

    await userEvent.click(header);
    await waitFor(() => expect(titlesInOrder()).toEqual(["Alpha", "Beta"]));

    await userEvent.click(header);
    await waitFor(() => expect(titlesInOrder()).toEqual(["Beta", "Alpha"]));

    await userEvent.click(header);
    await waitFor(() => expect(useTaskListStore.getState().sort).toBeNull());
    expect(titlesInOrder()).toEqual(["Beta", "Alpha"]);
  });

  // The arrow is the order the rows actually arrived in. No column may claim a
  // sorted list before one is asked for, and none may go on claiming one once
  // the sort is cleared.
  it("marks only the sorted column, and only while there is a sort", async () => {
    api.reset([aTask({ title: "Alpha" }), aTask({ title: "Beta" })]);

    renderTaskList();
    await screen.findByText("Alpha");

    const header = screen.getByRole("columnheader", { name: "Title" });
    const other = screen.getByRole("columnheader", { name: "Created" });

    // Ant Design leaves the attribute off an unsorted column rather than
    // writing `none`, so absence is what "this column claims nothing" looks
    // like — here at the start, and again after the third click.
    expect(header).not.toHaveAttribute("aria-sort");

    for (const expected of ["ascending", "descending", null]) {
      await userEvent.click(header);

      await waitFor(() =>
        expect(header.getAttribute("aria-sort")).toBe(expected),
      );
      expect(other).not.toHaveAttribute("aria-sort");
    }
  });

  // The sort applies to every matching Task and not the page on screen, so the
  // page number counts into a result set the new order has just replaced.
  it("returns to the first page when the sort changes", async () => {
    api.reset(
      Array.from({ length: 8 }, (_, index) =>
        aTask({ title: `Paged task ${index}` }),
      ),
    );

    renderTaskList();
    await screen.findByText("Paged task 0");

    // By title, which is what Ant Design puts on a pager item: the item is an
    // `li` wrapping an `a` with no `href`, so it answers to neither role.
    await userEvent.click(screen.getByTitle("2"));
    await waitFor(() => expect(useTaskListStore.getState().page).toBe(2));

    await userEvent.click(screen.getByRole("columnheader", { name: "Status" }));

    await waitFor(() =>
      expect(useTaskListStore.getState().page).toBe(TASK_PAGE.first),
    );
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
   * The regression this test exists for. The optimistic write lands the moment
   * the request goes, so the row reads as its next Status — and the control
   * relabels itself for the step *after* the one still in flight. Left live, a
   * second click walks the machine a step ahead of the API, on a Version the
   * browser has not been told yet.
   *
   * Marking Done is the case with a step left after it, which is what makes
   * the control relabel rather than simply go quiet.
   */
  it("offers no further step until the API has confirmed the last one", async () => {
    api.reset([aTask({ title: "Ship the API", status: "IN_PROGRESS" })]);

    renderTaskList();
    await screen.findByText("Ship the API");

    const answer = api.holdAnswers();
    await userEvent.click(buttonIn("Ship the API", "Mark done"));

    // Already wearing the next step's name, which is the click being refused.
    const next = await within(rowFor("Ship the API")).findByRole("button", {
      name: "Archive",
    });
    expect(next).toBeDisabled();

    answer();

    expect(await screen.findByText("Task done")).toBeInTheDocument();
    await waitFor(() =>
      expect(buttonIn("Ship the API", "Archive")).toBeEnabled(),
    );
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
    expect(await formField("Title")).toHaveValue("Write the plan");

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await userEvent.click(buttonIn("Ship the API", "Edit"));

    expect(await formField("Title")).toHaveValue("Ship the API");
    expect(await formField("Description")).toHaveValue("The API");
  });

  /**
   * The counterpart to the test above, on the row's other two controls. A
   * Transition raises the Version, and the row is holding the old one until the
   * response says what it became — so an Edit opened in that window would
   * submit an `If-Match` the API has already moved past, and a Delete would be
   * a second command against a Task mid-move.
   */
  it("closes the rest of the row while a Transition is in flight", async () => {
    api.reset([aTask({ title: "Ship the API", status: "IN_PROGRESS" })]);

    renderTaskList();
    await screen.findByText("Ship the API");

    const answer = api.holdAnswers();
    await userEvent.click(buttonIn("Ship the API", "Mark done"));

    expect(buttonIn("Ship the API", "Edit")).toBeDisabled();
    expect(buttonIn("Ship the API", "Delete")).toBeDisabled();

    answer();

    expect(await screen.findByText("Task done")).toBeInTheDocument();
    await waitFor(() => expect(buttonIn("Ship the API", "Edit")).toBeEnabled());
    expect(buttonIn("Ship the API", "Delete")).toBeEnabled();
  });

  /**
   * The form's own version of the same rule. Create and Save are one request
   * each, and every way out of the modal closes while one is in flight — a
   * dismissal there would leave the request to land against a form that is
   * gone, and the person with no idea whether their Task was made.
   */
  it("closes the form's controls while it is saving", async () => {
    api.reset([]);

    renderTaskList();
    await screen.findByText("No tasks yet.");

    await userEvent.click(screen.getByRole("button", { name: /New task/ }));
    await userEvent.type(await formField("Title"), "Write it up");

    const answer = api.holdAnswers();
    await userEvent.click(screen.getByRole("button", { name: "Create" }));

    // `/Create/` and not the exact name: antd's spinner is an image labelled
    // "loading", so the button's accessible name grows a word the moment it
    // starts spinning — which is exactly the state being asserted.
    const dialog = within(screen.getByRole("dialog"));
    await waitFor(() =>
      expect(dialog.getByRole("button", { name: /Create/ })).toBeDisabled(),
    );
    expect(dialog.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(dialog.getByRole("button", { name: "Close" })).toBeDisabled();
    // The one that opens the form is off for as long as the form is up, so a
    // create in flight cannot be joined by a second one behind it.
    expect(screen.getByRole("button", { name: /New task/ })).toBeDisabled();

    answer();

    expect(await screen.findByText("Task created")).toBeInTheDocument();
    expect(await screen.findByText("Write it up")).toBeInTheDocument();
  });

  /**
   * What is typed into the form is the only copy of it. antd closes a modal on
   * a click beside it by default, which would throw a half-written Task away
   * without asking — so this one does not, and Cancel is the way out.
   */
  it("keeps the form open when the page behind it is clicked", async () => {
    api.reset([]);

    renderTaskList();
    await screen.findByText("No tasks yet.");

    await userEvent.click(screen.getByRole("button", { name: /New task/ }));
    await userEvent.type(await formField("Title"), "Write it up");

    // The element antd hangs that behaviour off: the scrollable wrapper the
    // dialog floats in, whose visible area is everything around it.
    const outside = document.querySelector(".ant-modal-wrap");
    expect(outside).not.toBeNull();
    await userEvent.click(outside as HTMLElement);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(await formField("Title")).toHaveValue("Write it up");
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
