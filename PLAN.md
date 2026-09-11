# Task List — Implementation Plan

A task list with Auth0 authentication and task CRUD, built as a local monorepo:
a Next.js SPA frontend and an Express REST API, backed by Supabase Postgres.

Companion documents: `CONTEXT.md` (domain glossary), `docs/adr/0001` (backend
framework), `docs/adr/0002` (Mark-as-Done mechanism).

Budget: **24 hours**. Every decision below was taken with that in view; §18
carries a pre-committed cut list for when it runs short.

---

## 1. Scope

- Create task
- Edit task
- Delete task
- Mark task as Done — served by the Express API and executed by a Postgres
  custom resolver (see §14)
- List tasks with pagination, owner-scoped

---

## 2. Decisions and rationale

| Decision               | Choice                                  | Why                                                                                                                                                                                                                                |
| ---------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend framework      | Express + TypeScript                    | Satisfies "a TypeScript backend web framework" unambiguously; keeps the API a real service rather than a Next.js BFF, and makes the backend unit test natural. Full evaluation in ADR-0001                                         |
| Deployment             | **Local only**                          | A deliberate scope call: in 24 hours, hosting, DNS and env promotion are 2–4 hours that buy no requirement. No brief item asks for a live URL                                                                                      |
| Frontend rendering     | Next.js as a client-rendered SPA        | No SSR data fetching, no route handlers, no BFF. Keeps the REST boundary genuinely cross-process                                                                                                                                   |
| Styling                | Ant Design v6 only                      | One styling system. Tailwind is removed from the scaffold: antd's CSS-in-JS and Tailwind's preflight reset the same elements, and maintaining both earns nothing here                                                              |
| Database               | Supabase as plain Postgres, **RLS off** | Authorization enforced in the API layer, which leaves the Postgres function in §14 unconstrained                                                                                                                                   |
| Data access            | Drizzle ORM over `node-postgres`        | Real SQL semantics, real transactions, typed rows without hand-mapping, and `drizzle-kit` gives versioned `.sql` migrations. Rejected `supabase-js`: PostgREST DSL is a second query language and each call is its own transaction |
| Type contract          | Zod v4 in `packages/shared`             | Single source of truth for the wire shape, consumed by both apps                                                                                                                                                                   |
| Server state           | TanStack Query                          | Owns fetched rows, caching, invalidation, request deduplication                                                                                                                                                                    |
| Client state           | Zustand                                 | Owns session mirror and task-list view state — deliberately not the fetched rows                                                                                                                                                   |
| Mark-as-Done mechanism | Express endpoint + Postgres function    | The brief permits "Cloud Function **or** API web service, **or** a Custom Resolver". Full evaluation, including the rejected Supabase Edge Function, in ADR-0002                                                                   |
| Module system          | `apps/api` is **CommonJS**              | The brief mandates Jest. `ts-jest` on CJS is a four-line config; on ESM it needs `--experimental-vm-modules`, `extensionsToTreatAsEsm` and `.js` import suffixes                                                                   |
| Test runner            | **Jest**                                | Mandated by brief item 11. `ts-jest` in `apps/api`, `next/jest` in `apps/web`                                                                                                                                                      |

---

## 3. Repo layout

```
apps/web              Next.js 16 SPA
apps/api              Express + TypeScript REST API
packages/shared       Zod schemas, inferred types, status-transition rules
cypress/              The E2E spec and the Auth0 sign-in it needs
docs/adr/             Architecture decision records
docs/openapi.json     Generated from the Zod schemas — `npm run docs:api`
scripts/              setup-auth0.sh
README.md             Setup, the two evaluations, and the trades taken knowingly
CONTEXT.md            Domain glossary
```

npm workspaces. Both apps depend on `@insightt/shared`; neither depends on the
other. The root `package.json` is workspace declarations and orchestration
scripts only — it is not itself an app.

**Internal structure**, fixed now so naming is settled before hour one:

```
apps/api/src/     index.ts  app.ts  env.ts
                  db/{client,schema,migrate,seed}.ts
                  docs/    openapi     (the document, built from the schemas)
                           router      (serves it, and Swagger UI, in dev)
                           generate    (writes docs/openapi.json)
                  middleware/{auth,logging,validate,errors}.ts
                  tasks/   routes  mappers
                           repository            (the interface)
                           repository.drizzle    (Postgres)
                           repository.fake       (the test fake)
                  testing/harness.ts
                  types/express.d.ts

apps/web/src/     app/{layout,page}.tsx
                  config.ts
                  providers/{Auth0,Query,Antd}.tsx
                  components/auth/    RequireAuth  LandingPanel
                                      LoginButton  LogoutButton
                  components/tasks/   TaskListScreen  TaskTable
                                      TaskFormModal   TaskStatusTag
                                      TaskActions     TaskFilters
                  components/shared/  AppHeader  FullPageSpin
                                      ErrorState  EmptyState
                  api/{client,tasks}.ts
                  forms/zodFieldErrors.ts
                  hooks/{useTasks,useTaskMutations}.ts
                  stores/{session,taskList}.ts
                  testing/harness.tsx

packages/shared/  src/index.ts
                  src/schemas/{task,errors}.ts
                  src/rules/transitions.ts

cypress/          e2e/task-list.cy.ts
                  support/{e2e,commands,auth0}.ts
```

Components are grouped by the screen they belong to, with `shared/` for the
pieces both screens reach for. `hooks/`, `stores/`, `api/` and `forms/` stay
flat; there are five files between them and nesting would be ceremony.

`forms/zodFieldErrors.ts` is the §11 adapter between a Zod parse and Ant
Design's `Form`, and it is a folder of its own rather than a `components/`
neighbour because it renders nothing — the alternative is a per-field
`validator`, which is the shared rules written a second time for the browser.

`TaskListScreen` is a component rather than a function inside `page.tsx` for
the same reason `app.ts` is separate from `index.ts` on the backend: it is the
seam the §15 integration test hangs off. `page.tsx` is the route and the auth
gate; the screen behind it renders without Auth0, which under jsdom is the
difference between testing the task list and testing Universal Login.
`apps/web/src/testing/harness.tsx` is the frontend twin of
`apps/api/src/testing/harness.ts` — it builds that screen with the real
providers, the real stores and an in-memory API behind MSW.

`tasks/mappers.ts` is kept even though it looks like ceremony — it is the file
that makes §11's Drizzle-row-vs-wire-contract separation visible in ten seconds
rather than taken on faith.

`repository.ts` holds only the interface; the two implementations sit beside it
under suffixed names. Nothing above the interface imports either, which is what
lets `testing/harness.ts` build the whole app — real CORS, real logging, real
auth boundary, real error mapper — with no database behind it.

**`app.ts` is separate from `index.ts` on purpose.** `createApp(deps)` takes the
Task repository and the auth middleware as arguments; `index.ts` is the only
file that reads the environment, builds the real ones and listens. That split is
the seam the whole backend test suite hangs off — a test gets the real
middleware stack with no tenant, no network and no database behind it.

`apps/web/src/config.ts` is the frontend's equivalent boundary: the one place
`process.env.NEXT_PUBLIC_*` is read, validated loudly so a missing value fails
the build instead of becoming a redirect to `https://undefined/authorize`.

---

## 4. Stack

**Frontend** — Next.js 16.3, React 19.2, TypeScript strict, TanStack Query,
Zustand, **Ant Design v6**, `@auth0/auth0-react`.

**Backend** — Node + Express (CommonJS), TypeScript strict, Drizzle ORM,
`node-postgres`, `express-oauth2-jwt-bearer`, `cors`, Zod v4.

**Database** — Supabase Postgres, accessed over the Supavisor pooler in
session mode (direct connections are IPv6-first; session mode rather than
transaction mode because transaction mode does not support prepared statements).
The transaction-mode port is rejected in `env.ts` rather than described, because
it fails late and obscurely: the pool connects, early queries work, and a
prepared statement then errors somewhere that looks like a Drizzle bug.

**TLS.** The pooler presents a self-signed chain, so Node refuses it unless told
which root to trust. `DATABASE_CA_CERT` points at Supabase's certificate and
turns verification on; without it the connection is encrypted but not
authenticated. That is the weaker setting, and it is the default only because
the deployment target is local. It is written as two explicit branches in
`db/client.ts` so the trade stays visible, and the README names it alongside the
tokens-in-`localStorage` one.

Resolved install notes:

- **Ant Design v6 supports React 19 natively.** Do _not_ add
  `@ant-design/v5-patch-for-react-19`; it exists only for v5.
- **Zod v4 spellings**: `z.uuid()` and `z.iso.datetime()` are top-level,
  `z.strictObject` exists, `z.toJSONSchema()` is built in. v3 differs.
- **Style flash**: add `@ant-design/nextjs-registry` in `layout.tsx` (~10 lines).
  Next still prerenders client components at build time, so this is cheaper than
  disabling prerendering with `dynamic(..., { ssr: false })`.

**Workspace wiring**: `packages/shared` exports raw TypeScript
(`"exports": { ".": "./src/index.ts" }`) — no build step between packages.
`apps/web` consumes it via `transpilePackages: ['@insightt/shared']`;
`apps/api` runs on `tsx watch` in dev and resolves it in Jest via
`moduleNameMapper`.

**Scaffold cleanup**: move `app/`, `public/`, `next.config.ts`, `tsconfig.json`
and `eslint.config.mjs` into `apps/web/`. Delete `postcss.config.mjs`, the
`@import "tailwindcss"` / `@theme inline` block in `globals.css`, and the
`tailwindcss` + `@tailwindcss/postcss` dependencies. `next dev` will regenerate
its AGENTS.md block under `apps/web/` — commit that alongside the move.

---

## 5. Data model

```sql
create type task_status as enum ('PENDING', 'IN_PROGRESS', 'DONE', 'ARCHIVED');

create table tasks (
  id            uuid primary key default gen_random_uuid(),
  owner_id      text        not null,          -- Auth0 `sub` claim
  title         text        not null,
  description   text,
  status        task_status not null default 'PENDING',
  version       integer     not null default 1,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  completed_at  timestamptz
);

create index tasks_owner_status_idx on tasks (owner_id, status);

create function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger tasks_set_updated_at
  before update on tasks
  for each row execute function set_updated_at();
```

The trigger matters: without it `updated_at` reads as the creation time forever,
because nothing in the application ever assigns it. With it, `PATCH`, the
guarded transition updates and `mark_task_done()` all maintain it without any of
them remembering to.

Schema lives in `apps/api/src/db/schema.ts` (Drizzle `pgTable`, `pgEnum`);
migrations in `apps/api/drizzle/`. `drizzle-kit` diffs tables, not triggers or
functions, so those arrive as hand-written `--custom` migrations in the same
folder and the same journal — `0001_updated_at_trigger.sql` now, and
`mark_task_done()` with §14. Generated migrations must never be edited to carry
one, or the next `db:generate` will fight them.

The lifecycle is therefore written twice — `task_status` here, `TaskStatus` in
`@insightt/shared` — because neither can be derived from the other without
dragging the data layer into the frontend's import graph (§11). A drift test in
`db/schema.test.ts` holds the two spellings together.

**Ownership isolation.** Every query filters on `owner_id = <Actor's userId>`. A
user can only ever see their own tasks. A task belonging to someone else returns
`404`, never `403`, so existence is not leaked.

**Naming.** `owner_id` stores the Auth0 `sub` claim. Above the auth boundary the
value is called `userId` throughout — the raw claim is read exactly once, in the
auth middleware. `id` always means a Task's id. See `CONTEXT.md`.

---

## 6. API surface

JSON REST. All routes require a valid Auth0 access token.

| Method   | Path                     | Purpose                                         | Success                   |
| -------- | ------------------------ | ----------------------------------------------- | ------------------------- |
| `GET`    | `/api/tasks`             | Owner-scoped list; `page`, `pageSize`, `status` | `200` + `Paginated<Task>` |
| `GET`    | `/api/tasks/:id`         | Single task                                     | `200` + `Task` + `ETag`   |
| `POST`   | `/api/tasks`             | Create, always as `PENDING`                     | `201` + `Task`            |
| `PATCH`  | `/api/tasks/:id`         | Edit title/description; requires `If-Match`     | `200` + `Task`            |
| `POST`   | `/api/tasks/:id/start`   | `PENDING → IN_PROGRESS`                         | `200` + `Task`            |
| `POST`   | `/api/tasks/:id/done`    | `IN_PROGRESS → DONE`, idempotent                | `200` + `Task`            |
| `POST`   | `/api/tasks/:id/archive` | `DONE → ARCHIVED`                               | `200` + `Task`            |
| `DELETE` | `/api/tasks/:id`         | Delete, allowed from any status; no `If-Match`  | `204`                     |

State changes are dedicated endpoints rather than `PATCH { status }`, which
keeps the transition rules and the idempotent Done path explicit and leaves
`mark_task_done()` as the only entrance to `DONE`. The transition endpoints take
**no request body** — the target status is in the path, so there is nothing to
validate and nothing a client can contradict.

Every mutation except `DELETE` returns the full `Task`, because §12's optimistic
updates overwrite the cache from the response body so `version` self-corrects.
`DELETE` answers `204` with no body and no `ETag` — there is no Task left to
describe — and takes no `If-Match`: a Version protects an edit from overwriting
words someone else wrote, and a delete overwrites nothing. A second `DELETE` of
the same task is `404`, not a replay; the task is gone, so there is nothing to
report success about.

**Optimistic concurrency.** `GET /api/tasks/:id` and every mutation response
carry `ETag: "<version>"`. `PATCH` requires `If-Match`:

| Condition                                            | Response                      |
| ---------------------------------------------------- | ----------------------------- |
| `If-Match` absent                                    | `428` `PRECONDITION_REQUIRED` |
| `If-Match` stale                                     | `412` `VERSION_CONFLICT`      |
| `If-Match` unreadable as a version (`*`, a weak tag) | `412` `VERSION_CONFLICT`      |

`412` rather than `409` so the frontend can tell "someone else changed this" from
"that action isn't allowed here" without string-matching a message. An `If-Match`
that names no version this API could have issued is left to fail the comparison
rather than rejected separately: no task is at a version that cannot be written
down, so it can only ever be stale.

**`*` is a deliberate deviation from RFC 9110.** The standard defines
`If-Match: *` as matching any existing representation, which would make it a
success — an edit that says "whatever version it's on, write anyway". That is
precisely the clobbering this endpoint exists to refuse, and there is no client
of this API that wants it: the frontend always holds a real ETag. So `*` fails
the comparison like any other unreadable tag and is answered `412`. Anything
that needs an unconditional write can re-read the task and send the version it
gets back.

**A `PATCH` that would change nothing is refused**, as `422 VALIDATION_FAILED` —
both the empty body `{}`, which the shared schema's refinement catches, and a
body whose every field already holds the value it asks for, which needs the task
and so is checked in the route. The version is the record that a task changed;
raising it for a write that changed nothing would invalidate every other tab's
`If-Match` over an edit that never happened.

**Pagination.** Offset-based, since Ant Design's `Table` needs a total count.
The list query selects `count(*) over() as total` alongside the rows, so one
round trip returns both. `page` defaults to 1; `pageSize` defaults to 10 and
caps at 100; `status` is optional with **no default**, so the list shows every
status unless filtered. Ordering is fixed `created_at desc`, with `id desc`
breaking the tie — two tasks can share a `created_at` to the microsecond, and on
an ordering that is not total Postgres may return them in either order, so the
same row shows up on two pages or on none.

A page past the end is the one case the window function cannot answer: no rows
means no row to read `total` from, and `0` there would collapse the pager onto
page 1 and hide the tasks that are really present. That path — and only that
path — pays for a second `select count(*)`.

**Response envelope.** Lists return `{ items, page, pageSize, total }`.
Errors return `{ error: { code, message, details? } }`.

**Error codes**, frozen as a Zod enum in `packages/shared`:

| `code`                  | HTTP | Raised when                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UNAUTHENTICATED`       | 401  | missing, invalid or expired token                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `NOT_FOUND`             | 404  | no such task, or not owned by the Actor                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `VALIDATION_FAILED`     | 422  | payload fails Zod; `details` carries `error.issues`. Also covers a body `express.json` could not read at all — unparseable or over the size limit — reported as `422` rather than the parser's own `400`/`413` so this table stays the whole vocabulary, with the parser's reason in `details`. And a `PATCH` that would change nothing: the body passes Zod but asks for values the task already holds, so there is no field to blame and no `details` |
| `FIELD_NOT_EDITABLE`    | 422  | field not mutable in the task's current status                                                                                                                                                                                                                                                                                                                                                                                                          |
| `INVALID_TRANSITION`    | 409  | transition not permitted from the current status                                                                                                                                                                                                                                                                                                                                                                                                        |
| `VERSION_CONFLICT`      | 412  | `If-Match` present but stale                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `PRECONDITION_REQUIRED` | 428  | `PATCH` sent without `If-Match`                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `INTERNAL`              | 500  | anything unhandled                                                                                                                                                                                                                                                                                                                                                                                                                                      |

---

## 7. Task rules

**Status machine — strictly linear.**

```
PENDING → IN_PROGRESS → DONE → ARCHIVED
```

No skipping steps, no reverts, `ARCHIVED` is terminal. Every other transition
is rejected with `409 INVALID_TRANSITION`. The machine lives in
`packages/shared/src/rules/transitions.ts` so the frontend can disable
impossible actions using the same rules the API enforces. Because it is
strictly linear it is written as the lifecycle in order —
`TaskStatus.options`, not a second list — and the predicates read off that:
`canTransition(from, to)`, `nextStatus(status)`, `statusBefore(status)` (the
status a guarded `UPDATE` has to require), and `canEdit(status, field)` /
`canEditAnything(status)` for the whitelist below.

**Only the owner can mark a task DONE.** Satisfied structurally — tasks are
owner-scoped end to end, so a non-owner cannot address the task at all.

**Field mutability by status.** A documented whitelist; no typo-detection
heuristic, no similarity threshold. Anything outside it is
`422 FIELD_NOT_EDITABLE`. The whitelist needs the task, so `PATCH` reads it
before it writes — and **the version is checked against that read first, before
the whitelist or the no-op check**. Both of those answer questions about a
particular task, and the one just read is only the caller's task while the
version still matches: an edit written against a `PENDING` task that has since
gone `DONE` is a stale copy, not a closed field, and reporting it as
`FIELD_NOT_EDITABLE` would name a status the caller never saw. The guard in the
`UPDATE`'s own `WHERE` stays as well; the early check is what makes the refusals
honest, and the one in the statement is what makes the write safe.

| Status        | Edit title     | Edit description | Delete | Next transition |
| ------------- | -------------- | ---------------- | ------ | --------------- |
| `PENDING`     | yes            | yes              | yes    | `→ IN_PROGRESS` |
| `IN_PROGRESS` | yes            | yes              | yes    | `→ DONE`        |
| `DONE`        | yes (typo fix) | **no**           | yes    | `→ ARCHIVED`    |
| `ARCHIVED`    | **no**         | **no**           | yes    | terminal        |

Delete is unrestricted because the brief says "Delete Task" flat; inventing a
restriction it does not ask for would be a worse deviation than allowing it.
`ARCHIVED` is not hidden from the list — it is a status, not a soft delete.

---

## 8. Concurrency and idempotency

**Atomic transition.** Marking Done is a single conditional statement, so
Postgres row locking serializes concurrent callers with no application-level
locking:

```sql
update tasks
   set status = 'DONE', completed_at = now(), version = version + 1
 where id = p_task_id and owner_id = p_actor and status = 'IN_PROGRESS'
 returning *;
```

**Idempotency.** Zero rows affected means the caller needs to know _why_, and
that read belongs in the same transaction as the update — outside it, the
window another request can move the task through is a whole network round
trip, and a task that was `PENDING` at the update (correctly `409`) reads back
as `DONE` and is reported as a replay. `FOR UPDATE` on the re-read closes what
is left of that window that can be closed: a completion already in flight is
waited for rather than raced past. Under `READ COMMITTED` a completion that
committed just before the re-read is still reported as a replay, which is what
the task now is. So the branch logic lives inside the Postgres function, which
returns a discriminated outcome:

| Outcome                            | HTTP                                      |
| ---------------------------------- | ----------------------------------------- |
| `completed`                        | `200` + task                              |
| `replayed` (already `DONE`)        | `200` + task, `X-Idempotent-Replay: true` |
| `wrong_status`                     | `409 INVALID_TRANSITION`                  |
| `not_found` (missing or not owned) | `404 NOT_FOUND`                           |

Two simultaneous requests: one wins the row lock and completes the task, the
loser matches zero rows, observes `DONE`, and returns the identical `200`. No
double completion, no overwritten `completed_at`.

**Other transitions.** `/start` and `/archive` use a guarded Drizzle
`UPDATE ... WHERE id = ? AND owner_id = ? AND status = ?` — still atomic, no
function needed. `/done` is the one that needs the function, because it is the
one that must distinguish a replay from a rejection.

**Edit concurrency.** `PATCH` uses optimistic locking on `version` via
`If-Match`. A stale version returns `412` rather than silently clobbering.

---

## 9. Logging

Structured JSON to the console only (no audit table). One middleware, mounted
first, writing three lines per request:

- **Inbound** — the ISO timestamp the request was _received_, a request id
  (`crypto.randomUUID()`), `userId: null`, method, path, matched route, route
  params, query params, headers, body (truncated at ~1KB)
- **Actor** — the resolved `userId`, on the same request id, and only for a
  request that got past auth
- **Outbound** — status code, duration in ms, error class on failure
- **Redacted** — `authorization`, `cookie`, `set-cookie` → `[REDACTED]`

**Mounted first — above CORS, the body parser and auth.** The brief asks to log
_all_ api activities, with headers as input and status code as output. Every
middleware below can end a request on its own: `cors` answers a preflight
itself, `express.json` throws on a body it cannot read, and
`express-oauth2-jwt-bearer` rejects a bad token. Each of those is an api
activity, each has headers, and `401` is a status code — mounted any lower,
whole classes of request produce no line at all, and "send a bad token, check
the log" is the first thing a reviewer tries. An unauthenticated request logs
`userId: null`, which is information, not a gap.

**Written when the response closes**, the way `morgan` does it, rather than as
the request arrives. The fields that matter do not exist yet at arrival:
`req.body` is parsed by a later middleware, and Express fills `req.params` in
only once it has matched a route — a logger that writes on the way in can only
ever report an empty `params` and no body. The inbound line therefore carries
the time the request was _received_, not the time it was written, so the record
says when things happened even though the console does not. The hook is `close`
rather than `finish`, so a response the client abandoned is logged too, marked
`aborted`.

Emitting all three lines from one place is also what keeps them in order and on
one request id: the Actor is read off the request that `attachActor` stamped,
rather than logged by a second middleware that would otherwise race ahead of the
inbound line it belongs under.

---

## 10. Authentication — Auth0

- `@auth0/auth0-react` in the SPA: Authorization Code + PKCE, `audience` set to
  the API identifier, RS256, **Universal Login** (Auth0 hosts the login and
  signup screens; the app never sees a password and builds no credential form).
- `cacheLocation: 'localstorage'` with `useRefreshTokens: true` and rotation, so
  the session survives a page reload. The alternative — in-memory caching — puts
  the refresh token in memory too, so a reload falls back to hidden-iframe silent
  auth, which is blocked in Safari and Brave. Tokens in `localStorage` are
  XSS-reachable; that trade is made deliberately and noted in the README.
- Every API request carries `Authorization: Bearer <access token>`, fetched via
  `getAccessTokenSilently()` on **every** call (the SDK returns the cached token
  and refreshes only when needed, so it is cheap).
- A `401` response triggers `loginWithRedirect()`. No retry loop, no interceptor
  state machine.
- `express-oauth2-jwt-bearer` validates against the tenant JWKS. Unauthenticated
  requests are rejected before any handler runs.
- Actor identity throughout the backend is `Actor = { userId }`, read once from
  `req.auth.payload.sub`.

**Tenant setup** — three applications, one connection. `scripts/setup-auth0.sh`
walks it and writes the env files.

1. **API** — identifier becomes `AUTH0_AUDIENCE`, signing algorithm RS256.
2. **SPA application** — used by the browser. Callback, logout and web origin
   all `http://localhost:3000`.
3. **Regular Web Application** — used _only_ by Cypress. Advanced Settings →
   Grant Types → enable **Password**. Auth0 does not offer the Password grant on
   the SPA application type, so the E2E test cannot reuse the SPA client.
4. **Database connection** (`Username-Password-Authentication`) with one
   manually created test user. **All social connections disabled** — `sub` is
   connection-scoped, so the same human logging in via Google and via
   email/password would be two different Owners with two disjoint task lists,
   which reads as data loss.
5. Signups left **enabled** so a reviewer can register and click around.

**Callback handling.** The callback URL is `http://localhost:3000` itself; there
is no `/callback` route. `onRedirectCallback` calls `window.history.replaceState`
to strip `?code=` and `?state=`.

**CORS, not a proxy.** The apps are separate origins and there is no BFF, so
Express enables CORS directly — a dev proxy would only hide it while putting
Next back into the request path. Bearer tokens are the easy CORS case: no
cookies, so no `credentials: 'include'` and no `SameSite` concerns.

```ts
cors({
  origin: "http://localhost:3000",
  allowedHeaders: ["Authorization", "Content-Type", "If-Match"],
  exposedHeaders: ["X-Idempotent-Replay", "ETag"],
});
```

`exposedHeaders` matters twice over: neither `X-Idempotent-Replay` nor `ETag` is
CORS-safelisted, so without it the browser strips both — the frontend could
neither distinguish a replay from a fresh completion nor read the version it
needs for the next `If-Match`.

---

## 11. Shared contracts — Zod

`packages/shared` is the type authority for anything crossing the wire.
Nothing is hand-typed twice. Wire shapes are camelCase; timestamps are ISO
strings, not `Date`, so JSON round-trips are lossless and the same schema parses
on both sides.

```ts
export const TaskStatus = z.enum([
  "PENDING",
  "IN_PROGRESS",
  "DONE",
  "ARCHIVED",
]);

const title = z.string().trim().min(1, "Title is required").max(200);
const description = z
  .string()
  .trim()
  .max(2000)
  .transform((v) => (v === "" ? null : v))
  .nullable();

export const TaskSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  description: z.string().nullable(),
  status: TaskStatus,
  version: z.number().int(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
});

export const CreateTaskInput = z.strictObject({
  title,
  description: description.optional(), // omitted -> null
});

export const UpdateTaskInput = z
  .strictObject({
    title: title.optional(),
    description: description.optional(),
  })
  .refine((v) => v.title !== undefined || v.description !== undefined, {
    message: "An edit must change the title or the description",
  });

export const TASK_PAGE = { first: 1, defaultSize: 10, maxSize: 100 } as const;

export const TaskListQuery = z.object({
  page: z.coerce.number().int().min(TASK_PAGE.first).default(TASK_PAGE.first),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(TASK_PAGE.maxSize)
    .default(TASK_PAGE.defaultSize),
  status: TaskStatus.optional(),
});

export const TaskIdParam = z.object({ id: z.uuid() });

export const ErrorCode = z.enum([
  "UNAUTHENTICATED",
  "NOT_FOUND",
  "VALIDATION_FAILED",
  "FIELD_NOT_EDITABLE",
  "INVALID_TRANSITION",
  "VERSION_CONFLICT",
  "PRECONDITION_REQUIRED",
  "INTERNAL",
]);
```

Notes that carry weight:

- **`status` is absent from both input shapes.** A task is always created
  `PENDING` and only ever moves through the dedicated transition endpoints. If
  `status` were writable through `POST` or `PATCH`, a client could skip the
  state machine entirely and `mark_task_done()` would stop being the only
  entrance to `DONE` — which §8's idempotency guarantee depends on.
- **`.strictObject`** is what turns a stray `status` key into
  `422 VALIDATION_FAILED` rather than a silently ignored field.
- **`description` accepts explicit `null`** on update, because omitting the key
  means "leave it alone" — clearing a description needs a way to say so.
- **`TaskIdParam` parses the id as a UUID**, so a malformed id returns `404`
  instead of reaching Postgres and producing a `500`.
- **`z.coerce`** on the query params, because query strings arrive as strings.

Consumption:

- **Backend** — a `validate({ body, query, params })` middleware parses into
  `req.valid`, so handlers only ever receive validated, fully typed input. A
  malformed payload never reaches a handler. It returns the reader alongside the
  middleware — `validate({ query: TaskListQuery })` is the handler to mount and
  carries the `.read(req)` that types what it parsed — because `req.valid` has
  to be declared `unknown` globally and a second mention of the schema in the
  handler would be the same shape written twice. A failing `body` or `query` is
  `422`; a failing `params` is `404`, per `TaskIdParam` below.
- **Frontend** — the same schemas parse responses inside the TanStack Query
  `queryFn`, so a backend shape change surfaces as an error at the boundary
  instead of an `undefined` deep in a component.
- **Ant Design forms** — `Form` does not consume Zod natively. One helper,
  `forms/zodFieldErrors.ts`: `safeParse` on submit, map `error.issues` onto
  `form.setFields`. No per-field `validator` wiring. It returns the issues it
  could not place — `strictObject` refusing a stray key names no field — so the
  form shows those instead of appearing to ignore the submit.

**Two type layers, kept separate.** Drizzle also infers types from the table.
These are not the same thing and must not be collapsed:

- **Drizzle types** describe the DB row — snake_case columns, DB nullability.
  Internal to `apps/api`.
- **Zod types** describe the API contract. Shared with the frontend.
- `apps/api/src/tasks/mappers.ts` maps between them.

Do **not** use `drizzle-zod` for the shared schemas. It inverts the direction —
the public API shape becomes a projection of the table shape — and because it
emits runtime schemas, `packages/shared` would depend on the DB schema module,
dragging the database layer into the frontend's import graph.

**Not in `packages/shared`:** the user profile. `AuthUser = { userId, name,
email }` lives in `apps/web`, and `Actor = { userId }` in `apps/api`. Neither
crosses the wire — the API never returns a user, it only reads the token — and
keeping them out preserves the rule that everything in `shared` is a wire
contract.

---

## 12. State management — Zustand

Two stores, kept off TanStack Query's territory.

**`useSessionStore`** — mirrors Auth0: `user: AuthUser | null`,
`isAuthenticated`, `isLoading`, and a `getAccessToken` **function reference**
(not a token string — a cached string goes stale on silent refresh). This is the
real win: the API client reads the token from the store instead of needing
hooks, so the `fetch` wrapper stays a plain function.

**`useTaskListStore`** — the list's _view_ state: `page`, `pageSize`, `status`,
and `formTarget`, the Task the form is open on.

`formTarget` is one discriminated field — `{ mode: 'create' }`,
`{ mode: 'edit', taskId }`, or `null` — rather than a selection and an editing
flag, because creating and editing are the same modal being open and two fields
could disagree about what it is open on. The edit target is an **id**; the row
itself is looked up in the query cache, so the store never holds a Task.

**The fetched task array stays in TanStack Query, not in Zustand.** Query
already caches, invalidates and deduplicates it; duplicating it into a store
means two caches to reconcile on every mutation, and the replay-`200` path gets
materially harder. Instead the Zustand params _are_ the query key —
`['tasks', { page, pageSize, status }]` — so changing a filter refetches
automatically, with no effect watching the filter to ask for one: a different
filter is simply a key with nothing cached under it. Zustand owns "what the user
is looking at"; Query owns the rows.

Changing the filter resets `page` to 1. The page number counts into a result set
the filter has just replaced, and keeping it lands the person past the end of
the new one — which reads as a filter that matched nothing.

`['tasks']` itself is never fetched; it is the prefix the pages hang off, and
what every mutation invalidates. An optimistic write touches only the page on
screen — whether a Task also belongs on a page cached under another filter is a
question about counts and ordering that only the server can answer.

**Mutation policy.**

- Per-row mutations (`PATCH`, `/start`, `/done`, `/archive`) are
  **optimistic**: `onMutate` snapshots the cache, `onError` restores it, and
  `onSuccess` overwrites the row from the response body so `version`
  self-corrects and the next `If-Match` is never stale.
- **`DELETE` is optimistic too, but page-shaped rather than row-shaped.** The
  row is taken out and `total` lowered with it, so the pager cannot offer a page
  that is no longer there. There is no `onSuccess` correction: a `204` carries
  no body, and the row it would have corrected is gone. Snapshot, rollback and
  `onSettled` are the same, which is why the cache policy lives once in
  `useOptimisticPage` and the per-row mutations are one caller of it.
- **Create is not optimistic.** Under `created_at desc` pagination a new task's
  position is not knowable client-side and `total` cannot be adjusted correctly
  across pages, so create simply invalidates.
- `onSettled: invalidateQueries` on every mutation, so `total` reconciles.
- A `412 VERSION_CONFLICT` invalidates and raises a `notification.warning` —
  "this task changed elsewhere, refreshed" — rather than silently rolling back.
  Two browser tabs make the concurrency design visible.

---

## 13. Frontend structure

One route, `/`. Two screens: a logged-out landing panel and the task list.
`RequireAuth` picks between them — spinner while `isLoading`, then the landing
panel or the list. It does **not** fire `loginWithRedirect()` on its own: a
signed-out person who lands on the app should see what the app is and press a
button, not get bounced to a login screen they did not ask for.

- `Table` for the list, with server-driven pagination wired to `useTaskListStore`
- `Form` + `Modal` for create and edit
- `Tag` for status, `Popconfirm` for delete, `message` / `notification` for outcomes
- Action buttons are enabled/disabled by `canTransition()` and `canEdit()` from
  `packages/shared`, so the UI never offers an action the API will reject
- The Done mutation treats a replayed `200` as success, not an error

**UX states.** The evaluation criteria name "Loading indicators, proper UX", so
every moment is specified rather than left to the component defaults:

| Moment                    | Behaviour                                                                                                   |
| ------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Auth0 `isLoading`         | full-page `Spin`, no layout flash                                                                           |
| Unauthenticated           | `LandingPanel` with a single "Log in" button                                                                |
| List first load           | `Table loading={isPending}`                                                                                 |
| List page change          | `placeholderData: keepPreviousData` — the table dims instead of emptying                                    |
| Zero tasks                | `Empty` with a "Create your first task" CTA                                                                 |
| Zero tasks under a filter | `Empty` saying the Status has none, offering to clear the filter — the account is not empty, this Status is |
| Fetch error               | `Alert type="error"` with Retry wired to `refetch()`                                                        |
| Mutation in flight        | `loading` + `disabled` on the submitting button; `Popconfirm okButtonProps={{ loading }}`                   |
| Mutation outcome          | `message.success` / `message.error`                                                                         |
| `412 VERSION_CONFLICT`    | `notification.warning`, "this task changed elsewhere — refreshed"                                           |

Because per-row mutations are optimistic, their spinners are near-invisible; the
indicators that actually get seen are app boot, first load, page change and
create. Build them anyway.

---

## 14. Mark-as-Done mechanism

`POST /api/tasks/:id/done` — the Express API web service — delegates to
`mark_task_done(p_task_id uuid, p_actor text)`, a Postgres function, which is
the brief's **custom resolver** option. Between them the two satisfy both
options brief item 10 offers. Full evaluation in **ADR-0002**.

The function performs the conditional `UPDATE ... RETURNING` from §8 and, when it
affects zero rows, reads the row **within the same transaction** to determine
the outcome, returning a discriminated result the endpoint maps to a status
code. Called from Drizzle via:

```ts
db.execute(sql`select * from mark_task_done(${id}, ${actor.userId})`);
```

with the result Zod-parsed at the repository boundary, since `db.execute`
returns loosely typed rows. `COMMENT ON FUNCTION mark_task_done IS '...'`
documents the four outcomes where the next person will look for them.

The function is **not** `SECURITY DEFINER`. With RLS off and the API connecting
on a role that already owns `tasks`, that qualifier changes no behaviour; it
would be a phrase with nothing behind it.

---

## 15. Tests

Three, per brief item 11 — noting that "a backend unit test written with React
Testing Library" is not achievable, since RTL renders DOM components and cannot
exercise Express or Node code. Split accordingly, and the README says so, since
that is the reviewer's most likely objection.

**1. Backend and shared — Jest, no RTL** (`packages/shared`, `apps/api`, and the
non-rendering parts of `apps/web`)

Two kinds of test, and the split is worth stating plainly rather than filing
both under "unit".

_Genuinely unit_ — 89 of `apps/api`'s 273, called directly with no HTTP in
front of them, alongside all 70 in `packages/shared`: the transition validator
and the schemas there; and in `apps/api`, `repository.drizzle.ts` under a
stubbed `pg` pool — 51 cases asserting the SQL and the parameters it emits —
plus `tasks/mappers.ts`, `env.ts` and `docs/openapi.ts`.

Three drift checks sit in the same tier, each holding apart two spellings of one
rule that cannot be derived from each other: the Zod enum against the Postgres
one; the shared machine against the transition `mark_task_done`'s SQL hardcodes;
and the routes the generated document describes against the ones the Express
router actually serves. The second of those is deliberately written in two
languages — TypeScript for the pre-check and the UI, SQL for atomic enforcement
— so a test has to hold them together. The third is what stops a route being
added without a line of documentation, which is the one kind of drift
generating the document from the schemas cannot prevent on its own.

`apps/web` contributes to this tier as well as being the next one: the list's
view state and the query string it becomes are plain modules, and testing them
through a rendered table and a mock server would be three layers of machinery
to assert that changing a filter resets the page. They live beside the code
they test — `stores/taskList.test.ts` and `api/tasks.test.ts` — and run in the
same Jest project.

_Integration over HTTP_: every Task operation. **There is no `service.ts`** —
an earlier draft of this plan put one between the route and the repository, and
it was not built, because with the repository already an interface a service
layer would have been a second seam doing the first one's job. The operations
live in `tasks/routes.ts`, and `testing/harness.ts` enters them through the real
`createApp` with supertest. The repository is the seam (`repository.fake.ts`
behind the real interface) and the auth middleware is stubbed; everything
between is real — CORS, the body parser, validation, the error mapper. Each
legal Transition, each rejected one, the already-DONE Replay, the non-owner
`404` and the per-Status field whitelist are all asserted there — 163 of the
184 in this tier. The request logger belongs to it too:
`middleware/logging.test.ts` drives the logger through a real Express app,
because the `params` and `body` it records do not exist until a request has been
routed. So does `app.test.ts`, which covers what sits around the routes rather
than in them: the auth boundary, CORS, the body parser, and the `/api/docs`
mount that is present outside production and absent inside it.

Calling a handler directly instead would skip the parts most likely to be
wrong, which is the same argument §3 makes for `createApp(deps)` existing at
all. The cost is that the backend's domain rules have no unit test of their
own, and the README owns that argument — see §16 and brief item 11.

**Not covered anywhere**: `mark_task_done()` is never executed by an automated
test. `db/mark-task-done.test.ts` reads the migration as text and checks it
agrees with the TypeScript rule; no Jest test opens a Postgres connection, and
the Cypress spec is read-only. The atomicity ADR-0002 exists to justify is
therefore argued, not demonstrated. Closing it needs a containerised Postgres
running the migrations — out of the 24-hour budget, and named here rather than
left for a reviewer to notice.

**2. Frontend integration — Jest + React Testing Library + MSW** (`apps/web`)
`TaskListScreen` with the real providers behind it — the real Query cache, the
real Zustand stores, the real components — and MSW the only thing standing in.
It asserts the rows the API returned, that marking an `IN_PROGRESS` Task Done
re-renders it as Done, that a replayed `200` is handled as success rather than
surfaced as an error, and that every control a row's Status makes illegal is
rendered disabled.

Auth0 is left out rather than mocked. The test renders the screen rather than
the page, and seeds the session store with the same write `SessionMirror`
makes, so everything reading the store — the API client's token included —
behaves as it does signed in. What is left un-rendered is `AppHeader`, which
calls `useAuth0()` directly and so draws a blank name and an inert Logout
button: no assertion here concerns it, and a fake `Auth0Provider` would be
faking something the Task list itself never touches. Signing in for real is
test 3's job.

**3. E2E — Cypress** (`cypress/e2e/task-list.cy.ts`, one spec)
The login flow, using the Regular Web Application from §10 with
`grant_type: http://auth0.com/oauth/grant-type/password-realm` and an explicit
`realm`, which sidesteps the tenant's Default Directory setting entirely. The
token is written straight into the
`@@auth0spajs@@::<clientId>::<audience>::<scope>` localStorage key, so the app
boots already authenticated with no cross-origin redirect. The spec stays
**read-only** — log in, assert the list renders — so there is no teardown.
`cy.origin()` is the fallback if the Password grant cannot be enabled, and
`cypress/support/auth0.ts` documents what it would look like.

`<clientId>` there is the **SPA** client, not the one that minted the token:
Cypress mints with the Regular Web App because that is the client allowed the
grant, then stores the result under the key the browser app will look under.
The `azp` claim differs between the two, and nothing checks it — the API
validates signature, issuer and audience, all of which hold.

Two details the key alone does not cover, both in `seedSession`. `getUser()`
builds its lookup from the SDK's per-audience scope map, which has no entry for
this audience while the app names no scope of its own — so it arrives with no
scope to match on and never reaches the entry above, and the ID token has to be
written under `::@@user@@` as well. And `checkSession()` returns early unless
the `auth0.<clientId>.is.authenticated` cookie is set, which is why the seed
sets that too.

The spec cannot arrange the Tasks it asserts on, being read-only, so it asserts
the stronger thing instead: the rows on screen are matched against the page the
API just returned, row key by row key, and the pager against its total. That
holds on a seeded account and an empty one, and neither passes by accident.

`npm run test:e2e` is one command for the whole thing: `start-server-and-test`
boots `npm run dev`, waits for **both** :3000 and :4000, runs the spec and stops
them again. Waiting on the browser alone would race the API's own boot.

Config: `next/jest` in `apps/web` (`jest-fixed-jsdom`, with `jest.setup.ts`
supplying the `NEXT_PUBLIC_*` values `config.ts` reads at import time, so the
suite needs no real tenant), `ts-jest` (CJS preset) in `apps/api`, and
`ts-jest` in `packages/shared` with `module: commonjs` overridden for the test
run only — the package's own `tsconfig.json` targets the bundlers that consume
it, which means ESM, and ts-jest on ESM is the tarpit §2 avoids in `apps/api`.

**Known landmine, budget an hour** — and it cost roughly that. Two halves:

- MSW needs browser globals jsdom does not ship (`fetch`, `TextEncoder`,
  `TransformStream`, `BroadcastChannel`). `jest-fixed-jsdom` as the test
  environment supplies all four from Node's own implementations, which is fewer
  moving parts than hand-written polyfills and closer to a real browser.
- Several of MSW's dependencies publish ESM and nothing else. Jest loads
  `node_modules` as CommonJS without transforming it, so an `.mjs` with no CJS
  twin arrives as a syntax error naming the _test_ file — `jest.config.js` names
  those packages as exceptions to `transformIgnorePatterns`. Node's own
  `require(esm)` does not retire the list: Jest resolves `node_modules` through
  its own module registry rather than Node's `require`, so the interoperability
  Node gained never reaches the code under test.

Two smaller ones, both in `jest.setup.dom.ts`: antd calls `matchMedia`, which
jsdom leaves undefined, and `getComputedStyle` with a pseudo-element, which
jsdom throws "not implemented" for — only logged, so it buries a real error
under a hundred lines of stack rather than failing.

---

## 16. Local development

```bash
npm install                    # workspace install at the root
bash scripts/setup-auth0.sh    # one-time Auth0 tenant + env setup
npm run dev                    # Express on :4000, Next on :3000, concurrently
npm run db:generate            # drizzle-kit — generate a migration from schema.ts
npm run db:migrate             # apply migrations
npm run db:seed -- '<user id>' # demo Tasks under one Owner; 'replace' clears theirs
npm run test                   # unit + integration
npm run test:e2e               # Cypress
npm run docs:api               # z.toJSONSchema() -> docs/openapi.json
```

Environment:

| File                  | Variables                                                                                                                                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/.env`       | `DATABASE_URL` (Supavisor session-mode string), `DATABASE_CA_CERT` (optional), `AUTH0_DOMAIN`, `AUTH0_AUDIENCE`, `PORT`, `WEB_ORIGIN`, `NODE_ENV` (optional; anything but `production` mounts `/api/docs`) |
| `apps/web/.env.local` | `NEXT_PUBLIC_AUTH0_DOMAIN`, `NEXT_PUBLIC_AUTH0_CLIENT_ID`, `NEXT_PUBLIC_AUTH0_AUDIENCE`, `NEXT_PUBLIC_API_URL`                                                                                             |
| `cypress.env.json`    | `AUTH0_DOMAIN`, `AUTH0_AUDIENCE`, `AUTH0_REALM`, `AUTH0_SPA_CLIENT_ID`, `AUTH0_CYPRESS_CLIENT_ID`, `AUTH0_CYPRESS_CLIENT_SECRET`, `AUTH0_TEST_EMAIL`, `AUTH0_TEST_PASSWORD`                                |

A fourth, `.env` at the root, is the wizard's own record of what was answered so
a re-run can offer the previous values as defaults; nothing reads it at runtime.
All four are gitignored. `.env.example` files ship with the repo for the two the
apps read, and the README documents the setup path; the deployment target is
local, so whoever reviews this runs it themselves.

**Documentation deliverables:**

- **README** — setup, env vars, the item 3 and item 10 evaluations (linking to
  the ADRs), the concurrency design, the tokens-in-`localStorage` and
  unverified-TLS trades (§4), and the
  reading of "a backend unit test written with React Testing Library".
- **TSDoc** on `packages/shared` exports, the repository layer, and the three
  middlewares. Not on every React component, where it reads as padding.
- **Inline comments** explain _why_ only.
- **`docs/openapi.json`**, generated from the same Zod schemas that validate
  requests, so it cannot drift. `docs/openapi.ts` builds the document with
  `z.toJSONSchema()`; `npm run docs:api` writes the file, and the running API
  serves the same document at `/api/docs/openapi.json` with Swagger UI over it
  at `/api/docs` — **dev only**, because it has to sit outside the auth stack
  (a browser loading a page carries no Authorization header), and `NODE_ENV`
  is what turns it off.

  Generating it settles the schemas but neither the routes nor the file, so
  `docs/openapi.test.ts` closes both: it reads the operations off the real
  Express router and asserts the document describes exactly those, and it
  compares the document against the checked-in JSON. Adding a route without
  documenting it fails a test, and so does forgetting to regenerate.

  A Husky pre-commit hook catches the stale file at the moment it would enter
  history rather than at the next test run: it regenerates and refuses the
  commit if that changed anything.

- **A pre-commit hook**, running lint-staged (Prettier over the staged files),
  the staleness check above, `typecheck` and the full Jest suite — cheapest
  first, so the twenty-second one only runs on a commit that has passed the
  rest. `.prettierrc` carries two keys rather than none because Prettier
  searches _upward_ out of the repo: without a local config it adopts whatever
  it finds in an ancestor directory, which on one machine here meant
  single-quoting the entire codebase.

---

## 17. Requirements traceability

| Requirement                                                     | Where satisfied                               |
| --------------------------------------------------------------- | --------------------------------------------- |
| Task CRUD                                                       | §6                                            |
| Mark as Done via cloud function / web service / custom resolver | §14, ADR-0002 — web service + custom resolver |
| Evaluate Express vs Next BFF                                    | ADR-0001                                      |
| Next.js + TypeScript + TanStack Query frontend                  | §4, §13                                       |
| TypeScript backend framework                                    | §4 — Express                                  |
| JSON REST between frontend and backend                          | §6                                            |
| Authentication provider                                         | §10 — Auth0                                   |
| Authenticated frontend↔backend communication                    | §10 — Bearer token validated on every route   |
| Cloud database                                                  | §5 — Supabase Postgres                        |
| Validation and consistency on create/edit                       | §11 validation, §8 optimistic locking         |
| Status machine, invalid transitions rejected                    | §7                                            |
| Only owner can mark DONE                                        | §5, §7                                        |
| DONE not editable except title                                  | §7                                            |
| No double-DONE, concurrent-safe, idempotent                     | §8                                            |
| API activity logging with actor + timestamp                     | §9                                            |
| Component library                                               | §4, §13 — Ant Design v6                       |
| Two-plus automated tests                                        | §15 — three                                   |

Evaluation criteria:

| Criterion                                      | Where satisfied                       |
| ---------------------------------------------- | ------------------------------------- |
| Functionality                                  | §1, §6, traceability above            |
| Code structure, naming and organization        | §3, §11 two type layers, `CONTEXT.md` |
| Data validation                                | §11                                   |
| User experience: loading indicators, proper UX | §13 UX states                         |
| Code documentation                             | §16 documentation deliverables        |
| Tests                                          | §15                                   |

---

## 18. Build order

1. Workspace scaffold — npm workspaces, TS configs, move the Next app into
   `apps/web`, strip Tailwind, `packages/shared` skeleton
2. Zod schemas and the transition rules, with their unit tests (test 1)
3. Auth0 tenant via `scripts/setup-auth0.sh`
4. Drizzle schema, migration, `set_updated_at()` trigger, `mark_task_done()`
5. Express: logging middleware, auth middleware, actor stamp, validation
   middleware, error mapper, CORS
6. Task routes, repository layer, mappers, and the Done endpoint
7. Auth0 SPA wiring, Zustand session store, typed API client
8. Task list, forms, and the UX states in Ant Design with TanStack Query
9. Integration test (test 2), then Cypress login (test 3)
10. README, ADR polish, `npm run docs:api`

**Cut list, pre-committed.** If hour 20 arrives with the UI half-done, drop in
this order and stop when back on schedule:

1. Server-side pagination — ship a fixed `created_at desc` list, let antd
   `Table` paginate client-side
2. The status filter UI — keep the API param, hardcode the default
3. `docs/openapi.json` and Swagger UI

**Tests are never cut.** Item 11 is the most mechanically checkable requirement
in the brief; a reviewer diffing against it notices a missing Cypress spec faster
than a missing filter.

In the event nothing was cut: server-side pagination, the status filter and the
generated description all shipped. The list stands as a record of what the
budget was prepared to lose, not of what it lost.
