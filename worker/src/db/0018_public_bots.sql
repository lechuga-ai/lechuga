-- Public bots (public.ts). A bot's owner can make it public: anyone signed
-- in can find it and chat with it, and every chat with it, the ones so far
-- and every one from then on, is a public chat (chats.visibility), read by
-- anyone and paid for by the house account. For keeps.
--
-- Additive and safe to run on a tier with existing data. Run once per tier.

ALTER TABLE bots ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private';
