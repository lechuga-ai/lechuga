-- Phase 4 (admin + hardening): what each ledger row cost us and what it
-- brought in, so /admin can show spend, payments and gifts per account
-- without depending on messages (which go when a chat is deleted).
--
--   prompt_tokens, completion_tokens, cost_usd   on 'message' rows: the
--       gateway's token counts and what Cloudflare charged us for them
--   paid_cents   on 'purchase' and 'subscription' rows: money in; negative
--       on 'refund' rows
--   note         on 'manual' rows: who granted it and why
--   user.suspended_at   set from /admin; a suspended account can read its
--       chats but not send messages
--
-- SQLite has no ADD COLUMN IF NOT EXISTS, so this can't be made re-runnable:
-- a second run stops at the first ALTER with "duplicate column name", having
-- changed nothing. Run once per tier, BEFORE deploying the code that needs it
-- (chat.ts writes the new columns on every reply).

ALTER TABLE credit_ledger ADD COLUMN prompt_tokens INTEGER;
ALTER TABLE credit_ledger ADD COLUMN completion_tokens INTEGER;
ALTER TABLE credit_ledger ADD COLUMN cost_usd REAL;
ALTER TABLE credit_ledger ADD COLUMN paid_cents INTEGER;
ALTER TABLE credit_ledger ADD COLUMN note TEXT;
ALTER TABLE user ADD COLUMN suspended_at INTEGER;

-- Backfill replies whose message still exists, from its token counts and
-- Cloudflare's price per million tokens for that model (September 2026).
UPDATE credit_ledger SET
  prompt_tokens = (SELECT m.prompt_tokens FROM messages m WHERE m.id = credit_ledger.ref),
  completion_tokens = (SELECT m.completion_tokens FROM messages m WHERE m.id = credit_ledger.ref)
WHERE reason = 'message';

UPDATE credit_ledger SET cost_usd = (
  COALESCE(prompt_tokens, 0) * CASE model
    WHEN '@cf/zai-org/glm-5.3-flash' THEN 0.15
    WHEN '@cf/zai-org/glm-5.3' THEN 1.40
    WHEN '@cf/deepseek-ai/deepseek-v4-flash-0731' THEN 0.44
    WHEN '@cf/openai/gpt-oss-20b' THEN 0.20
    WHEN '@cf/openai/gpt-oss-120b' THEN 0.35
    ELSE 0.15 END
  + COALESCE(completion_tokens, 0) * CASE model
    WHEN '@cf/zai-org/glm-5.3-flash' THEN 0.50
    WHEN '@cf/zai-org/glm-5.3' THEN 4.40
    WHEN '@cf/deepseek-ai/deepseek-v4-flash-0731' THEN 1.32
    WHEN '@cf/openai/gpt-oss-20b' THEN 0.30
    WHEN '@cf/openai/gpt-oss-120b' THEN 0.75
    ELSE 0.50 END
  ) / 1000000.0
WHERE reason = 'message' AND completion_tokens IS NOT NULL;

-- Replies whose message is gone (chat deleted): estimate from what we
-- charged, at the current 2x markup. Slightly low for rows from the 3x days.
UPDATE credit_ledger SET cost_usd = -delta * 0.0001 / 2.0
WHERE reason = 'message' AND cost_usd IS NULL;

-- Money in so far: a leaf is 50,000 credits for $5, a head 110,000 for $10,
-- a month 50,000 for $5.
UPDATE credit_ledger SET paid_cents = CASE delta WHEN 110000 THEN 1000 ELSE 500 END
WHERE reason IN ('purchase', 'subscription');

-- Refunds: a refund row's ref is "<charge id>:<cents refunded so far>", so
-- the money this row gave back is that running total less the running total
-- on the charge's previous refund row.
UPDATE credit_ledger SET paid_cents = -(
  CAST(substr(ref, instr(ref, ':') + 1) AS INTEGER)
  - COALESCE((
      SELECT MAX(CAST(substr(earlier.ref, instr(earlier.ref, ':') + 1) AS INTEGER))
      FROM credit_ledger earlier
      WHERE earlier.reason = 'refund'
        AND substr(earlier.ref, 1, instr(earlier.ref, ':')) = substr(credit_ledger.ref, 1, instr(credit_ledger.ref, ':'))
        AND earlier.created_at < credit_ledger.created_at
    ), 0)
)
WHERE reason = 'refund' AND instr(ref, ':') > 0;

-- Hand-made grants from before this page existed kept their reason in ref.
UPDATE credit_ledger SET note = ref WHERE reason = 'manual' AND note IS NULL;
