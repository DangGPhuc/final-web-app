-- FinTrack Migration 006 — Auth Identity, OAuth State, and Auth Runtime Role Isolation
-- Invariant: Migrations 004+ must NOT contain top-level transaction control (BEGIN/COMMIT).
-- The migration runner manages transaction atomicity across DDL and checksum bookkeeping.

-- 1. Create separate auth runtime and login roles if not already present
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fintrack_auth_runtime') THEN
    CREATE ROLE fintrack_auth_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fintrack_auth_login') THEN
    CREATE ROLE fintrack_auth_login LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END $$;

ALTER ROLE fintrack_auth_runtime WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
ALTER ROLE fintrack_auth_login WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;

-- Allow fintrack_auth_login to execute SET LOCAL ROLE fintrack_auth_runtime
GRANT fintrack_auth_runtime TO fintrack_auth_login;

-- Schema usage
REVOKE ALL ON SCHEMA fintrack FROM fintrack_auth_login;
GRANT USAGE ON SCHEMA fintrack TO fintrack_auth_runtime;

-- 2. Create auth_identities table
CREATE TABLE IF NOT EXISTS fintrack.auth_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES fintrack.users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (length(provider) BETWEEN 1 AND 50),
  provider_subject text NOT NULL CHECK (length(provider_subject) BETWEEN 1 AND 255),
  email text CHECK (email IS NULL OR (length(email) BETWEEN 3 AND 255 AND email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  email_verified boolean NOT NULL DEFAULT false,
  display_name text CHECK (display_name IS NULL OR length(display_name) <= 255),
  avatar_url text CHECK (avatar_url IS NULL OR (length(avatar_url) <= 2048 AND avatar_url ~* '^https?://')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_auth_identities_provider_subject UNIQUE (provider, provider_subject)
);

CREATE INDEX IF NOT EXISTS idx_auth_identities_user_id ON fintrack.auth_identities (user_id);
CREATE INDEX IF NOT EXISTS idx_auth_identities_provider_sub ON fintrack.auth_identities (provider, provider_subject);

-- 3. Create oauth_login_states table
CREATE TABLE IF NOT EXISTS fintrack.oauth_login_states (
  state_hash text PRIMARY KEY CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  provider text NOT NULL CHECK (length(provider) BETWEEN 1 AND 50),
  code_verifier text NOT NULL CHECK (length(code_verifier) BETWEEN 43 AND 128),
  nonce_hash text NOT NULL CHECK (nonce_hash ~ '^[0-9a-f]{64}$'),
  redirect_path text NOT NULL CHECK (length(redirect_path) <= 1024),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oauth_login_states_expires_at ON fintrack.oauth_login_states (expires_at);
CREATE INDEX IF NOT EXISTS idx_oauth_login_states_consumed_at ON fintrack.oauth_login_states (consumed_at) WHERE consumed_at IS NOT NULL;

-- 4. Enable Row-Level Security on new tables and fintrack.users
ALTER TABLE fintrack.auth_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE fintrack.auth_identities FORCE ROW LEVEL SECURITY;

ALTER TABLE fintrack.oauth_login_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE fintrack.oauth_login_states FORCE ROW LEVEL SECURITY;

ALTER TABLE fintrack.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE fintrack.users FORCE ROW LEVEL SECURITY;

-- 5. Policies for fintrack_auth_runtime
DROP POLICY IF EXISTS auth_identities_auth ON fintrack.auth_identities;
CREATE POLICY auth_identities_auth ON fintrack.auth_identities TO fintrack_auth_runtime
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS oauth_states_auth ON fintrack.oauth_login_states;
CREATE POLICY oauth_states_auth ON fintrack.oauth_login_states TO fintrack_auth_runtime
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS users_auth ON fintrack.users;
CREATE POLICY users_auth ON fintrack.users TO fintrack_auth_runtime
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS sessions_auth ON fintrack.sessions;
CREATE POLICY sessions_auth ON fintrack.sessions TO fintrack_auth_runtime
  USING (true) WITH CHECK (true);

-- Policies for fintrack_runtime (financial session user: SELECT only their own user and auth profile)
DROP POLICY IF EXISTS auth_identities_tenant ON fintrack.auth_identities;
CREATE POLICY auth_identities_tenant ON fintrack.auth_identities FOR SELECT TO fintrack_runtime
  USING (user_id = fintrack.current_session_user_id());

DROP POLICY IF EXISTS users_tenant ON fintrack.users;
CREATE POLICY users_tenant ON fintrack.users FOR SELECT TO fintrack_runtime
  USING (id = fintrack.current_session_user_id());

-- 6. Grant minimum privileges to fintrack_auth_runtime
GRANT SELECT, INSERT ON fintrack.users TO fintrack_auth_runtime;
GRANT SELECT, INSERT ON fintrack.auth_identities TO fintrack_auth_runtime;
GRANT UPDATE (email, email_verified, display_name, avatar_url, last_login_at) ON fintrack.auth_identities TO fintrack_auth_runtime;

GRANT SELECT, INSERT ON fintrack.oauth_login_states TO fintrack_auth_runtime;
GRANT UPDATE (consumed_at) ON fintrack.oauth_login_states TO fintrack_auth_runtime;

GRANT SELECT, INSERT ON fintrack.sessions TO fintrack_auth_runtime;
GRANT UPDATE (revoked_at) ON fintrack.sessions TO fintrack_auth_runtime;

-- 7. Grant SELECT only on users and auth_identities to fintrack_runtime
GRANT SELECT ON fintrack.users TO fintrack_runtime;
GRANT SELECT ON fintrack.auth_identities TO fintrack_runtime;

-- Strip direct DML privileges from login roles
REVOKE ALL ON ALL TABLES IN SCHEMA fintrack FROM fintrack_auth_login;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA fintrack FROM fintrack_auth_login;
REVOKE ALL ON ALL ROUTINES IN SCHEMA fintrack FROM fintrack_auth_login;
