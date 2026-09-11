import type { LogRecord } from "@/middleware/logging";
import { createPrettyLogSink } from "@/middleware/logging.pretty";

function harness(width = 100) {
  const lines: string[] = [];
  const sink = createPrettyLogSink({
    write: (line) => lines.push(line),
    colour: false,
    width,
  });

  return { sink, lines, output: () => lines.join("\n") };
}

const REQUEST_ID = "req-1";

function inbound(fields: Partial<LogRecord> = {}): LogRecord {
  return {
    ts: "2026-09-11T14:23:01.482Z",
    requestId: REQUEST_ID,
    direction: "inbound",
    userId: null,
    method: "GET",
    path: "/api/tasks?page=1",
    route: "/",
    params: {},
    query: { page: "1" },
    headers: {
      authorization: "[REDACTED]",
      "content-type": "application/json",
    },
    ...fields,
  };
}

function actor(fields: Partial<LogRecord> = {}): LogRecord {
  return {
    ts: "2026-09-11T14:23:01.490Z",
    requestId: REQUEST_ID,
    direction: "actor",
    userId: "auth0|68f0ab",
    ...fields,
  };
}

function outbound(fields: Partial<LogRecord> = {}): LogRecord {
  return {
    ts: "2026-09-11T14:23:01.494Z",
    requestId: REQUEST_ID,
    direction: "outbound",
    status: 200,
    durationMs: 12.42,
    ...fields,
  };
}

describe("createPrettyLogSink", () => {
  it("summarises the request on one line", () => {
    const { sink, lines } = harness();

    sink(inbound());
    sink(actor());
    sink(outbound());

    expect(lines[0]).toContain("GET");
    expect(lines[0]).toContain("/api/tasks?page=1");
    expect(lines[0]).toContain("200");
    expect(lines[0]).toContain("12.4ms");
  });

  it("prints the actor, the parameters, the headers and the body under it", () => {
    // Everything the JSON record carries reaches the screen; only its shape
    // changes.
    const { sink, output } = harness();

    sink(
      inbound({
        method: "PATCH",
        path: "/api/tasks/t-1",
        params: { id: "t-1" },
        headers: { authorization: "[REDACTED]", "if-match": "3" },
        body: { title: "Buy milk" },
      }),
    );
    sink(actor());
    sink(outbound({ status: 204 }));

    expect(output()).toContain("actor    auth0|68f0ab");
    expect(output()).toContain("params   id=t-1");
    expect(output()).toContain("query    page=1");
    expect(output()).toContain("authorization=[REDACTED]");
    expect(output()).toContain("if-match=3");
    expect(output()).toContain("body     title=Buy milk");
  });

  it("prints what went back, apart from what came in", () => {
    // Two bodies a line from each other, so the labels have to tell them apart.
    const { sink, output } = harness();

    sink(
      inbound({
        method: "POST",
        path: "/api/tasks",
        body: { title: "Buy milk" },
      }),
    );
    sink(actor());
    sink(
      outbound({
        status: 201,
        body: { id: "t-1", title: "Buy milk", status: "PENDING", version: 1 },
      }),
    );

    expect(output()).toContain("body     title=Buy milk");
    expect(output()).toContain("response id=t-1");
    expect(output()).toContain("status=PENDING");
  });

  it("says the actor was absent rather than omitting the line", () => {
    // A request that never got past auth is exactly when the line matters.
    const { sink, output } = harness();

    sink(inbound());
    sink(outbound({ status: 401, error: "UnauthorizedError" }));

    expect(output()).toContain("actor    -");
  });

  it("leaves out a field that holds nothing", () => {
    // `params   {}` under every request without route parameters is a row of
    // noise, and most requests do not have them.
    const { sink, output } = harness();

    sink(inbound({ params: {}, query: {}, headers: {}, body: undefined }));
    sink(outbound());

    expect(output()).not.toContain("params");
    expect(output()).not.toContain("query");
    expect(output()).not.toContain("body");
  });

  it("wraps a long field under its first value, not under its label", () => {
    const { sink, lines } = harness(60);

    sink(
      inbound({
        headers: {
          host: "localhost:4000",
          "user-agent": "Mozilla/5.0",
          accept: "application/json",
          "accept-encoding": "gzip, deflate, br",
        },
      }),
    );
    sink(outbound());

    const wrapped = lines.filter((line) => line.includes("accept-encoding"));
    expect(wrapped).toHaveLength(1);
    expect(wrapped[0]).not.toContain("headers");
    // No detail line reaches the terminal's own wrap, which would cost the
    // column the block is read down. The summary line is its own, wider row.
    const detail = lines.filter((line) => line.startsWith(" "));
    expect(detail.every((line) => line.length <= 60)).toBe(true);
  });

  it("keeps concurrent requests apart", () => {
    const { sink, lines } = harness();

    sink(inbound({ requestId: "a", method: "POST", path: "/api/tasks" }));
    sink(inbound({ requestId: "b", method: "DELETE", path: "/api/tasks/1" }));
    sink(actor({ requestId: "b", userId: "auth0|second" }));
    sink(outbound({ requestId: "b", status: 204 }));
    sink(outbound({ requestId: "a", status: 201 }));

    const first = lines.findIndex((line) => line.includes("DELETE"));
    const second = lines.findIndex((line) => line.includes("POST"));
    expect(first).toBeLessThan(second);
    expect(lines.slice(first, second).join("\n")).toContain("auth0|second");
    expect(lines.slice(second).join("\n")).toContain("actor    -");
  });

  it("names an abandoned response rather than inventing a status for it", () => {
    const { sink, lines } = harness();

    sink(inbound());
    sink(outbound({ status: null, aborted: true }));

    expect(lines[0]).toContain("---");
    expect(lines[0]).toContain("aborted");
  });

  it("prints the stack of a 5xx under its line", () => {
    // A status code does not say what broke, and this is the only place the
    // stack was ever written.
    const { sink, output } = harness();

    sink(inbound());
    sink({
      ts: "2026-09-11T14:23:01.493Z",
      requestId: REQUEST_ID,
      direction: "error",
      error: "TypeError: boom\n    at handler",
    });
    sink(outbound({ status: 500, error: "TypeError" }));

    expect(output()).toContain("500");
    expect(output()).toContain("TypeError: boom");
  });

  it("prints the startup line, so a booted server is not a silent one", () => {
    const { sink, lines } = harness();

    sink({
      ts: "2026-09-11T14:23:00.000Z",
      requestId: null,
      direction: "startup",
      message: "@insightt/api listening on http://localhost:4000",
    });

    expect(lines[0]).toContain("listening on http://localhost:4000");
  });

  it("colours the status when asked to, and not otherwise", () => {
    const coloured: string[] = [];
    const sink = createPrettyLogSink({
      write: (line) => coloured.push(line),
      colour: true,
    });

    sink(inbound());
    sink(outbound({ status: 404 }));

    const escape = String.fromCharCode(27);
    expect(coloured[0]).toContain(`${escape}[33m404`);
  });
});
