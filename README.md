# Task List

An authenticated task tracker: sign in through Auth0, create Tasks only you can
see, and move each one through a fixed forward-only lifecycle —
`PENDING → IN_PROGRESS → DONE → ARCHIVED`.

Three workspaces in one npm monorepo:

| Workspace         | What it is                                                              |
| ----------------- | ----------------------------------------------------------------------- |
| `apps/web`        | Next.js 16 SPA — React 19, Ant Design v6, TanStack Query, Zustand       |
| `apps/api`        | Express 5 REST API — TypeScript, Drizzle, Supabase Postgres             |
| `packages/shared` | `@insightt/shared` — the Zod schemas and Status rules both sides import |

Both apps depend on `packages/shared`; neither depends on the other.

**Where to read next.** [`PLAN.md`](PLAN.md) is the implementation plan and
carries the rationale for every decision below in full.
[`CONTEXT.md`](CONTEXT.md) is the domain glossary — it is the vocabulary this
README and the code both use. [`docs/adr/`](docs/adr) holds the two decisions
the brief asks to be justified explicitly.

---

## Running it

**You will need**: Node 20 or newer, an [Auth0](https://auth0.com) tenant (free
is fine) and a [Supabase](https://supabase.com) project (likewise). Both are
created during setup; nothing else needs installing.

```bash
npm install                  # workspace install, from the root
bash scripts/setup-auth0.sh  # one-time: walks the Auth0 and Supabase setup
npm run db:migrate           # create the table, the trigger and the function
npm run dev                  # Express on :4000, Next on :3000
```

Then open <http://localhost:3000> and press **Sign up** on the landing screen.
It is the same Auth0 redirect "Log in" makes, aimed at the signup screen rather
than the login one; signups are left enabled on the tenant so a reviewer can
register and click around.

`scripts/setup-auth0.sh` is an interactive wizard, not a script that runs
unattended. It walks the parts of the Auth0 dashboard only a human can click,
asks for each value it cannot read, writes every env file below, and then
verifies the result by minting a real token against the tenant. It covers the
Supabase connection string too, despite the name.

To see a populated list without creating Tasks by hand:

```bash
npm run db:seed -- 'auth0|68c0…'          # the User ID to own them
npm run db:seed -- 'auth0|68c0…' replace  # clear that Owner's Tasks first
```

The User ID is whatever Auth0 assigned you. The API writes it on the `actor`
log line the first time you load the app, so it is one `npm run dev` pane
away.

### Environment

Every file below is gitignored, and `setup-auth0.sh` writes all of them.
`.env.example` files ship with the repo for the two the apps read.

| File                  | Variables                                                                                                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/.env`       | `DATABASE_URL` (Supavisor **session-mode** string), `DATABASE_CA_CERT` (optional), `AUTH0_DOMAIN`, `AUTH0_AUDIENCE`, `PORT`, `WEB_ORIGIN`, `NODE_ENV` (optional)            |
| `apps/web/.env.local` | `NEXT_PUBLIC_AUTH0_DOMAIN`, `NEXT_PUBLIC_AUTH0_CLIENT_ID`, `NEXT_PUBLIC_AUTH0_AUDIENCE`, `NEXT_PUBLIC_API_URL`                                                              |
| `cypress.env.json`    | `AUTH0_DOMAIN`, `AUTH0_AUDIENCE`, `AUTH0_REALM`, `AUTH0_SPA_CLIENT_ID`, `AUTH0_CYPRESS_CLIENT_ID`, `AUTH0_CYPRESS_CLIENT_SECRET`, `AUTH0_TEST_EMAIL`, `AUTH0_TEST_PASSWORD` |
| `.env` (root)         | The wizard's own record of what you answered, so a re-run can offer your previous values as defaults. Nothing reads it at runtime.                                          |

Two spellings are worth singling out, because both fail late and obscurely:

- **`DATABASE_URL` must be the session pooler on `:5432`**, not the transaction
  pooler on `:6543` and not the direct connection. Transaction mode has no
  prepared statements, which Drizzle and `node-postgres` both rely on; the
  direct host is IPv6-first and many networks cannot reach it. `env.ts` checks
  the port rather than trusting the comment, because otherwise the pool
  connects, the first queries work, and a prepared statement then fails
  somewhere that looks like a Drizzle bug.
- **Two Auth0 client ids, and each is named for its client.** The browser uses
  the SPA application; Cypress uses a Regular Web Application, because Auth0
  does not offer the Password grant on SPA clients.

### The pre-commit hook

`npm install` installs a Husky hook that runs four things, cheapest first:

1. **Prettier** over the staged files, via lint-staged, which re-stages what it
   changed. Formatting is fixed rather than reported.
2. **`npm run docs:api`**, refusing the commit if `docs/openapi.json` was
   stale. It refuses rather than staging the file itself, so a commit stays
   what you staged.
3. **`npm run typecheck`** across every workspace.
4. **`npm run test`** — the whole Jest suite, around twenty seconds.

`git commit --no-verify` skips all four.

Prettier's config is two keys, and one of them is only there to anchor the
config search: Prettier walks _up_ out of the repo looking for a `.prettierrc`,
so without a local one it can pick up a stray config from somewhere above the
checkout and reformat the whole repo to a style nobody here chose. Generated
files — `docs/openapi.json`, the drizzle snapshots, the lockfile — are in
`.prettierignore`, since formatting them would fight whatever writes them.

### Commands

```bash
npm run dev        # both servers, concurrently
npm run format     # prettier --write over the repo
npm run build      # production build; type-checks every workspace first
npm run typecheck  # the same check plus cypress/, which is not a workspace
npm run lint
npm run test       # Jest, per workspace
npm run test:e2e   # Cypress — boots both dev servers, runs the spec, stops them
npm run docs:api   # regenerate docs/openapi.json from the Zod schemas
npm run db:generate  # drizzle-kit — a migration from schema.ts
npm run db:migrate
npm run db:seed -- '<user id>'
```

---

## The API

JSON REST, every route behind a valid Auth0 access token.

| Method   | Path                     | Purpose                                                                          | Success                                    |
| -------- | ------------------------ | -------------------------------------------------------------------------------- | ------------------------------------------ |
| `GET`    | `/api/tasks`             | Owner-scoped list; `page`, `pageSize`, `status`. No `status` excludes `ARCHIVED` | `200` + `{ items, page, pageSize, total }` |
| `GET`    | `/api/tasks/:id`         | One Task                                                                         | `200` + `Task` + `ETag`                    |
| `POST`   | `/api/tasks`             | Create, always `PENDING`                                                         | `201` + `Task`                             |
| `PATCH`  | `/api/tasks/:id`         | Edit title/description; requires `If-Match`                                      | `200` + `Task`                             |
| `POST`   | `/api/tasks/:id/start`   | `PENDING → IN_PROGRESS`                                                          | `200` + `Task`                             |
| `POST`   | `/api/tasks/:id/done`    | `IN_PROGRESS → DONE`, idempotent                                                 | `200` + `Task`                             |
| `POST`   | `/api/tasks/:id/archive` | `DONE → ARCHIVED`                                                                | `200` + `Task`                             |
| `DELETE` | `/api/tasks/:id`         | Delete, legal from any Status                                                    | `204`                                      |

Transitions are dedicated endpoints rather than `PATCH { status }`, and
`status` is absent from every input schema. That is what keeps the Postgres
function `mark_task_done()` the single entrance to `DONE` — see
[Concurrency](#concurrency-and-idempotency) below.

Errors are always `{ error: { code, message, details? } }`, with `code` drawn
from a frozen enum, so the frontend branches on a code rather than
string-matching a message. The two that matter most are different failures with
different recoveries: **`412 VERSION_CONFLICT`** means someone else changed the
Task and your copy is stale; **`409 INVALID_TRANSITION`** means the move itself
is not legal from where the Task is. A Task you do not own is reported as
`404`, never `403`, so no answer confirms that someone else's Task exists.

### The generated description

`docs/openapi.json` describes the whole API as OpenAPI 3.1. It is **generated
from the same Zod schemas that validate requests** — every field, length cap
and enum member is read off `@insightt/shared` through `z.toJSONSchema()` — so
it cannot drift from what the API actually accepts. Regenerate it with
`npm run docs:api`.

What Zod cannot know — which routes exist, which headers they require, which
error codes each can answer with — is written by hand in
`apps/api/src/docs/openapi.ts`, and `docs/openapi.test.ts` holds _that_ half
against the real Express router: adding a route without documenting it fails a
test. So does leaving the checked-in file stale, which is the one way a
generated document can still be wrong.

The [pre-commit hook](#the-pre-commit-hook) catches that second one earlier,
at the moment it would enter history.

With the API running, the same document is served at
<http://localhost:4000/api/docs/openapi.json>, with Swagger UI over it at
<http://localhost:4000/api/docs>. **Not in production** — `NODE_ENV` is the
switch, and anything but `production` mounts it. It has to sit outside the auth
stack, since a browser loading a page carries no Authorization header, so
serving it in production would hand an unauthenticated caller the shape of
every route.

---

## The decisions the brief asks about

### 1. Express as a separate service, not a Next.js BFF

Full reasoning: [ADR-0001](docs/adr/0001-express-service-not-next-bff.md).

We evaluated both and kept Express as its own process, for three reasons.

**The brief's own framing.** It asks for "a TypeScript backend web framework"
and, separately, for "communication between backend and frontend through JSON
REST API". A BFF satisfies both only on a technicality: the REST boundary
becomes an internal call inside one Next process and "backend framework"
becomes "Next.js again". Two processes across two origins make the boundary a
real one.

**Concurrency does not discriminate**, despite being named in the question.
Every concurrency guarantee here lives in Postgres — the conditional `UPDATE`
inside `mark_task_done()` and `version`-based optimistic locking on edits. A
BFF would make neither easier nor harder.

**Auth genuinely favours the BFF, and we took the worse option knowingly.** A
BFF can hold the session in an `httpOnly` cookie, where no token is reachable
from JavaScript at all. We chose bearer tokens because the brief asks for
authenticated frontend-to-backend communication over REST, and a token
validated against the tenant JWKS demonstrates that directly where a
cookie-session BFF demonstrates a Next.js feature instead. The cost is stated
in full under [Trade-offs](#trade-offs-taken-knowingly).

### 2. Mark-as-Done as a web service over a custom resolver

Full reasoning: [ADR-0002](docs/adr/0002-mark-as-done-mechanism.md).

The brief asks for "a Cloud Function or API web service, or a Custom Resolver",
and to evaluate which fits best. `POST /api/tasks/:id/done` delegating to the
Postgres function `mark_task_done()` is two of the three at once.

The deciding factor is **where the race has to be resolved**. Marking Done must
be atomic and idempotent, and when the conditional `UPDATE` changes zero rows
the caller needs to know _why_ — a question that has to be asked inside the same
transaction. Outside it, the window in which a Task that was `PENDING` gets
reported as a replay is a whole network round trip wide rather than a statement.
That is a database problem, and it is solved in the database whichever option
wraps it. A Supabase Edge Function would not perform the atomic work; it would
call the same Postgres function.

What an Edge Function _would_ add is a second place Auth0 tokens are verified, a
second place logging has to happen — or a hole in the "log all API activities"
requirement, if the browser called it directly — and a network hop from local
Express to the edge and back to Postgres. Cost without a matching benefit, for a
function that already works.

---

## Concurrency and idempotency

**Marking Done** is one conditional statement, so Postgres row locking
serialises concurrent callers with no application-level locking:

```sql
update tasks
   set status = 'DONE', completed_at = now(), version = version + 1
 where id = p_task_id and owner_id = p_actor and status = 'IN_PROGRESS'
returning *;
```

Zero rows affected means the function re-reads the row `FOR UPDATE` — still
inside the transaction — and returns a discriminated outcome:

| Outcome                                   | Answer                                            |
| ----------------------------------------- | ------------------------------------------------- |
| `completed`                               | `200` + the Task                                  |
| `replayed` — already `DONE`               | `200` + the Task, and `X-Idempotent-Replay: true` |
| `wrong_status`                            | `409 INVALID_TRANSITION`                          |
| `not_found` — missing, or not the Actor's | `404 NOT_FOUND`                                   |

Two simultaneous requests: one wins the row lock and completes the Task; the
loser matches zero rows, observes `DONE`, and returns the identical `200`. No
double completion, and no overwritten `completed_at`.

`/start` and `/archive` need no function — a guarded
`UPDATE … WHERE id = ? AND owner_id = ? AND status = ?` is equally atomic.
`/done` is the one that must tell a replay from a rejection.

**Editing** uses optimistic locking on `version`. Every response carrying a Task
sets `ETag: "<version>"`, and `PATCH` requires that value back as `If-Match`:

| Condition                                            | Answer                      |
| ---------------------------------------------------- | --------------------------- |
| `If-Match` absent                                    | `428 PRECONDITION_REQUIRED` |
| `If-Match` stale                                     | `412 VERSION_CONFLICT`      |
| `If-Match` unreadable as a version (`*`, a weak tag) | `412 VERSION_CONFLICT`      |

Absent is a different mistake from stale and has a different fix — send the
header, versus re-read the Task — so they are different codes. `If-Match: *` is
a deliberate deviation from RFC 9110, which defines it as matching any existing
representation: "whatever version it is on, write anyway" is exactly the
clobbering this endpoint exists to refuse.

The version is checked twice on the way through: once after the read, so the
rules that depend on the Task's Status are applied to the Task the caller
actually saw, and again in the `WHERE` of the statement itself, which is what
closes the window the read opened.

---

## Tests

```bash
npm run test      # Jest, per workspace
npm run test:e2e  # Cypress against the real Auth0 tenant
```

375 Jest tests across three workspaces, plus one Cypress spec.

### "A backend unit test written with React Testing Library"

This is the requirement most likely to be read as unmet, so it is answered here
rather than left to be discovered.

**It is not achievable as written.** React Testing Library renders React
components into a DOM. It has no way to exercise an Express route, a Postgres
query or a Node module — there is nothing for it to render. Any code that RTL
could test would be frontend code, at which point it is not a backend test.

We read the requirement as two tests, and wrote both:

1. **A backend test suite, in Jest, with no RTL** — `apps/api` and
   `packages/shared`.
2. **A frontend integration test, with RTL** — `TaskListScreen` rendered
   against a mock server.

Both are described below. If the intent was instead "backend tests, and
separately some RTL", that is what is here.

### 1. Backend and shared — Jest, no RTL

`packages/shared` (70 tests) and `apps/api` (273), plus the non-rendering parts
of `apps/web`. Two kinds, and the split is worth stating rather than filing
both under "unit".

_Genuinely unit_ — called directly, with no HTTP in front of them. The
transition validator and the schemas in `packages/shared`; and in `apps/api`,
`repository.drizzle.ts` under a stubbed `pg` pool, 51 cases asserting the SQL
and the parameters it emits, plus `mappers.ts`, `env.ts` and the generated API
description.

Three drift checks sit in the same tier, each holding apart two spellings of one
rule that cannot be derived from each other: the Zod Status enum against the
Postgres one; the shared transition machine against the `WHERE` clause
`mark_task_done()` hardcodes; and the documented routes against the ones the
Express router actually serves.

_Integration, over HTTP_ — every Task operation. **There is no service layer.**
The operations live in `tasks/routes.ts`, and the tests enter them through the
real `createApp` with supertest. The repository is the seam — a fake behind the
real interface — and the auth middleware is stubbed; everything between is real:
CORS, the body parser, validation, the error mapper. Each legal Transition, each
rejected one, the already-`DONE` Replay, the non-owner `404` and the per-Status
field whitelist are all asserted there.

Calling a handler directly instead would skip the parts most likely to be wrong.
The cost of the choice is that the backend's domain rules have no unit test of
their own, and that is the honest reading of the paragraph above.

**What is not covered**: `mark_task_done()` is never executed by an automated
test. `db/mark-task-done.test.ts` reads the migration as text and checks it
agrees with the TypeScript rule, but no Jest test opens a Postgres connection
and the Cypress spec is read-only. The atomicity ADR-0002 argues for is
therefore argued, not demonstrated; closing that needs a containerised Postgres
running the migrations, which was outside the time budget. It is named here
rather than left for a reviewer to find.

### 2. Frontend integration — Jest + React Testing Library + MSW

`TaskListScreen` with the real providers behind it — the real Query cache, the
real Zustand stores, the real components — and MSW the only thing standing in.
It asserts the rows the API returned, that marking an `IN_PROGRESS` Task Done
re-renders it as Done, that a replayed `200` is handled as success rather than
surfaced as an error, and that every control a row's Status makes illegal is
rendered disabled.

Auth0 is left out rather than mocked: the test renders the screen rather than
the page and seeds the session store directly, so everything reading that store
— the API client's token included — behaves as it does signed in. Signing in for
real is test 3's job.

The signed-out screen has a small suite of its own, and it is the one place
`useAuth0` is faked, because what it asserts is the argument each button hands
the SDK: nothing for **Log in**, `screen_hint: 'signup'` for **Sign up**. A
Sign up button that lost the hint would still render and still sign people in,
and would land someone with no account on a login form.

### 3. End to end — Cypress against the real tenant

`cypress/e2e/task-list.cy.ts` mints a token against the real Auth0 tenant, seeds
it into the SDK's storage, and asserts the signed-in task list renders.

It never drives Universal Login. The token is minted with the **Cypress** client
— the only one allowed the Password Realm grant — and stored under the **SPA**
client's cache key, the only one the browser app reads.
`cypress/support/auth0.ts` is the single file that knows the SDK's storage
layout.

---

## Trade-offs taken knowingly

**Tokens live in `localStorage`, and are therefore XSS-reachable.** The SPA runs
`@auth0/auth0-react` with `cacheLocation: 'localstorage'` and rotating refresh
tokens, so the session survives a page reload. The alternative, in-memory
caching, puts the refresh token in memory too, so a reload falls back to
hidden-iframe silent auth — which Safari and Brave block outright. The stronger
option than either is the `httpOnly` cookie a Next.js BFF could hold, and
[ADR-0001](docs/adr/0001-express-service-not-next-bff.md) explains why that was
not taken. Mitigated by refresh token rotation and by the SPA talking to no
other origin; not eliminated. For anything beyond a local demo this is the first
thing to change.

**The database connection is encrypted but, by default, not authenticated.**
Supabase's pooler presents a self-signed chain, so Node rejects it unless told
which root to trust. With `DATABASE_CA_CERT` unset the client falls back to
`rejectUnauthorized: false`. Set it — dashboard → Settings → Database → SSL
configuration — and verification is on. The two branches are spelled out in
`db/client.ts` rather than left to a bare flag, so the weaker one is a visible
choice rather than a default nobody revisits.

**The deployment target is local.** There is no hosted instance; whoever reviews
this runs it. That is the decision the Vercel and Edge Function options were
measured against, and it is why the env files are written by a wizard rather
than injected by a platform.

**`Archived` is a Status, not a soft delete.** The list leaves Archived Tasks
out until the Archived filter asks for them, but the row is untouched: nothing
is flagged, `GET /api/tasks/:id` still returns it, and Delete remains legal from
every Status. Two different operations, deliberately not collapsed into one.

---

## Layout

```
apps/web         Next.js 16 SPA — all pages are client components, one route: /
apps/api         Express + TypeScript REST API (CommonJS)
apps/api/drizzle SQL migrations — generated, plus hand-written `--custom` ones
packages/shared  @insightt/shared — Zod schemas and the Status transition rules
cypress/         The one E2E spec, and the Auth0 sign-in that seeds it
docs/adr/        Architecture decision records
docs/openapi.json  Generated — `npm run docs:api`
scripts/         setup-auth0.sh
```

`PLAN.md` §3 has the file-level structure inside each workspace.
