-- Seats (lechuga-ops/lechuga-bots-plan.md, step 3, the account half). An
-- account made by another account's holder for someone with no email
-- address, tied to one of the holder's bots. It signs in with a username
-- and a code (seats.ts), has no email of its own (a made-up address under
-- seat.lechuga.ai that never receives mail), no invites, no credits, and
-- sees only the bots shared with it.
--
--   seat_of  the account that made it and answers for it. Deleting that
--            account takes its seats with it.
--
-- Additive and safe to run on a tier with existing data. Run once per tier.

ALTER TABLE user ADD COLUMN seat_of TEXT REFERENCES user(id) ON DELETE CASCADE;

CREATE INDEX idx_user_seat_of ON user(seat_of);
