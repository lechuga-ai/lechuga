-- Phase 2b: invites, requests inbox, and the two chat columns reserved for
-- public chats (plan v3, section 9). The username columns already exist on
-- `user` from 0002. Additive only; nothing is dropped.

CREATE TABLE invites (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,                        -- stored lowercase
  inviter_id TEXT REFERENCES user(id) ON DELETE SET NULL,  -- NULL = admin/approval
  status TEXT NOT NULL DEFAULT 'pending',     -- pending | accepted | revoked
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  accepted_at INTEGER
);

CREATE INDEX idx_invites_email ON invites(email);
CREATE INDEX idx_invites_inviter ON invites(inviter_id);

CREATE TABLE requests (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,                         -- access | feedback | support
  email TEXT NOT NULL,                        -- stored lowercase
  username TEXT,
  user_id TEXT REFERENCES user(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',        -- open | approved | declined | replied | closed
  admin_note TEXT,
  reply TEXT,                                 -- the message sent back, if any
  created_at INTEGER NOT NULL,
  handled_at INTEGER,
  handled_by TEXT REFERENCES user(id) ON DELETE SET NULL
);

CREATE INDEX idx_requests_status_created ON requests(status, created_at);

-- Reserved now so public chats need no schema change later. No UI yet.
ALTER TABLE chats ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private';
ALTER TABLE chats ADD COLUMN slug TEXT;
CREATE UNIQUE INDEX idx_chats_slug ON chats(slug) WHERE slug IS NOT NULL;
