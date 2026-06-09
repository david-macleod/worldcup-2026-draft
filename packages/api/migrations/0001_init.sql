-- 0001_init — World Cup 2026 multi-league draft schema (D1 / SQLite).
-- Forward-only. Never edit an applied migration; add a new numbered file instead.

-- ── Global (shared, seeded) ─────────────────────────────────────────────────

-- The 48-team field. Source of truth for the draftable teams (seeded from teams.js).
CREATE TABLE teams (
  id      TEXT PRIMARY KEY,         -- e.g. 'fra'
  name    TEXT NOT NULL,
  abbr    TEXT NOT NULL,            -- 3-letter FIFA code
  code    TEXT NOT NULL,            -- flagcdn ISO code (gb-eng / gb-sct supported)
  rank    INTEGER NOT NULL,         -- FIFA ranking
  conf    TEXT NOT NULL,
  grp     TEXT NOT NULL,            -- group letter A..L
  star    TEXT,
  host    INTEGER NOT NULL DEFAULT 0,
  pop     REAL, temp REAL, rain REAL, dogs REAL, age REAL,
  hgt     REAL, light REAL, coffee REAL, hue REAL
);

-- Tournament fixtures. One shared WC-2026 bracket every league scores against.
CREATE TABLE matches (
  id           TEXT PRIMARY KEY,    -- 'G-A-1', 'R32-1', ...
  stage        TEXT NOT NULL,       -- 'group' | 'R32' | 'R16' | 'QF' | 'SF' | 'Final'
  grp          TEXT,                -- group letter for group stage, else NULL
  home_team_id TEXT REFERENCES teams(id),
  away_team_id TEXT REFERENCES teams(id),  -- NULL until knockout slots fill
  kickoff      TEXT,                -- ISO string, nullable
  home_goals   INTEGER,
  away_goals   INTEGER,
  home_pens    INTEGER,
  away_pens    INTEGER,
  status       TEXT NOT NULL DEFAULT 'scheduled'  -- 'scheduled' | 'finished'
);
CREATE INDEX idx_matches_stage ON matches(stage);

-- ── Per-league ──────────────────────────────────────────────────────────────

CREATE TABLE leagues (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  mode            TEXT NOT NULL,    -- 'sequential' | 'autodraft' | 'imported'
  status          TEXT NOT NULL DEFAULT 'setup',  -- 'setup' | 'drafting' | 'complete'
  order_json      TEXT,             -- locked array of manager ids (snake seats)
  current_overall INTEGER NOT NULL DEFAULT 0,      -- sequential clock 0..47
  created_at      TEXT NOT NULL
);

CREATE TABLE managers (
  id        TEXT PRIMARY KEY,
  league_id TEXT NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  token     TEXT NOT NULL UNIQUE,   -- unguessable; the token IS the identity
  seat      INTEGER,                -- snake seat, NULL until order locked
  color     TEXT NOT NULL
);
CREATE INDEX idx_managers_league ON managers(league_id);

CREATE TABLE picks (
  id         TEXT PRIMARY KEY,
  league_id  TEXT NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  overall    INTEGER NOT NULL,      -- 0..47
  manager_id TEXT NOT NULL REFERENCES managers(id) ON DELETE CASCADE,
  team_id    TEXT NOT NULL REFERENCES teams(id),
  created_at TEXT NOT NULL,
  UNIQUE (league_id, overall),      -- optimistic-concurrency guard for sequential picks
  UNIQUE (league_id, team_id)       -- a team can be owned by only one manager per league
);
CREATE INDEX idx_picks_league ON picks(league_id);

CREATE TABLE wishlist_entries (
  id         TEXT PRIMARY KEY,
  league_id  TEXT NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  manager_id TEXT NOT NULL REFERENCES managers(id) ON DELETE CASCADE,
  team_id    TEXT NOT NULL REFERENCES teams(id),
  rank       INTEGER NOT NULL,      -- 0-based preference order
  UNIQUE (league_id, manager_id, team_id)
);
CREATE INDEX idx_wishlist_mgr ON wishlist_entries(league_id, manager_id);
