-- Run once as a dedicated migration owner, never as the web runtime role.
BEGIN;
CREATE SCHEMA fintrack;
REVOKE ALL ON SCHEMA fintrack FROM PUBLIC;
CREATE ROLE fintrack_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA fintrack TO fintrack_runtime;
CREATE TABLE fintrack.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Only a trusted identity adapter/migration operator can issue/revoke sessions.
CREATE TABLE fintrack.sessions (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid NOT NULL REFERENCES fintrack.users ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE fintrack.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE fintrack.sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY session_lookup ON fintrack.sessions FOR SELECT TO fintrack_runtime
 USING (token_hash = current_setting('app.session_hash', true) AND revoked_at IS NULL AND expires_at > now());
GRANT SELECT ON fintrack.sessions TO fintrack_runtime;
CREATE INDEX ON fintrack.sessions (user_id);
CREATE TABLE fintrack.wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES fintrack.users ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  type text NOT NULL CHECK (type IN ('CASH','BANK','SAVINGS')),
  currency text NOT NULL DEFAULT 'VND' CHECK (currency = 'VND'),
  opening_balance bigint NOT NULL CHECK (opening_balance BETWEEN 0 AND 9000000000000000),
  balance bigint NOT NULL CHECK (balance BETWEEN 0 AND 9000000000000000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id,id)
);
CREATE INDEX ON fintrack.wallets (user_id,created_at,id);
CREATE TABLE fintrack.transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES fintrack.users ON DELETE CASCADE,
  from_wallet_id uuid NOT NULL,
  to_wallet_id uuid NOT NULL,
  amount bigint NOT NULL CHECK (amount BETWEEN 1 AND 9000000000000000),
  fee bigint NOT NULL CHECK (fee BETWEEN 0 AND 9000000000000000),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_wallet_id <> to_wallet_id),
  FOREIGN KEY (user_id,from_wallet_id) REFERENCES fintrack.wallets(user_id,id),
  FOREIGN KEY (user_id,to_wallet_id) REFERENCES fintrack.wallets(user_id,id)
);
CREATE INDEX ON fintrack.transfers (user_id,created_at,id);
CREATE TABLE fintrack.idempotency (
  user_id uuid NOT NULL REFERENCES fintrack.users ON DELETE CASCADE,
  key uuid NOT NULL,
  fingerprint text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,key)
);
CREATE TABLE fintrack.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES fintrack.users ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('WALLET_CREATED','TRANSFER_CREATED')),
  resource_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON fintrack.audit_events (user_id,created_at);
CREATE TABLE fintrack.rate_limits (
  user_id uuid NOT NULL REFERENCES fintrack.users ON DELETE CASCADE,
  bucket bigint NOT NULL,
  hits integer NOT NULL CHECK (hits > 0),
  PRIMARY KEY(user_id,bucket)
);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['wallets','transfers','idempotency','audit_events','rate_limits'] LOOP
    EXECUTE format('ALTER TABLE fintrack.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE fintrack.%I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY tenant ON fintrack.%I TO fintrack_runtime USING (user_id = nullif(current_setting(''app.user_id'',true),'''')::uuid) WITH CHECK (user_id = nullif(current_setting(''app.user_id'',true),'''')::uuid)',t);
  END LOOP;
END $$;
GRANT SELECT,INSERT ON fintrack.wallets,fintrack.transfers,fintrack.idempotency TO fintrack_runtime;
GRANT UPDATE(balance) ON fintrack.wallets TO fintrack_runtime;
GRANT INSERT ON fintrack.audit_events TO fintrack_runtime;
GRANT SELECT,INSERT,UPDATE ON fintrack.rate_limits TO fintrack_runtime;
-- No DELETE, TRUNCATE, DDL, session issuance, audit update or audit delete privileges.
COMMIT;
