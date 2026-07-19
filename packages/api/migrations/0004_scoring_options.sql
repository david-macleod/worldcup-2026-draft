-- 0004_scoring_options — per-league scoring toggles + the third-place playoff fixture.
-- Forward-only. Never edit an applied migration; add a new numbered file instead.

-- Per-league scoring options (both default OFF, preserving existing behaviour):
--   final_double        — the Final awards double points to both teams
--   third_place_scores  — the third-place playoff awards points at all
ALTER TABLE leagues ADD COLUMN final_double       INTEGER NOT NULL DEFAULT 0;
ALTER TABLE leagues ADD COLUMN third_place_scores INTEGER NOT NULL DEFAULT 0;

-- The third-place playoff (real WC-2026 match 103): the two semi-final losers. Like every
-- knockout slot its teams are derived from results, not stored. Seeded here so existing DBs
-- gain the fixture on deploy; the regenerated seed.sql keeps fresh setups in sync (idempotent).
INSERT INTO matches (id, stage, grp, home_team_id, away_team_id, kickoff, status)
VALUES ('3P-1', '3P', NULL, NULL, NULL, '2026-07-18T19:00:00Z', 'scheduled')
ON CONFLICT(id) DO NOTHING;
