-- Phase 5 (dashboard): one row per tool the model runs, so /admin can show
-- what we're spending on the services outside Cloudflare — today Brave, whose
-- free tier is 2,000 searches a month and worth not walking past.
--
-- Deliberately no query text. A search is counted, not recorded: we keep who
-- searched, when, and what it cost, and never what they typed. read_page
-- keeps the hostname only, never the full address, because a URL's path and
-- query string carry things a hostname doesn't (a document id, a token, a
-- name). If that ever needs to change it is a decision to take on purpose,
-- not a column to quietly start filling.
--
--   user_id    who asked. Their account going takes these rows with it.
--   payer_id   who was charged, which is the chat's owner: the same seam as
--              credit_ledger, so a public chat later bills the right person.
--   chat_id    not a foreign key, on purpose: a deleted chat shouldn't erase
--              what its searches cost us, the same way credit_ledger keeps
--              its message rows.
--   ok         0 when the service refused or broke. Brave counts those too.
--
-- Additive and safe to run on a tier with existing data. Run once per tier.

CREATE TABLE tool_calls (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  payer_id TEXT NOT NULL,
  chat_id TEXT,
  message_id TEXT,
  -- web_search | read_page, and whatever joins TOOLS later.
  tool TEXT NOT NULL,
  -- read_page only, and only ever the hostname.
  host TEXT,
  ok INTEGER NOT NULL DEFAULT 1,
  cost_usd REAL NOT NULL DEFAULT 0,
  credits INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- The dashboard reads by day across everyone, then by person within a window.
CREATE INDEX idx_tool_calls_created ON tool_calls(created_at);
CREATE INDEX idx_tool_calls_user ON tool_calls(user_id, created_at);
CREATE INDEX idx_tool_calls_tool ON tool_calls(tool, created_at);
