# World Cup 2026 — Draft League

A static web app for running a snake draft of all 48 World Cup 2026 nations and
tracking a live competition table scored on how each manager's drafted teams perform.

No backend, no build step — plain HTML + JS, rendered in the browser.

## Pages
| File | What it is |
|------|-----------|
| `index.html` | Landing page linking to the two tools |
| `draft.html` | The draft room — name managers, spin the snake order, draft all 48 teams |
| `standings.html` | Competition results — managers ranked by their teams' tournament results |

## How it works
- **JSX is transpiled in the browser** via Babel standalone (loaded from a CDN). That's
  why the `.jsx` files are served as-is — no compile step needed.
- **Team flags** load at runtime from `flagcdn.com` (needs an internet connection).
- **State is per-browser** (localStorage). There is no shared server, so a draft one
  person runs is not synced live to other devices. See "Going multiplayer" below.

---

# 🚀 Deploy — instructions for Claude Code

> The goal: create a **new public repo under `github.com/david-macleod`** and push this
> folder to it, then enable GitHub Pages so it's live on the web.

### 0. Prerequisites
Confirm the GitHub CLI is authenticated as **david-macleod**:
```bash
gh auth status
```
If not, run `gh auth login` and sign in as david-macleod.

### 1. Initialise git in this folder
```bash
git init
git add -A
git commit -m "Initial commit: World Cup 2026 draft league"
git branch -M main
```

### 2. Create the repo under david-macleod and push
```bash
gh repo create david-macleod/worldcup-2026-draft \
  --public \
  --source=. \
  --remote=origin \
  --push \
  --description "World Cup 2026 snake-draft league + live standings"
```
(Pick any name you like in place of `worldcup-2026-draft`.)

### 3. Turn on GitHub Pages (free hosting)
```bash
gh api -X POST repos/david-macleod/worldcup-2026-draft/pages \
  -f "source[branch]=main" -f "source[path]=/"
```
Wait ~1 minute, then the site is live at:
```
https://david-macleod.github.io/worldcup-2026-draft/
```
(Or set Pages via the repo's **Settings → Pages → Branch: main / root**.)

### Alternative one-liner host (no Pages)
Drag this folder onto **https://app.netlify.com/drop** for an instant URL.

---

# Going multiplayer (optional, future work)
Today each browser runs its own copy, so a live "everyone joins the draft room from
their phone" experience needs a small realtime backend. The cleanest options:
- **Supabase / Firebase Realtime DB** — store the draft state (order, picks) in one row
  and subscribe to changes; replace the localStorage reads/writes in `app.jsx`.
- **A tiny WebSocket server** (e.g. on Cloudflare Workers/Durable Objects) broadcasting
  pick events.

The draft logic already centralises state in `app.jsx` (the `picks`, `order`, `players`
arrays), so swapping localStorage for a shared store is a contained change.

# Wiring real results
`standings.html` currently runs a **simulation** (`sim.js`) that fabricates scores
weighted by FIFA ranking. Once the tournament starts, replace `sim.js`'s match results
with real fixtures/scores (same data shape) and the leaderboard + group feed update
automatically.

# File map
```
index.html        landing page
draft.html        ── teams.js, image-slot.js, tweaks-panel.jsx,
                     shared.jsx, lobby.jsx, draftboard.jsx,
                     results.jsx, reveal.jsx, app.jsx
standings.html    ── teams.js, sim.js, shared.jsx, comp.jsx, tweaks-panel.jsx
```
