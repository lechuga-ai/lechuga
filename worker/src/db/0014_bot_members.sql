-- Shared bots (lechuga-ops/lechuga-bots-plan.md, step 2). A bot still has
-- one owner (bots.user_id), who pays for every chat with it, sees every
-- chat with it, and sets its soul. bot_members are the other people the
-- owner has let in: each can chat with it and sees their own chats, and is
-- told the owner can read them. Same shape as chat_members (0009):
-- removing someone stamps removed_at instead of deleting the row, so their
-- chats keep their name; adding them again clears the stamp.
--
-- Additive and safe to run on a tier with existing data. Run once per tier.

CREATE TABLE bot_members (
  bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  added_by TEXT REFERENCES user(id) ON DELETE SET NULL,
  added_at INTEGER NOT NULL,
  removed_at INTEGER,
  PRIMARY KEY (bot_id, user_id)
);

CREATE INDEX idx_bot_members_user ON bot_members(user_id);

-- A share with an email address that has no account yet. It becomes a
-- bot_members row when that address signs up (auth.ts, user.create.after).
CREATE TABLE bot_pending_shares (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  added_by TEXT REFERENCES user(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (bot_id, email)
);

CREATE INDEX idx_bot_pending_shares_email ON bot_pending_shares(email);
