-- Not a migration; safe to run any time. Lists every account whose cached
-- balance differs from the sum of its ledger rows. No rows means no drift.
SELECT u.id, u.username, u.balance, COALESCE(SUM(l.delta), 0) AS ledger_total
FROM user u
LEFT JOIN credit_ledger l ON l.user_id = u.id
GROUP BY u.id
HAVING u.balance != COALESCE(SUM(l.delta), 0);
