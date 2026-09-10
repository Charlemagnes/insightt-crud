# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm run dev     # dev server on :3000
npm run build   # production build (also the only full type-check — tsconfig is noEmit)
npm start       # serve the production build
npm run lint    # eslint (flat config, no args needed)
```

No test runner is configured yet.

## Stack

Next.js 16 App Router, React 19, TypeScript strict, Tailwind CSS v4. Everything currently lives in `app/` (`layout.tsx`, `page.tsx`, `globals.css`); there is no `src/` directory and no backend/data layer yet despite the repo name.

## Conventions that differ from older Next.js/Tailwind

- **Route prop types are global.** `layout.tsx` types its props as `LayoutProps<"/">` with no import — Next generates these from the route tree into `.next/types`. Use `PageProps<"/route">` / `LayoutProps<"/route">` for new routes rather than hand-written prop interfaces. They only exist after `next dev`/`next build` has run.
- **Tailwind v4 is CSS-first.** There is no `tailwind.config.*`. Design tokens are declared in `app/globals.css` via `@import "tailwindcss"` plus an `@theme inline` block that maps CSS custom properties (`--background`, `--foreground`, the Geist font vars) into Tailwind color/font utilities. Add theme values there, not in a JS config.
- **Dark mode is `prefers-color-scheme`-driven** through those `:root` custom properties, alongside `dark:` utilities used directly in components.
- `@/*` path alias resolves to the repo root.
- Fonts come from `next/font/google` in `app/layout.tsx` and are exposed as CSS variables on `<html>`.

Before writing Next.js code, consult `node_modules/next/dist/docs/` (see AGENTS.md) — v16 APIs differ from older releases.
