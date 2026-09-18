-- FinTrack Migration 007 — Auth Security Hardening & Privilege Narrowing
-- Invariant: Migrations 004+ must NOT contain top-level transaction control (BEGIN/COMMIT).
-- The migration runner manages transaction atomicity across DDL and checksum bookkeeping.

-- 1. Invalidate ephemeral in-flight OAuth login states before adding browser binding constraint
DELETE FROM fintrack.oauth_login_states;

-- 2. Add browser binding SHA-256 hash to bind login state to initiating browser
ALTER TABLE fintrack.oauth_login_states
  ADD COLUMN browser_bind_hash text NOT NULL CHECK (browser_bind_hash ~ '^[0-9a-f]{64}$');

CREATE INDEX IF NOT EXISTS idx_oauth_login_states_bind_expires
  ON fintrack.oauth_login_states (browser_bind_hash, expires_at);

-- 3. Narrow fintrack_auth_runtime privileges on users:
-- Auth creation generates UUID server-side; auth runtime only needs INSERT, never SELECT all users.
REVOKE SELECT ON fintrack.users FROM fintrack_auth_runtime;
GRANT REFERENCES (id) ON fintrack.users TO fintrack_auth_runtime;

DROP POLICY IF EXISTS users_auth ON fintrack.users;
CREATE POLICY users_auth_insert ON fintrack.users FOR INSERT TO fintrack_auth_runtime
  WITH CHECK (true);

-- 4. Narrow fintrack_auth_runtime privileges on sessions:
-- Auth runtime needs INSERT for new sessions, and SELECT/UPDATE only on the session matching app.auth_revoke_hash.
DROP POLICY IF EXISTS sessions_auth ON fintrack.sessions;

CREATE POLICY sessions_auth_insert ON fintrack.sessions FOR INSERT TO fintrack_auth_runtime
  WITH CHECK (true);

CREATE POLICY sessions_auth_select ON fintrack.sessions FOR SELECT TO fintrack_auth_runtime
  USING (token_hash = nullif(current_setting('app.auth_revoke_hash', true), ''));

CREATE POLICY sessions_auth_revoke ON fintrack.sessions FOR UPDATE TO fintrack_auth_runtime
  USING (
    token_hash = nullif(current_setting('app.auth_revoke_hash', true), '')
    AND revoked_at IS NULL
    AND expires_at > now()
  )
  WITH CHECK (
    token_hash = nullif(current_setting('app.auth_revoke_hash', true), '')
    AND revoked_at IS NOT NULL
  );

-- 5. Re-assert strict zero direct DML table privileges on login roles
REVOKE ALL ON ALL TABLES IN SCHEMA fintrack FROM fintrack_auth_login;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA fintrack FROM fintrack_auth_login;
REVOKE ALL ON ALL ROUTINES IN SCHEMA fintrack FROM fintrack_auth_login;
