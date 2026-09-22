-- Phase 2: replace the placeholder `users` table with Better Auth's schema.
-- Cynthia chose to drop dev data rather than migrate it, since it all
-- belonged to the hardcoded Phase 1 "dev" user and has no real owner.
--
-- Two conventions live side by side here, on purpose:
--   * Better Auth's own tables (user, session, account, verification) use
--     its default camelCase column names and store dates as ISO-8601 text
--     (its SQLite adapter calls toISOString()), so the DATE type below is
--     what Better Auth's own schema generator emits for SQLite.
--   * Columns this app manages itself (the Phase 2b ones on `user`, and all
--     of chats/messages) keep the repo's snake_case + epoch-ms INTEGER style.

-- Children before parents. The Better Auth tables are dropped too so this
-- file can be re-run on a database where an earlier attempt half-applied.
DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS chats;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS verification;
DROP TABLE IF EXISTS account;
DROP TABLE IF EXISTS session;
DROP TABLE IF EXISTS user;

-- Better Auth core tables (default model and field names) ----------------

CREATE TABLE user (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  emailVerified INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  createdAt DATE NOT NULL,
  updatedAt DATE NOT NULL,

  -- Reserved for Phase 2b (plan v3, section 4, step 1). Nullable or
  -- defaulted now so 2b needs no further schema change. App-managed:
  -- the default invite count is meant to come from config.json; the SQL
  -- default is only a fallback.
  username TEXT UNIQUE,
  username_set_at INTEGER,
  invites_remaining INTEGER NOT NULL DEFAULT 5,
  invited_by TEXT REFERENCES user(id)
);

CREATE TABLE session (
  id TEXT PRIMARY KEY,
  expiresAt DATE NOT NULL,
  token TEXT NOT NULL UNIQUE,
  createdAt DATE NOT NULL,
  updatedAt DATE NOT NULL,
  ipAddress TEXT,
  userAgent TEXT,
  userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE
);

CREATE INDEX idx_session_user ON session(userId);

CREATE TABLE account (
  id TEXT PRIMARY KEY,
  accountId TEXT NOT NULL,
  providerId TEXT NOT NULL,
  userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  accessToken TEXT,
  refreshToken TEXT,
  idToken TEXT,
  accessTokenExpiresAt DATE,
  refreshTokenExpiresAt DATE,
  scope TEXT,
  password TEXT,
  createdAt DATE NOT NULL,
  updatedAt DATE NOT NULL
);

CREATE INDEX idx_account_user ON account(userId);

CREATE TABLE verification (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expiresAt DATE NOT NULL,
  createdAt DATE NOT NULL,
  updatedAt DATE NOT NULL
);

CREATE INDEX idx_verification_identifier ON verification(identifier);

-- App tables, recreated empty and re-pointed at the new user table -------

CREATE TABLE chats (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  project_id TEXT,
  title TEXT,
  model TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_chats_user_updated ON chats(user_id, updated_at);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  model TEXT,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_messages_chat ON messages(chat_id);
