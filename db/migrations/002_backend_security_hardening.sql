-- Run as dedicated migration owner, never as web runtime role.
BEGIN;

-- 1. Helper function to derive user_id securely from the active session
-- Security invoker uses fintrack_runtime's SELECT permission on fintrack.sessions (guarded by session_lookup policy).
CREATE OR REPLACE FUNCTION fintrack.current_session_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = fintrack, pg_temp
AS $$
  SELECT user_id
  FROM fintrack.sessions
  WHERE token_hash = nullif(current_setting('app.session_hash', true), '')
    AND revoked_at IS NULL
    AND expires_at > now()
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION fintrack.current_session_user_id() TO fintrack_runtime;

-- 2. Update tenant RLS policies on tables to use current_session_user_id()
-- Drop previous policies that trusted app.user_id
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['wallets','transfers','idempotency','audit_events','rate_limits'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant ON fintrack.%I', t);
  END LOOP;
END $$;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['wallets','transfers','idempotency','audit_events'] LOOP
    EXECUTE format('CREATE POLICY tenant ON fintrack.%I TO fintrack_runtime USING (user_id = fintrack.current_session_user_id()) WITH CHECK (user_id = fintrack.current_session_user_id())', t);
  END LOOP;
END $$;

-- 3. Redesign rate_limits table for bounded storage per user and scope
-- Drops old unbounded table (user_id, bucket) and introduces (user_id, scope) primary key.
DROP TABLE IF EXISTS fintrack.rate_limits;
CREATE TABLE fintrack.rate_limits (
  user_id uuid NOT NULL REFERENCES fintrack.users ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('global', 'wallet:create', 'transfer:create')),
  bucket bigint NOT NULL,
  hits integer NOT NULL CHECK (hits > 0),
  PRIMARY KEY (user_id, scope)
);
ALTER TABLE fintrack.rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE fintrack.rate_limits FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON fintrack.rate_limits TO fintrack_runtime
  USING (user_id = fintrack.current_session_user_id())
  WITH CHECK (user_id = fintrack.current_session_user_id());
GRANT SELECT, INSERT, UPDATE ON fintrack.rate_limits TO fintrack_runtime;

-- 4. Audit events correlation with request_id
ALTER TABLE fintrack.audit_events ADD COLUMN IF NOT EXISTS request_id uuid;

-- 5. Session lookup and revocation policies
-- Refine session_lookup to allow fintrack_runtime to read its own session by token_hash
DROP POLICY IF EXISTS session_lookup ON fintrack.sessions;
CREATE POLICY session_lookup ON fintrack.sessions FOR SELECT TO fintrack_runtime
  USING (token_hash = nullif(current_setting('app.session_hash', true), ''));

-- Grant minimal column-level UPDATE to fintrack_runtime to allow revoking the active session
GRANT UPDATE (revoked_at) ON fintrack.sessions TO fintrack_runtime;

-- RLS policy to allow fintrack_runtime to only update the active session matching app.session_hash
DROP POLICY IF EXISTS session_revoke ON fintrack.sessions;
CREATE POLICY session_revoke ON fintrack.sessions FOR UPDATE TO fintrack_runtime
  USING (token_hash = nullif(current_setting('app.session_hash', true), ''))
  WITH CHECK (token_hash = nullif(current_setting('app.session_hash', true), ''));

-- 6. Idempotency storage indexing and capacity support
CREATE INDEX IF NOT EXISTS idempotency_user_created_at_idx ON fintrack.idempotency (user_id, created_at);

COMMIT;
