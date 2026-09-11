/**
 * The frontend's test seam, the twin of `apps/api/src/testing/harness.ts`: it
 * builds the real screen — real components, real TanStack Query cache, real
 * Zustand stores — with nothing behind it but an in-memory API (PLAN.md §15).
 *
 * HTTP is the only thing faked: MSW answers the requests, and nothing else is
 * stubbed, spied on, or swapped for a double.
 *
 * Auth0 is the one thing left out rather than faked. There is no
 * `Auth0Provider` here, so the session store is *seeded* instead — the same
 * write `SessionMirror` makes once Auth0 resolves — and everything that reads
 * the store, the API client's token among it, behaves as it does signed in.
 * What does not is anything reading `useAuth0()` directly: `AppHeader` renders
 * its name blank and its Logout button is inert, because auth0-react hands an
 * unprovided consumer a stub. That is a header this test has no assertion
 * about, and the alternative — a fake `Auth0Provider` — would fake something
 * the Task list does not use. The header signed in for real is the Cypress
 * spec's job (PLAN.md §15, test 3).
 */
import { TASK_PAGE, type Task, type TaskPage } from "@insightt/shared";
import { render, type RenderResult } from "@testing-library/react";
import { http, HttpResponse, type RequestHandler } from "msw";

import { TaskListScreen } from "@/components/tasks/TaskListScreen";
import { config } from "@/config";
import { AntdProvider } from "@/providers/Antd";
import { QueryProvider } from "@/providers/Query";
import { useSessionStore } from "@/stores/session";
import { useTaskListStore } from "@/stores/taskList";

/** What the screen believes about the person, so `api/client.ts` can send a token. */
const SESSION = {
  user: {
    userId: "auth0|integration-test",
    name: "Integration Test",
    email: "test@example.local",
  },
  isAuthenticated: true,
  isLoading: false,
  getAccessToken: () => Promise.resolve("test-access-token"),
  login: () => Promise.resolve(),
};

/** The view state a freshly loaded screen starts in: page one, no filter, no form. */
const FRESH_VIEW = {
  page: TASK_PAGE.first,
  pageSize: TASK_PAGE.defaultSize,
  status: null,
  formTarget: null,
};

let sequence = 0;

/**
 * A Task, with everything a test does not care about filled in. The name and
 * the counter are the API harness's, because this is the same fixture written
 * for the other side of the wire.
 *
 * The id is a real UUID because `TaskSchema` parses one — a readable
 * `"task-1"` would fail at the client boundary rather than in the assertion,
 * which is a confusing way to learn that a fixture is wrong. `createdAt` walks
 * forward one second per call, so declaration order is also oldest-first and
 * the newest-first list below has something to order by.
 */
export function aTask(overrides: Partial<Task> = {}): Task {
  sequence += 1;
  const at = new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)).toISOString();

  return {
    id: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    title: `Task ${sequence}`,
    description: null,
    status: "PENDING",
    version: 1,
    createdAt: at,
    updatedAt: at,
    completedAt: null,
    ...overrides,
  };
}

/**
 * The API the screen talks to: the two endpoints the list needs, over a list of
 * Tasks that Mark Done actually moves.
 *
 * Stateful rather than a canned response per request, because the screen reads
 * the list twice — a mutation writes its answer into the cache and then
 * invalidates, and a fake that replayed the original page would hand the old
 * row straight back and make a passing assertion impossible to trust.
 *
 * `/start` and `/archive` are deliberately absent: no test presses them, and
 * MSW is configured to fail on a request it has no handler for, so the day one
 * does the gap says so rather than answering wrongly.
 */
export interface FakeTaskApi {
  handlers: RequestHandler[];
  /** Replaces what the API holds. Call it before each test. */
  reset: (tasks: Task[]) => void;
  /**
   * Finishes a Task without this browser knowing — a second tab, or the same
   * person on their phone. The next Mark Done against it is a Replay, which is
   * the one path that cannot be reached from the screen alone.
   */
  completeElsewhere: (id: string) => void;
}

export function fakeTaskApi(): FakeTaskApi {
  let tasks: Task[] = [];

  const url = (path: string) => `${config.apiUrl}${path}`;

  const find = (id: string) => tasks.find((task) => task.id === id);

  const store = (task: Task) => {
    tasks = tasks.map((stored) => (stored.id === task.id ? task : stored));
    return task;
  };

  /** A Task that has just been finished, timestamped the way the API does it. */
  const completed = (task: Task): Task => ({
    ...task,
    status: "DONE",
    version: task.version + 1,
    completedAt: new Date().toISOString(),
  });

  /** An error, in the envelope `ErrorResponseSchema` describes. */
  const refusal = (status: number, code: string, message: string) =>
    HttpResponse.json({ error: { code, message } }, { status });

  return {
    reset: (next) => {
      tasks = next.map((task) => ({ ...task }));
    },

    completeElsewhere: (id) => {
      const task = find(id);
      if (task) store(completed(task));
    },

    handlers: [
      http.get(url("/api/tasks"), ({ request }) => {
        const query = new URL(request.url).searchParams;
        const status = query.get("status");
        const page = Number(query.get("page") ?? TASK_PAGE.first);
        const pageSize = Number(query.get("pageSize") ?? TASK_PAGE.defaultSize);

        const matching = tasks.filter(
          (task) => status === null || task.status === status,
        );
        // Newest first, which is the ordering the real endpoint is fixed at
        // (PLAN.md §6). A fake that paged in insertion order would let an
        // ordering assertion pass against the wrong list.
        const ordered = [...matching].sort((a, b) =>
          b.createdAt.localeCompare(a.createdAt),
        );
        const from = (page - 1) * pageSize;

        const body: TaskPage = {
          items: ordered.slice(from, from + pageSize),
          page,
          pageSize,
          total: ordered.length,
        };

        return HttpResponse.json(body);
      }),

      // Mark Done is the one endpoint where arriving at a Task that is already
      // there is a success rather than a `409` (PLAN.md §8). The header is how
      // a client tells the two apart, and reproducing it is the whole point of
      // the Replay test.
      http.post<{ id: string }>(url("/api/tasks/:id/done"), ({ params }) => {
        const task = find(params.id);

        if (!task) return refusal(404, "NOT_FOUND", "Task not found");

        if (task.status === "DONE") {
          return HttpResponse.json(task, {
            headers: { "X-Idempotent-Replay": "true" },
          });
        }

        if (task.status !== "IN_PROGRESS") {
          return refusal(
            409,
            "INVALID_TRANSITION",
            `A ${task.status} task cannot become DONE`,
          );
        }

        return HttpResponse.json(store(completed(task)));
      }),
    ],
  };
}

/**
 * The task list, as a signed-in person arrives at it. The stores are put back
 * to their starting values first: both are module singletons, so a page number
 * or an open form left behind by the previous test would arrive as part of
 * this one's starting state.
 */
export function renderTaskList(): RenderResult {
  useSessionStore.setState(SESSION);
  useTaskListStore.setState(FRESH_VIEW);

  return render(
    <AntdProvider>
      <QueryProvider>
        <TaskListScreen />
      </QueryProvider>
    </AntdProvider>,
  );
}
