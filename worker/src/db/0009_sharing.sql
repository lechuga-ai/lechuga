-- Shared chats and profiles.
--
-- A chat still has one owner (chats.user_id), who pays for every reply in it.
-- chat_members lists the other people the owner has let in. Removing someone
-- stamps removed_at instead of deleting the row, so what they wrote stays
-- attributed to them while they lose sight of the chat; adding them again
-- clears the stamp.
--
-- Can't be re-run (SQLite has no ADD COLUMN IF NOT EXISTS). Run once per tier,
-- before the deploy that needs it.

CREATE TABLE chat_members (
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  added_by TEXT REFERENCES user(id) ON DELETE SET NULL,
  added_at INTEGER NOT NULL,
  removed_at INTEGER,
  PRIMARY KEY (chat_id, user_id)
);

CREATE INDEX idx_chat_members_user ON chat_members(user_id);

-- A share with an email address that has no account yet. It becomes a
-- chat_members row when that address signs up (auth.ts, user.create.after).
CREATE TABLE chat_pending_shares (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  email TEXT NOT NULL,                        -- stored lowercase
  added_by TEXT REFERENCES user(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (chat_id, email)
);

CREATE INDEX idx_chat_pending_shares_email ON chat_pending_shares(email);

-- Who typed each user turn. NULL on everything from before sharing, which
-- was always the chat's owner. Not a foreign key: the words stay if the
-- account goes.
ALTER TABLE messages ADD COLUMN user_id TEXT;

-- Profile photos: a small square JPEG the browser has already scaled down,
-- as a data URL. Kept out of the user row so session reads stay light.
CREATE TABLE avatars (
  user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
