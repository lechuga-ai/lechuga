-- Public chats are read-only for everyone but the owner and the people the
-- owner shared them with (sharing.ts, chatAccess's reader role). Until now,
-- typing in a public chat added you to it, which chat.ts recorded as a
-- member whose added_by is themselves; nothing else ever wrote such a row.
-- Those people weren't chosen by the owner, so they stop being members
-- here. They can still read the chat, and what they wrote keeps their name,
-- which is what a stamped row is for.
--
-- Safe to run on a tier with existing data. Run once per tier.

UPDATE chat_members SET removed_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE removed_at IS NULL AND added_by = user_id;
