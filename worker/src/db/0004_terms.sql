-- Terms acceptance, recorded on the username step (the one screen every new
-- account passes through). Version comes from config.json terms_version, so a
-- later change of terms can ask everyone below the current version to accept
-- again. Additive.
ALTER TABLE user ADD COLUMN terms_accepted_at INTEGER;
ALTER TABLE user ADD COLUMN terms_version TEXT;
