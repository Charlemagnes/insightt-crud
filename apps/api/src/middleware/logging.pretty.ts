import type { LogRecord, LogSink } from "@/middleware/logging";

/**
 * A console sink for a human watching `npm run dev`.
 *
 * The records themselves are unchanged: `consoleLogSink` still writes the
 * structured JSON PLAN.md §9 specifies, and production still uses it. This is a
 * *presentation* of the same records, and it exists because three JSON lines
 * per request — one of them carrying every header on one unbroken line — are
 * unreadable at the speed a demo moves.
 *
 * Nothing is dropped. One request prints as one block: a summary line, then the
 * fields that have something in them, each on a labelled line of its own.
 *
 * ```
 * 14:23:03.004  200  POST    /api/tasks/9f2c.../done    3.00s
 *               actor    auth0|68f0ab8c9d
 *               params   id=9f2c1e84-...
 *               query    page=1  pageSize=5
 *               headers  authorization=[REDACTED]  content-type=application/json
 *                        if-match=3  host=localhost:4000
 *               body     title=Buy milk  description=null
 *               response id=9f2c1e84-...  status=DONE  version=4
 * ```
 *
 * The method and path live on the inbound record, the Actor on a second and the
 * status on a third, so the sink holds the first two until the outbound one
 * arrives, keyed by the request id that stitches them together. All three are
 * emitted from a single `close` handler in `createRequestLogging`, so that wait
 * is a few statements long rather than a real buffer.
 *
 * An empty `params` or `query` prints no line at all: a label with `{}` after it
 * is a row of noise on every request that has no route parameters, which is
 * most of them.
 */
export interface PrettyLogOptions {
  /** Where a finished line goes. Injected so a test can read it back. */
  write?: (line: string) => void;
  /** ANSI colour, unless the environment asks for none. */
  colour?: boolean;
  /** Where detail lines wrap. The terminal's width, when it admits to one. */
  width?: number;
}

/** Everything the inbound and actor records carry, held until the outbound one. */
interface PendingRequest {
  method: string;
  path: string;
  params: unknown;
  query: unknown;
  headers: unknown;
  body: unknown;
  userId?: string;
  stack?: string;
}

/** Wide enough for `/api/tasks/<uuid>/done`, the longest path the API serves. */
const PATH_COLUMN = 52;

/** Detail lines hang under the summary's status, clear of the timestamp. */
const INDENT = " ".repeat(14);

/** `response` is the longest label, and every value starts past it. */
const LABEL_COLUMN = 9;

/** When the terminal will not say how wide it is. `concurrently` never does. */
const DEFAULT_WIDTH = 100;

export function createPrettyLogSink({
  write = (line) => console.log(line),
  colour = !process.env.NO_COLOR,
  width = process.stdout.columns || DEFAULT_WIDTH,
}: PrettyLogOptions = {}): LogSink {
  const pending = new Map<string, PendingRequest>();
  const paint = colour ? ansi : plain;

  return (record) => {
    const id = record.requestId;

    switch (record.direction) {
      // The one line that is not a request. Without it nothing says the server
      // came up, and a silent terminal reads as a failed start.
      case "startup":
        write(`${paint.dim(time(record.ts))}  ${paint.dim(startup(record))}`);
        return;

      case "inbound":
        if (id) {
          pending.set(id, {
            method: String(record.method ?? "-"),
            path: String(record.path ?? "-"),
            params: record.params,
            query: record.query,
            headers: record.headers,
            body: record.body,
          });
        }
        return;

      case "actor": {
        const request = id ? pending.get(id) : undefined;
        if (request) request.userId = String(record.userId);
        return;
      }

      case "error": {
        const request = id ? pending.get(id) : undefined;
        if (request && typeof record.error === "string") {
          request.stack = record.error;
        }
        return;
      }

      case "outbound": {
        const request = id ? pending.get(id) : undefined;
        if (id) pending.delete(id);

        write(summary(record, request, paint));
        for (const line of details(record, request, paint, width)) write(line);
        return;
      }
    }
  };
}

function summary(
  record: LogRecord,
  request: PendingRequest | undefined,
  paint: Paint,
): string {
  const status = typeof record.status === "number" ? record.status : null;

  const parts = [
    paint.dim(time(record.ts)),
    statusText(status, paint),
    paint.bold((request?.method ?? "-").padEnd(6)),
    // Padded, not truncated: a longer path pushes the duration right rather
    // than losing the id at the end of it, which is the part being read.
    (request?.path ?? "-").padEnd(PATH_COLUMN),
    paint.dim(duration(record.durationMs)),
  ];

  // The client hung up before the response finished, so there is no status to
  // report. Saying so beats printing one it never saw.
  if (record.aborted) parts.push(paint.magenta("aborted"));
  if (typeof record.error === "string") parts.push(paint.yellow(record.error));

  return parts.join("  ");
}

function details(
  record: LogRecord,
  request: PendingRequest | undefined,
  paint: Paint,
  width: number,
): string[] {
  if (!request) return [];

  const lines = [
    // Absent is information: it says the request never got past auth.
    ...labelled("actor", [request.userId ?? "-"], paint, width),
    ...labelled("params", pairs(request.params), paint, width),
    ...labelled("query", pairs(request.query), paint, width),
    ...labelled("headers", pairs(request.headers), paint, width),
    ...labelled("body", pairs(request.body), paint, width),
    // The outbound record's own body — what went back. Labelled apart from the
    // request's, because the two are a line from each other on screen.
    ...labelled("response", pairs(record.body), paint, width),
  ];

  // Only ever set for a 5xx: `createErrorHandler` logs no other stack.
  if (request.stack) lines.push(paint.red(indent(request.stack)));

  return lines;
}

/**
 * One `label  a=1  b=2` line, wrapped at the terminal's width with the
 * continuation lines starting under the first value rather than under the
 * label, so a long header list still reads as one field.
 */
function labelled(
  label: string,
  values: string[],
  paint: Paint,
  width: number,
): string[] {
  if (values.length === 0) return [];

  const gutter = INDENT + " ".repeat(LABEL_COLUMN);
  const room = Math.max(width - gutter.length, 20);
  const lines: string[] = [];
  let current = "";

  for (const value of values) {
    // A single value wider than the terminal wraps in the terminal instead,
    // which costs the column the rest of the block is read down.
    const fitted =
      value.length <= room ? value : `${value.slice(0, room - 3)}...`;
    const candidate = current ? `${current}  ${fitted}` : fitted;
    if (current && candidate.length > room) {
      lines.push(current);
      current = fitted;
    } else {
      current = candidate;
    }
  }
  lines.push(current);

  return lines.map((line, index) =>
    index === 0
      ? `${INDENT}${paint.dim(label.padEnd(LABEL_COLUMN))}${line}`
      : `${gutter}${line}`,
  );
}

/** Roughly a screen's worth: past it a header is filler, not information. */
const VALUE_LIMIT = 80;

/**
 * A record's field as `name=value` pairs. A plain object is its own entries; a
 * body that arrived as a string — the truncated form the JSON record uses —
 * is one value with no name.
 */
function pairs(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (typeof value !== "object") return [truncate(String(value))];
  if (Array.isArray(value)) return value.map((item) => truncate(render(item)));

  return Object.entries(value).map(
    ([name, field]) => `${name}=${truncate(render(field))}`,
  );
}

function render(value: unknown): string {
  if (typeof value === "string") return value;
  // An array of header values, a nested body object — anything that is not a
  // string reads better as JSON than as `[object Object]`.
  return JSON.stringify(value) ?? String(value);
}

function truncate(value: string): string {
  return value.length <= VALUE_LIMIT
    ? value
    : `${value.slice(0, VALUE_LIMIT)}...`;
}

/** `2026-09-11T14:23:01.482Z` to `14:23:01.482`, in the reader's own timezone. */
function time(ts: unknown): string {
  const at = typeof ts === "string" ? new Date(ts) : new Date(NaN);
  if (Number.isNaN(at.getTime())) return "--:--:--.---";

  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  return (
    `${pad(at.getHours())}:${pad(at.getMinutes())}:` +
    `${pad(at.getSeconds())}.${pad(at.getMilliseconds(), 3)}`
  );
}

/** Right-aligned, so the durations form a column the eye can run down. */
function duration(ms: unknown): string {
  if (typeof ms !== "number") return "";
  const text = ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms.toFixed(1)}ms`;
  return text.padStart(8);
}

function statusText(status: number | null, paint: Paint): string {
  if (status === null) return paint.magenta("---");
  const text = String(status);
  if (status >= 500) return paint.red(text);
  if (status >= 400) return paint.yellow(text);
  if (status >= 300) return paint.cyan(text);
  return paint.green(text);
}

function startup(record: LogRecord): string {
  return typeof record.message === "string" ? record.message : "started";
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((row) => `${INDENT}${row}`)
    .join("\n");
}

type Paint = Record<
  "dim" | "bold" | "red" | "yellow" | "green" | "cyan" | "magenta",
  (text: string) => string
>;

const CODES = {
  dim: "2",
  bold: "1",
  red: "31",
  yellow: "33",
  green: "32",
  cyan: "36",
  magenta: "35",
} as const;

/** Built rather than written, so no raw control character sits in the source. */
const ESC = `${String.fromCharCode(27)}[`;

const ansi = Object.fromEntries(
  Object.entries(CODES).map(([name, code]) => [
    name,
    (text: string) => `${ESC}${code}m${text}${ESC}0m`,
  ]),
) as Paint;

const plain = Object.fromEntries(
  Object.keys(CODES).map((name) => [name, (text: string) => text]),
) as Paint;
