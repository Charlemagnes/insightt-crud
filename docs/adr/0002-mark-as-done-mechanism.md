# Mark-as-Done runs as an Express endpoint over a Postgres function

The brief requires Mark-as-Done to use "a Cloud Function or API web service, or
a Custom Resolver", and asks us to evaluate which fits best. We chose
`POST /api/tasks/:id/done` (the web service) delegating to `mark_task_done()`, a
Postgres function (the custom resolver) — satisfying two of the three options
with one design.

## Considered Options

**Supabase Edge Function.** Genuinely a cloud function, deployed to Supabase's
edge network, and the brief points at it directly. We re-examined it after
initially rejecting it on deployment grounds, and that objection turned out to be
wrong: the Supabase CLI falls back to API-based deployment when Docker is absent
(`--use-api`), so no Docker Desktop is required, and `--no-verify-jwt` allows
verifying an Auth0 RS256 token inside the function rather than Supabase's own.

**Vercel serverless function.** Ruled out by the local-only scope decision: there
is no Vercel deployment in this project for one to live in.

**Postgres function called from Express.** The chosen option.

## Decision

Express endpoint over a Postgres function.

The deciding factor is _where the race has to be resolved_. Marking Done must be
atomic and idempotent: two simultaneous requests must produce one completion and
two identical `200`s, and the "why did zero rows change?" read belongs inside
the same transaction as the conditional `UPDATE`, or the window in which a task
that was `PENDING` gets reported as a replay is a whole round trip wide rather
than a statement. That is a database problem, and it is solved in
the database whichever option wraps it. An Edge Function would not perform the
atomic work — it would call the same Postgres function.

What the Edge Function would add, then, is a second place where Auth0 JWTs are
verified, a second place where logging would have to happen (or a hole in the
"log all api activities" middleware, if the browser called it directly), and a
network hop from local Express to Supabase's edge and back to Supabase's
Postgres. For a function that already exists and already works, that is cost
without a matching benefit.

Routing the browser directly to the Edge Function was rejected separately: it
would take the one endpoint the concurrency requirement cares about most and
route it around the logging middleware that same requirement mandates.

## Consequences

- `mark_task_done()` is the only entrance to `DONE`. `status` is therefore absent
  from every input schema, and there is no `PATCH { status }` path.
- The transition rule `IN_PROGRESS → DONE` is written twice: in
  `packages/shared/src/rules/transitions.ts`, which disables the UI control and
  supplies the guard for the non-atomic transitions, and in the function's
  `WHERE` clause for atomic enforcement. This duplication is deliberate defence
  in depth, and `apps/api/src/db/mark-task-done.test.ts` reads the migration and
  asserts the two agree, so drift fails a test rather than a demo.
- The function is not `SECURITY DEFINER`; with RLS off and the API connecting on
  a role that owns `tasks`, that qualifier would change nothing.
- If the brief is later read as requiring a cloud function specifically, the
  smallest compliant change is to insert an Edge Function between Express and
  `mark_task_done()` — roughly 40 lines of Deno — without touching the atomicity
  design.
