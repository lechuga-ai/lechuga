-- Public chats (lechuga-ops/lechuga-bots-plan.md, steps 4 and 5). The
-- visibility column has been on chats since 0003, reserved and unused;
-- public.ts starts setting it to 'public'. Anyone signed in can read a
-- public chat and join in, and a house account pays for the replies. This
-- index is for the browse page (newest public chats first) and for the
-- "asked before" lookup.
--
-- Additive and safe to run on a tier with existing data. Run once per tier.

CREATE INDEX idx_chats_public ON chats(visibility, updated_at);
