# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## What this is

A take-home task list: Auth0 authentication and task CRUD, as a local npm-workspaces
monorepo — a Next.js SPA, an Express REST API, and a shared Zod contract package,
backed by Supabase Postgres.

**Read these before making design choices**, in this order:

- `PLAN.md` — the implementation plan. Every architectural decision, with rationale.
- `CONTEXT.md` — the domain glossary. Use its vocabulary; it is opinionated about
  which words to avoid.
- `docs/adr/` — the two decisions the brief asks to be justified explicitly.

If a change contradicts any of the three, update the document in the same commit.

## Commands

```bash
npm install                    # workspace install, from the root
bash scripts/setup-auth0.sh    # one-time Auth0 tenant + env setup
npm run dev                    # Express on :4000, Next on :3000, concurrently
npm run build                  # production build; type-checks every workspace first
npm run typecheck              # the same check plus cypress/, which is not a workspace
npm run lint                   # fans out to each workspace; eslint flat config in apps/web
npm run db:generate            # drizzle-kit — generate a migration from schema.ts
npm run db:migrate             # apply migrations
npm run db:seed -- '<user id>' # demo Tasks under one Owner; add 'replace' to clear theirs first
npm run test                   # Jest, per workspace: apps/api, packages/shared, apps/web
npm run test:e2e               # Cypress — boots both dev servers, runs the spec, stops them
npm run docs:api               # z.toJSONSchema() -> docs/openapi.json
```

## Layout

```
apps/web         Next.js 16 SPA — all pages are client components, one route: /
apps/api         Express + TypeScript REST API (CommonJS)
apps/api/drizzle SQL migrations — generated, plus hand-written `--custom` ones
packages/shared  @insightt/shared — Zod schemas + the status transition rules
cypress/         The one E2E spec, and the Auth0 sign-in that seeds it
docs/adr/        Architecture decision records
scripts/         setup-auth0.sh
```

Both apps depend on `@insightt/shared`; neither depends on the other. The root
`package.json` is workspace declarations and orchestration only. `PLAN.md` §3 has
the file-level structure inside each workspace — follow it rather than inventing
folders.

## Conventions

**Stack versions matter here.** Next 16, React 19.2, Ant Design **v6**, Zod **v4**.
Consult `node_modules/next/dist/docs/` before writing Next code (see AGENTS.md) —
v16 APIs differ from older releases.

- **Ant Design v6 supports React 19 natively.** Do not add
  `@ant-design/v5-patch-for-react-19`; it exists only for v5.
- **Zod v4 spellings**: `z.uuid()` and `z.iso.datetime()` are top-level,
  `z.strictObject` exists, `z.toJSONSchema()` is built in. Training data for v3
  will be wrong.
- **No Tailwind.** Ant Design is the only styling system. Do not reintroduce
  `tailwindcss`, `postcss.config.mjs`, or `@import "tailwindcss"` — antd's
  CSS-in-JS and Tailwind's preflight reset the same elements.
- **Route prop types are global.** Next generates `PageProps<"/route">` /
  `LayoutProps<"/route">` from the route tree into `.next/types`; use them rather
  than hand-written prop interfaces. They only exist after `next dev`/`next build`.
- **`apps/api` is CommonJS**, because the brief mandates Jest and `ts-jest` on ESM
  is a config tarpit. Do not "modernise" it to ESM.
- `packages/shared` exports raw TypeScript — no build step. `apps/web` consumes it
  via `transpilePackages`, `apps/api` via `tsx` in dev and `moduleNameMapper` in Jest.
- `@/*` resolves to each app's own `src/`.
- Fonts come from `next/font/google` in `apps/web/src/app/layout.tsx`, exposed as
  CSS variables on `<html>`.
- **Ant Design's CSS-in-JS needs the registry.** `apps/web/src/providers/Antd.tsx`
  wraps the tree in `@ant-design/nextjs-registry`; without it Next's build-time
  prerender of client components ships an unstyled first paint.

## Domain rules that are easy to get wrong

- **`userId`, never `sub` or `id`.** The Auth0 `sub` claim is read exactly once, in
  the auth middleware, and is called `userId` everywhere above that boundary. `id`
  always means a Task's id. The DB column is `owner_id`.
- **The status machine is strictly linear**: `PENDING → IN_PROGRESS → DONE → ARCHIVED`.
  No skipping, no reverts, `ARCHIVED` is terminal.
- **`status` is not writable through any input schema.** Status changes go through
  the dedicated endpoints (`/start`, `/done`, `/archive`) only, so that
  `mark_task_done()` stays the single atomic entrance to `DONE`. Adding `status` to
  `CreateTaskInput` or `UpdateTaskInput` breaks the idempotency guarantee.
- **Two type layers, never collapsed.** Drizzle types describe DB rows (snake_case,
  internal to `apps/api`); Zod types describe the wire contract (camelCase, shared).
  `apps/api/src/tasks/mappers.ts` is the seam. Do not use `drizzle-zod` for the
  shared schemas.
- **Nothing above `tasks/repository.ts` knows Drizzle exists.** The interface is
  in that file; `repository.drizzle.ts` and `repository.fake.ts` implement it,
  and only `index.ts` and the test harness name one.
- **Triggers and functions are hand-written migrations.** `drizzle-kit` diffs
  tables only, so `npm run db:generate -- --custom --name <what>` and write the
  SQL. Never edit a generated migration to carry one.
- **Not-owned tasks return `404`, never `403`**, so existence is not leaked.
- **`412` means stale `If-Match`; `409` means an illegal transition.** They are
  different failures and the frontend branches on them.
- **The E2E spec seeds the Auth0 SDK's storage; it never drives Universal
  Login.** The token is minted with the Cypress client (the only one allowed the
  Password Realm grant) and stored under the **SPA** client's cache key (the only
  one the browser app reads). `cypress/support/auth0.ts` is the single file that
  knows the SDK's storage layout, and an `@auth0/auth0-spa-js` major is what
  breaks it.

## Agent skills

### Issue tracker

Issues live as GitHub Issues in `Charlemagnes/insightt-crud`, managed via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
