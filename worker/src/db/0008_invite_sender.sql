-- Which admin sent an invite that came from Lechuga rather than from an
-- account's own invites (the "send an invite" box and approved requests in
-- /admin). inviter_id stays NULL on those, so nobody's count is spent or
-- refunded; sent_by only records who pressed the button.
--
-- Can't be re-run (SQLite has no ADD COLUMN IF NOT EXISTS): a second run stops
-- at "duplicate column name" and changes nothing. Run once per tier before
-- deploying; until then only /admin's Invites tab is affected.
ALTER TABLE invites ADD COLUMN sent_by TEXT;
