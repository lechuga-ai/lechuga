-- Bots (lechuga-ops/lechuga-bots-plan.md, step 1). Until now every account
-- had one bot, called Lechuga, and every chat was with it. Now a bot is a
-- row: a name, a soul (how it talks; it used to live on memory.soul), the
-- model its new chats start on, and an owner. Every chat belongs to one.
--
-- Every existing account gets its first bot, Seed, here, carrying the soul
-- from its Memory page, and every existing chat is pointed at it. Accounts
-- made later get Seed on first use (bots.ts, defaultBot). Then memory.soul
-- goes: what a bot is like is set on the bot.
--
--   is_default  Seed. One per account; can't be deleted; where a deleted
--               bot's chats go.
--   model       NULL means the default model in config.json. The chat still
--               keeps the model it was made on, as before.
--
-- Can't be re-run. Run once per tier, local then dev then prod, before the
-- deploy that needs it.

CREATE TABLE bots (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  soul TEXT NOT NULL DEFAULT '',
  model TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_bots_user ON bots(user_id);

ALTER TABLE chats ADD COLUMN bot_id TEXT REFERENCES bots(id);

INSERT INTO bots (id, user_id, name, soul, model, is_default, created_at, updated_at)
  SELECT lower(hex(randomblob(16))), u.id, 'Seed', COALESCE(m.soul, ''), NULL, 1,
         CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000
  FROM user u LEFT JOIN memory m ON m.user_id = u.id;

UPDATE chats SET bot_id = (SELECT b.id FROM bots b WHERE b.user_id = chats.user_id AND b.is_default = 1) WHERE bot_id IS NULL;

CREATE INDEX idx_chats_bot ON chats(bot_id);

ALTER TABLE memory DROP COLUMN soul;
