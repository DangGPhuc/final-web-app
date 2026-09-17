-- Run as dedicated migration owner, never as web runtime or app login role.
BEGIN;

-- 1. Create separate login role for application connection pooling
-- Characteristics: LOGIN, NOINHERIT, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOBYPASSRLS
-- Must have NO direct application table privileges.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fintrack_app_login') THEN
    CREATE ROLE fintrack_app_login LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END $$;

-- Revoke any default schema/table permissions on public/fintrack
REVOKE ALL ON SCHEMA fintrack FROM fintrack_app_login;
GRANT USAGE ON SCHEMA fintrack TO fintrack_app_login;

-- Allow fintrack_app_login to execute SET ROLE fintrack_runtime
GRANT fintrack_runtime TO fintrack_app_login;

-- 2. Schema migrations tracking table for checksum verification
CREATE TABLE IF NOT EXISTS fintrack.schema_migrations (
  version text PRIMARY KEY,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE fintrack.schema_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE fintrack.schema_migrations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS schema_migrations_read ON fintrack.schema_migrations;
CREATE POLICY schema_migrations_read ON fintrack.schema_migrations FOR SELECT TO fintrack_runtime USING (true);
GRANT SELECT ON fintrack.schema_migrations TO fintrack_runtime;

COMMIT;
