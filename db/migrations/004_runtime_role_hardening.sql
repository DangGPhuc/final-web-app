-- FinTrack Migration 004 — Runtime Role Drift Hardening & Maintenance Indexes
-- Invariant: Migrations 004+ must NOT contain top-level transaction control (BEGIN/COMMIT).
-- The migration runner manages transaction atomicity across DDL and checksum bookkeeping.

-- 1. Enforce strict role attributes on runtime and login roles
ALTER ROLE fintrack_runtime WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
ALTER ROLE fintrack_app_login WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;

-- 2. Strip direct table, sequence, routine, and schema privileges from fintrack_app_login.
-- Application access is strictly mediated through SET LOCAL ROLE fintrack_runtime.
REVOKE ALL ON ALL TABLES IN SCHEMA fintrack FROM fintrack_app_login;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA fintrack FROM fintrack_app_login;
REVOKE ALL ON ALL ROUTINES IN SCHEMA fintrack FROM fintrack_app_login;
REVOKE USAGE ON SCHEMA fintrack FROM fintrack_app_login;

-- 3. Secure function execution: revoke PUBLIC execute on session identification
REVOKE EXECUTE ON FUNCTION fintrack.current_session_user_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fintrack.current_session_user_id() TO fintrack_runtime;

-- 4. Strip runtime and login access to schema migration metadata
REVOKE ALL ON TABLE fintrack.schema_migrations FROM fintrack_runtime, fintrack_app_login, PUBLIC;

-- 5. Maintenance cleanup indexes for out-of-band retention enforcement
-- Index on idempotency.created_at for global retention cleanup (>8 days)
CREATE INDEX IF NOT EXISTS idx_idempotency_created_at ON fintrack.idempotency (created_at);

-- Indexes on sessions for forensic retention cleanup (>30 days expired or revoked)
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON fintrack.sessions (expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_revoked_at ON fintrack.sessions (revoked_at) WHERE revoked_at IS NOT NULL;
