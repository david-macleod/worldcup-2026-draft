-- 0003_knockout_90min_goals — split goals for knockout scoring.
-- home_goals/away_goals stay the FINAL result (after extra time for knockouts; = 90'
-- for group games and any KO decided in normal time) and drive win/draw/loss + who
-- advances. The new *_g90 columns hold goals scored in the first 90 minutes only, which
-- is all that counts for GOAL points. NULL means "same as the final score" (every group
-- game and every existing row), so no backfill is needed.
ALTER TABLE matches ADD COLUMN home_g90 INTEGER;
ALTER TABLE matches ADD COLUMN away_g90 INTEGER;
