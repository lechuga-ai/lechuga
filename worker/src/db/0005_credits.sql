-- Phase 3: prepaid credits. 1 credit = $0.0001, whole numbers only.
--
-- credit_ledger is the record: one row per change to anyone's credits, only
-- ever inserted. user.balance is the running total, kept so the check before
-- each message is one cheap read. The two are always written in the same D1
-- batch (worker/src/credits.ts); check_balances.sql reports any drift.
-- Additive, apart from the starter grant at the bottom. Run once per tier.

ALTER TABLE user ADD COLUMN balance INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user ADD COLUMN stripe_customer_id TEXT;
-- NULL (never subscribed) | 'active' | 'cancelled'
ALTER TABLE user ADD COLUMN subscription_status TEXT;

-- What the reply cost, so the line under each message matches its ledger row.
ALTER TABLE messages ADD COLUMN credits INTEGER;

CREATE TABLE credit_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL,
  -- signup_bonus | purchase | subscription | message | refund | manual
  reason TEXT NOT NULL,
  -- What caused the row: the user id for signup_bonus, the Stripe session,
  -- invoice or charge id for money, the message id for a message.
  ref TEXT,
  model TEXT,
  chat_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_ledger_user_created ON credit_ledger(user_id, created_at);
CREATE INDEX idx_ledger_chat ON credit_ledger(chat_id);
-- Stripe delivers events more than once. A second insert with the same
-- reason and ref fails here, and the batch it's in (with the balance update)
-- fails with it, so nothing is credited twice.
CREATE UNIQUE INDEX idx_ledger_reason_ref ON credit_ledger(reason, ref) WHERE ref IS NOT NULL;

-- Accounts that already exist get the same starter balance a new one does
-- (config.json starter_credits, 5000 when this was written).
INSERT INTO credit_ledger (id, user_id, delta, reason, ref, created_at)
  SELECT lower(hex(randomblob(16))), id, 5000, 'signup_bonus', id, CAST(strftime('%s', 'now') AS INTEGER) * 1000 FROM user;
UPDATE user SET balance = 5000;
