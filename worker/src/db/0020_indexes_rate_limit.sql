-- Two things, both additive. Run once per tier, local then dev then prod,
-- before the deploy that needs it (auth.ts expects the table).
--
-- 1. Indexes on messages. Every message sent runs the activity checks in
--    chat.ts (today's count, the last minute, replies in flight) and, in a
--    public chat, public.ts's count of the person's public messages. Two of
--    those filter messages by who typed them, and until now the only index
--    was by chat, so each one read the whole table. Every read of a chat
--    orders by created_at within the chat, so the chat index widens to
--    cover that too and the old one goes.
--
-- 2. Better Auth's rate-limit table (auth.ts, rateLimit.storage =
--    "database"): one row per client and window. The names are Better
--    Auth's own (camelCase, like its other tables in 0002_auth.sql).

CREATE INDEX idx_messages_user_created ON messages(user_id, created_at);
CREATE INDEX idx_messages_chat_created ON messages(chat_id, created_at);
DROP INDEX idx_messages_chat;

CREATE TABLE rateLimit (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  count INTEGER NOT NULL,
  lastRequest INTEGER NOT NULL
);

CREATE INDEX idx_rate_limit_key ON rateLimit(key);
