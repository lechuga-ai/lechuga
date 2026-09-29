-- Memory: what Lechuga keeps about a person across their chats, and how
-- they'd like it to be with them. One row per person, two short documents.
--
--   notes    facts and context worth having in every chat: who they are,
--            what they're working on, lasting preferences. Written by the
--            model ("Remember this chat", or its remember tool) and edited
--            by the person under Account > Memory.
--   soul     how to be with them: tone, length, manner. Same sources.
--   enabled  0 turns it off without losing it: nothing is sent to the model
--            and nothing new is written.
--   nightly  1 lets the overnight pass (nightly.ts) read the day's private
--            chats and fold what's lasting into both. trained_at is when it
--            last did, so each pass starts where the previous one ended.
--
-- Both documents go into the system prompt of the person's private chats
-- only (chat.ts), never a shared one, since anyone in a shared chat can get
-- the model to say what it was told. Sizes are capped in config.json
-- (limits.memory_chars); every reply re-reads them and pays for it.
--
-- Additive and safe to run on a tier with existing data. Run once per tier.

CREATE TABLE memory (
  user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
  notes TEXT NOT NULL DEFAULT '',
  soul TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  nightly INTEGER NOT NULL DEFAULT 1,
  trained_at INTEGER,
  updated_at INTEGER NOT NULL
);
