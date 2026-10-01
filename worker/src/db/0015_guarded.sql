-- Guarded bots (lechuga-ops/lechuga-bots-plan.md, step 3). A switch on a
-- bot, its owner's to flip: a locked section joins the system prompt, every
-- incoming message is checked first (guard.ts), search and page reading are
-- off, and low effort is raised. guard_events keeps what the check caught:
-- which bot, which chat, who typed, what kind. Never the words themselves;
-- the owner can read the chat, and that's where the words are.
--
-- Additive and safe to run on a tier with existing data. Run once per tier.

ALTER TABLE bots ADD COLUMN guarded INTEGER NOT NULL DEFAULT 0;

CREATE TABLE guard_events (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  chat_id TEXT,
  user_id TEXT NOT NULL,
  -- self_harm | violence | explicit
  category TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_guard_events_bot ON guard_events(bot_id, created_at);
