-- The overnight memory pass (nightly.ts), which arrived after 0011 had
-- already run on every tier.
--
--   nightly     1 lets the pass read the day's private chats and fold
--               what's lasting into notes and soul. The switch on Account >
--               Memory. On by default.
--   trained_at  when the pass last ran for this person, so each pass starts
--               where the previous one ended. NULL until the first.
--
-- Can't be re-run (SQLite has no ADD COLUMN IF NOT EXISTS). Run once per
-- tier, local then dev then prod, before the deploy that needs it.

ALTER TABLE memory ADD COLUMN nightly INTEGER NOT NULL DEFAULT 1;
ALTER TABLE memory ADD COLUMN trained_at INTEGER;
