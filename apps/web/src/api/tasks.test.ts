import { TASK_PAGE } from "@insightt/shared";

import { ALL_STATUSES, listTasks, type TaskListParams } from "@/api/tasks";
import { config } from "@/config";
import { useSessionStore } from "@/stores/session";

/**
 * What the list view state becomes on the wire is the one piece of paging that
 * no other test reaches: the store is checked here, the API is checked in
 * `apps/api`, and this is the sentence between them. A misspelled `pageSize`
 * would leave both suites green and every list stuck on page one.
 */
const EMPTY_PAGE = {
  items: [],
  page: TASK_PAGE.first,
  pageSize: TASK_PAGE.defaultSize,
  total: 0,
};

const VIEW: TaskListParams = {
  page: TASK_PAGE.first,
  pageSize: TASK_PAGE.defaultSize,
  status: ALL_STATUSES,
};

/**
 * A `200` carrying `body`, as much of a `Response` as this path reads.
 *
 * Not the real thing: jsdom ships no `fetch` primitives, and the polyfill that
 * supplies them is PLAN.md §15's known landmine, which belongs with the MSW
 * setup rather than here. `apiSend` asks a response three questions — `ok`,
 * `status`, `json()` — and this answers all three.
 */
function responds(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

const fetchMock = jest.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(responds(EMPTY_PAGE));
  global.fetch = fetchMock as unknown as typeof fetch;

  // `apiSend` reads the token getter out of the session store, which Auth0
  // normally fills in. Nothing here is testing authentication, so it only has
  // to resolve.
  useSessionStore.setState({ getAccessToken: () => Promise.resolve("token") });
});

/** The URL the one call under test asked for. */
async function urlFor(params: Partial<TaskListParams> = {}): Promise<URL> {
  await listTasks({ ...VIEW, ...params });

  return new URL(String(fetchMock.mock.calls[0]?.[0]));
}

describe("listTasks", () => {
  it("asks the Task list endpoint", async () => {
    const url = await urlFor();

    expect(url.origin + url.pathname).toBe(`${config.apiUrl}/api/tasks`);
  });

  it("names the page and the page size as the query schema spells them", async () => {
    const url = await urlFor({ page: 3, pageSize: 50 });

    expect(url.searchParams.get("page")).toBe("3");
    expect(url.searchParams.get("pageSize")).toBe("50");
  });

  it("sends the Status when the list is filtered", async () => {
    const url = await urlFor({ status: "ARCHIVED" });

    expect(url.searchParams.get("status")).toBe("ARCHIVED");
  });

  // `ALL` is not a Status the enum has, so sending it would be a `422`. Leaving
  // the key out is what the unfiltered list already defaults to.
  it("omits the Status entirely when the list is unfiltered", async () => {
    const url = await urlFor({ status: ALL_STATUSES });

    expect(url.searchParams.has("status")).toBe(false);
  });

  it("returns the page the API answered with", async () => {
    await expect(listTasks(VIEW)).resolves.toEqual(EMPTY_PAGE);
  });

  it("refuses a response that is not the shape the contract promises", async () => {
    fetchMock.mockResolvedValue(responds({ items: [] }));

    await expect(listTasks(VIEW)).rejects.toThrow();
  });
});
