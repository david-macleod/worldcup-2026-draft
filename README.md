# World Cup 2026 — Draft League (Cloudflare)

A multi-league snake-draft app for the 48-team World Cup 2026, rebuilt as a single
Cloudflare Worker that serves both a React app and a JSON API backed by D1. An admin
("commissioner") spins up leagues, managers draft asynchronously via personal links,
and everyone watches a live leaderboard once real results are entered.

Rebuild of the original client-side app (`worldcup-2026-draft`): in-browser Babel +
localStorage + a single synchronous draft + simulated results → a real backend with
multiple leagues, a shared tournament, and three draft modes.

## Capabilities
- **Multiple leagues**, all controlled by one admin (single `ADMIN_PASSWORD`).
- **Centralised fixtures & results** — one shared WC-2026 tournament every league scores against.
- **Three draft modes** — `sequential` (live async turns), `autodraft` (ranked wishlists,
  commissioner resolves), `imported` (paste a finished offline draft).
- **Manager identity is an unguessable token in their URL** — no accounts, no email.

## Architecture
One Worker, two workspace packages (pnpm + turbo):

```
packages/
  api/   Hono API on Cloudflare Workers + D1 (prepared statements, no ORM),
         serves the web build through the ASSETS binding (run_worker_first).
  web/   React 19 + Vite + TanStack Router/Query (worldcup visual identity).
```

- **No realtime infra.** Turns are hours-apart async; draft views stay current by
  polling (TanStack Query `refetchInterval`). The `(league_id, overall)` unique
  constraint is the optimistic-concurrency guard against a double-submit.
- **Scoring is computed on read** through one swappable pure function
  (`packages/api/src/services/scoring.ts`). Raw match results are the source of
  truth; manager points are never persisted.

## Local development (no Cloudflare account needed)
```bash
pnpm install
pnpm --filter @wc/api run db:migrate   # apply migrations to the local D1
pnpm --filter @wc/api run db:seed       # load the 48 teams + match skeleton
pnpm dev                                # turbo: wrangler dev (:8787) + vite (:5173)
```
Open **http://localhost:5173**. Vite proxies `/api/*` to the local Worker. The admin
password in local dev is `dev` (set in `packages/api/.dev.vars`, gitignored).

- Inspect the DB: `pnpm --filter @wc/api exec wrangler d1 execute worldcup --local --command "SELECT * FROM leagues"`
- Unit tests (scoring, snake math, autodraft): `pnpm --filter @wc/api test`

### Production-like local check (Worker serves the built SPA, one origin)
```bash
pnpm --filter @wc/web build              # emits packages/web/dist
pnpm --filter @wc/api exec wrangler dev   # serves dist via ASSETS, no vite proxy
```

## Schema changes (D1, forward-only)
1. `pnpm --filter @wc/api exec wrangler d1 migrations create worldcup <slug>` → next numbered stub.
2. Write the SQL; **never edit an applied migration**.
3. `pnpm --filter @wc/api run db:migrate` (local) and update the typed row shapes in
   `src/db/types.ts` + affected helpers in `src/db/index.ts`.
4. If catalog columns changed, regenerate the seed: `node scripts/gen-seed.mjs`, then
   `pnpm --filter @wc/api run db:seed`. The seed is idempotent (teams upsert; matches
   never clobber entered scores), so it's safe to re-run.

## Deploy (Cloudflare)
```bash
wrangler login
wrangler d1 create worldcup                 # paste the database_id into wrangler.toml (both envs)
pnpm --filter @wc/api run db:migrate:remote
pnpm --filter @wc/api exec wrangler d1 execute worldcup --remote --file=src/db/seed.sql
pnpm --filter @wc/web build
pnpm --filter @wc/api exec wrangler secret put ADMIN_PASSWORD --env production
pnpm ship                                    # wrangler deploy --env production
```

## Routes
- `/` — landing.
- `/admin` — commissioner console (create/import leagues, spin/start, resolve, enter results).
- `/l/:leagueId` — public standings (a manager's home base).
- `/l/:leagueId/m/:token` — manager view: pick (sequential) / wishlist (autodraft) while
  drafting, standings with your squad highlighted once complete.

## Notes / deviations from the original plan
- **Plain CSS** (ported worldcup theme tokens) instead of Tailwind — keeps the original
  broadcast-pitch look and avoids a build-config dependency. Swap in Tailwind later if wanted.
- **Code-based TanStack Router** (route tree in `src/main.tsx`) rather than the
  file-route plugin — fewer moving parts, no codegen step.
- **Scoring is an intentional stub** ("combined" model: per-match fantasy + stage
  progression). The formula lives behind one function and is unit-tested; change it there.
- **Knockout fixtures** are seeded empty; the admin assigns teams to a knockout slot when
  entering its result (`home_team_id`/`away_team_id` on the result endpoint).
