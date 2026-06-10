-- 0002_league_size — make participant count and squad size configurable per league.
-- Existing leagues keep the original 8 managers x 6 rounds. New leagues set their own.
ALTER TABLE leagues ADD COLUMN n_managers INTEGER NOT NULL DEFAULT 8;
ALTER TABLE leagues ADD COLUMN n_rounds   INTEGER NOT NULL DEFAULT 6;
