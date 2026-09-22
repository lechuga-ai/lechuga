-- The home page's one free chat, for visitors without an account. Nothing
-- about the conversation is stored: only that a visitor used a trial on a
-- given day, so the limits in config.json ("trial") can be enforced.
-- visitor is a salted hash of the IP address and the day, never the address
-- itself, so rows can't be tied to a person or linked across days.
-- Additive. Run once per tier.
CREATE TABLE trial_uses (
  id TEXT PRIMARY KEY,
  visitor TEXT NOT NULL,
  day TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_trial_day_visitor ON trial_uses(day, visitor);
