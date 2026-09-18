-- FinTrack Migration 005 — Monotonic Session Revocation Hardening
-- Invariant: Migrations 004+ must NOT contain top-level transaction control (BEGIN/COMMIT).
-- The migration runner manages transaction atomicity across DDL and checksum bookkeeping.

-- 1. Drop existing session policies
DROP POLICY IF EXISTS session_lookup ON fintrack.sessions;
DROP POLICY IF EXISTS session_revoke ON fintrack.sessions;

-- 2. Session lookup policy for SELECT:
-- Runtime role can only select session matching current app.session_hash.
-- Note: Per PostgreSQL RLS semantics, UPDATE commands evaluate SELECT policy USING expressions
-- on the new row; keeping the SELECT policy scoped to token_hash allows monotonic revocation to
-- transition revoked_at from NULL to non-NULL without triggering false-positive RLS violations on UPDATE.
CREATE POLICY session_lookup ON fintrack.sessions FOR SELECT TO fintrack_runtime
  USING (
    token_hash = nullif(current_setting('app.session_hash', true), '')
  );

-- 3. Monotonic session revocation policy for UPDATE:
-- USING: can only target an active, unrevoked, unexpired session matching app.session_hash
-- WITH CHECK: the updated row MUST preserve token_hash and MUST have revoked_at IS NOT NULL
CREATE POLICY session_revoke ON fintrack.sessions FOR UPDATE TO fintrack_runtime
  USING (
    token_hash = nullif(current_setting('app.session_hash', true), '')
    AND revoked_at IS NULL
    AND expires_at > now()
  )
  WITH CHECK (
    token_hash = nullif(current_setting('app.session_hash', true), '')
    AND revoked_at IS NOT NULL
  );
