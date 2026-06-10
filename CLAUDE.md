# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A multi-league snake-draft app for the 48-team World Cup 2026, shipped as a **single Cloudflare Worker** that serves both a React SPA and a JSON API backed by D1. An admin ("commissioner") creates leagues; managers draft asynchronously via an unguessable token in their URL (no accounts, no email); everyone watches a live leaderboard once real match results are entered.

## Commands

All commands run from the repo root (pnpm + turbo monorepo). Use `pnpm --filter @wc/api` / `@wc/web` to target one package.

```bash
pnpm install
pnpm --filter @wc/api run db:migrate    # apply D1 migrations to local DB (run before first dev)
pnpm --filter @wc/api run db:seed       # load 48 teams + match skeleton (idempotent)
pnpm dev                                # turbo: wrangler dev (:8787) + vite (:5173) — open :5173
```

- **Tests** (scoring, snake math, autodraft): `pnpm --filter @wc/api test` — the only package with tests; `@wc/web` has none.
- **Single test**: `pnpm --filter @wc/api exec vitest run src/services/__tests__/scoring.test.ts` (or `-t "name"` to filter by test name).
- **Inspect the DB**: `pnpm --filter @wc/api exec wrangler d1 execute worldcup --local --command "SELECT * FROM leagues"`
- **Production-like check** (Worker serves the built SPA from one origin, no vite proxy): `pnpm --filter @wc/web build` then `pnpm --filter @wc/api exec wrangler dev`.
- **Deploy**: pushing to `main` auto-deploys via `.github/workflows` (builds web, applies remote migrations, `wrangler deploy --env production`). Manual: `pnpm ship`.

Local admin password is `dev` (in `packages/api/.dev.vars`, gitignored). In prod it's the `ADMIN_PASSWORD` secret.

## Architecture

Two workspace packages, one deployed Worker:

- `packages/api/` — Hono API on Cloudflare Workers + D1. **No build step** (the Worker runs from `src`).
- `packages/web/` — React 19 + Vite + TanStack Router/Query. `vite build` emits `packages/web/dist`.

**Single-origin serving.** `wrangler.toml` sets `run_worker_first = true`, so *every* request hits the Worker (`packages/api/src/index.ts`). `/api/*` is handled by Hono; everything else is delegated to `env.ASSETS.fetch`, which serves `packages/web/dist` with SPA fallback (`not_found_handling = "single-page-application"`) so client routes like `/l/:id` and `/admin` resolve. In dev, Vite (:5173) proxies `/api/*` to the Worker (:8787) instead.

**API route groups** (`packages/api/src/routes/`): `public.ts` (standings, fixtures), `manager.ts` (token-gated pick/wishlist), `admin.ts` (commissioner console). Admin routes sit behind `middleware/admin-auth.ts` — a single shared password in the `X-Admin-Password` header checked against `ADMIN_PASSWORD`. One privileged role, no user accounts; manager identity is purely the URL token.

**Data layer** (`packages/api/src/db/`): thin typed helpers over D1 prepared statements — **no ORM**. `index.ts` holds query functions, `types.ts` the row shapes. When schema changes, update both.

**Scoring is computed on read**, never persisted. Raw match results are the source of truth; `services/scoring.ts` is one swappable pure function (intentional stub: per-match fantasy + stage progression) turning results into manager points. It is unit-tested — change the formula there.

**Three draft modes**: `sequential` (live async turns), `autodraft` (ranked wishlists, `services/autodraft.ts` resolves), `imported` (paste a finished offline draft). Snake seat math lives in `lib/snake.ts` (8 managers × 6 rounds = 48 picks).

**No realtime infra.** Async turns are hours apart; draft views stay current via TanStack Query `refetchInterval` polling. The `(league_id, overall)` unique constraint is the optimistic-concurrency guard against double-submit.

**Web routing** is code-based TanStack Router (route tree defined in `packages/web/src/main.tsx`, no file-route codegen). Styling is plain CSS with ported World Cup theme tokens — not Tailwind.

## Schema changes (D1, forward-only)

1. `pnpm --filter @wc/api exec wrangler d1 migrations create worldcup <slug>` → numbered stub in `migrations/`.
2. Write the SQL. **Never edit an applied migration.**
3. `pnpm --filter @wc/api run db:migrate`, then update typed row shapes in `src/db/types.ts` and affected helpers in `src/db/index.ts`.
4. If catalog columns changed, regenerate the seed: `node scripts/gen-seed.mjs`, then `pnpm --filter @wc/api run db:seed`. Seed is idempotent (teams upsert; matches never clobber entered scores).

Knockout fixtures are seeded empty — the admin assigns `home_team_id`/`away_team_id` to a slot when entering its result.
