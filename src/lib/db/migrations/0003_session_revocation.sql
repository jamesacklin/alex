-- Session revocation support (F05).
--
-- `session_version` is bumped whenever an account's authority changes
-- (password reset, role change, deactivation).  Issued JWTs carry the
-- version they were minted with; `authSession()` rejects a token whose
-- version no longer matches the stored value, so a captured session
-- stops working at the next protected operation.
--
-- `disabled_at` marks an account as deactivated without deleting it.
-- A disabled account can neither log in nor use an existing session.
ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN disabled_at INTEGER;
