#!/usr/bin/env bash
set -euo pipefail

# FinTrack Logical Backup & Restore Drill
# Validates pg_dump / restore, role independence, schema invariants, balances, RLS enforcement,
# and migration history preservation.
# NOTE: This drill tests database-level logical restoration. Because pg_dump does not serialize
# cluster-wide role definitions (pg_roles), cluster recovery requires bootstrapping application roles
# (fintrack_runtime, fintrack_app_login) via version-controlled migration/bootstrap logic.

# Safety Guard: Ensure test safety environment flag and disposable database names
if [ -z "${DATABASE_TEST_URL:-}" ] || [ -z "${DATABASE_RESTORE_URL:-}" ]; then
  echo "ERROR: DATABASE_TEST_URL and DATABASE_RESTORE_URL are strictly required." >&2
  echo "Destructive scripts refuse execution without explicit test database URLs." >&2
  exit 1
fi

# Strict safety validation and dedicated cluster verification before any destructive command
node scripts/validate-test-db.mjs "$DATABASE_TEST_URL" "$DATABASE_RESTORE_URL" "${DATABASE_MAINTENANCE_URL:-${DATABASE_TEST_URL%/*}/postgres}"

BASE_URL="$DATABASE_TEST_URL"
RESTORE_URL="$DATABASE_RESTORE_URL"
RESTORE_DB="$(node scripts/validate-test-db.mjs "$DATABASE_TEST_URL" "$DATABASE_RESTORE_URL" --print-restore-name)"
RESTORE_DB_QUOTED="$(node scripts/validate-test-db.mjs "$DATABASE_TEST_URL" "$DATABASE_RESTORE_URL" --print-quoted-restore-name)"

# Enforce secure temporary file creation with owner-only permissions (0600)
umask 077
BACKUP_FILE="$(mktemp -t fintrack_logical_backup_XXXXXX.sql)"

# Trap cleanup to ensure sensitive backup files and disposable DBs are dropped on exit/interruption
cleanup() {
  echo "=== [Cleanup] Removing temporary backup file & cleaning disposable databases ==="
  rm -f "$BACKUP_FILE"
  psql "${BASE_URL%/*}/postgres" -v ON_ERROR_STOP=0 -c "DROP DATABASE IF EXISTS ${RESTORE_DB_QUOTED};" -c "DROP DATABASE IF EXISTS \"fintrack_upgrade_test\";" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

# Verify owner-only permissions
PERMS="$(stat -c %a "$BACKUP_FILE" 2>/dev/null || stat -f %Lp "$BACKUP_FILE")"
if [ "$PERMS" != "600" ]; then
  echo "ERROR: Backup file permissions are $PERMS, expected 0600 (owner-only)!"
  exit 1
fi
echo "Verified: Temporary backup file created with owner-only permissions (0600)."

echo "=== [1/8] Initializing source database via production migration runner ==="
psql "${BASE_URL%/*}/postgres" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS ${RESTORE_DB_QUOTED};" -c "DROP DATABASE IF EXISTS \"fintrack_upgrade_test\";"
psql "$BASE_URL" -v ON_ERROR_STOP=1 -c "DROP SCHEMA IF EXISTS fintrack CASCADE; DO \$\$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fintrack_runtime') THEN DROP OWNED BY fintrack_runtime; DROP ROLE fintrack_runtime; END IF; IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fintrack_app_login') THEN DROP OWNED BY fintrack_app_login; DROP ROLE fintrack_app_login; END IF; END \$\$;"

# Initialize source database using PRODUCTION migration runner (not direct psql -f)
DATABASE_MAINTENANCE_URL="$BASE_URL" node scripts/migrate.mjs

# Verify source schema_migrations table has all expected repository migration checksums
node scripts/verify-migration-history.mjs "$BASE_URL"
echo "Verified: Source database initialized with full migration history and verified checksums."

echo "=== [2/8] Seeding representative domain state ==="
psql "$BASE_URL" -v ON_ERROR_STOP=1 <<'EOF'
BEGIN;
-- Seed users
INSERT INTO fintrack.users (id) VALUES
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');

-- Seed active sessions
INSERT INTO fintrack.sessions (token_hash, user_id, expires_at) VALUES
  ('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', now() + interval '1 hour'),
  ('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', now() + interval '1 hour');

-- Seed wallets
INSERT INTO fintrack.wallets (id, user_id, name, type, opening_balance, balance) VALUES
  ('aaaaaaaa-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'Alice Bank', 'BANK', 1000, 790),
  ('bbbbbbbb-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'Alice Cash', 'CASH', 0, 200),
  ('cccccccc-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222', 'Bob Savings', 'SAVINGS', 500, 500);

-- Seed transfer & audit event with request_id
INSERT INTO fintrack.transfers (id, user_id, from_wallet_id, to_wallet_id, amount, fee) VALUES
  ('dddddddd-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-1111-4111-8111-111111111111', 'bbbbbbbb-1111-4111-8111-111111111111', 200, 10);

INSERT INTO fintrack.audit_events (id, user_id, action, resource_id, request_id) VALUES
  ('eeeeeeee-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'WALLET_CREATED', 'aaaaaaaa-1111-4111-8111-111111111111', 'ffffffff-1111-4111-8111-111111111111'),
  ('ffffffff-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'TRANSFER_CREATED', 'dddddddd-1111-4111-8111-111111111111', 'ffffffff-1111-4111-8111-111111111111');
COMMIT;
EOF

echo "=== [3/8] Taking logical pg_dump ==="
pg_dump "$BASE_URL" --schema=fintrack --clean --if-exists --no-owner > "$BACKUP_FILE"

# Invariant check: Prove pg_dump does NOT serialize cluster-wide roles (pg_roles)
if grep -i "CREATE ROLE" "$BACKUP_FILE"; then
  echo "ERROR: Backup file unexpectedly contains CREATE ROLE!"
  exit 1
fi
echo "Verified: Logical backup does NOT carry cluster-global roles (bootstrap required on new clusters)."

echo "=== [4/8] Creating fresh isolated restore database ==="
psql "${BASE_URL%/*}/postgres" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS ${RESTORE_DB_QUOTED};"
psql "${BASE_URL%/*}/postgres" -v ON_ERROR_STOP=1 -c "CREATE DATABASE ${RESTORE_DB_QUOTED};"

echo "=== [5/8] Restoring logical backup into isolated database ==="
psql "$RESTORE_URL" -v ON_ERROR_STOP=1 -f "$BACKUP_FILE"

echo "=== [6/8] Verifying invariants and ENABLE + FORCE RLS on ALL 6 security tables ==="
psql "$RESTORE_URL" -v ON_ERROR_STOP=1 <<'EOF'
DO $$
DECLARE
  v_alice_bank bigint;
  v_alice_cash bigint;
  v_bob_savings bigint;
  v_transfer_count integer;
  v_audit_count integer;
  v_t text;
  v_rls_enabled boolean;
  v_rls_forced boolean;
BEGIN
  -- Verify balances
  SELECT balance INTO v_alice_bank FROM fintrack.wallets WHERE id = 'aaaaaaaa-1111-4111-8111-111111111111';
  SELECT balance INTO v_alice_cash FROM fintrack.wallets WHERE id = 'bbbbbbbb-1111-4111-8111-111111111111';
  SELECT balance INTO v_bob_savings FROM fintrack.wallets WHERE id = 'cccccccc-2222-4222-8222-222222222222';

  IF v_alice_bank <> 790 OR v_alice_cash <> 200 OR v_bob_savings <> 500 THEN
    RAISE EXCEPTION 'Balance invariant violated after restore! Alice: (%, %), Bob: %', v_alice_bank, v_alice_cash, v_bob_savings;
  END IF;

  -- Verify transfer ledger and audit correlation
  SELECT count(*) INTO v_transfer_count FROM fintrack.transfers;
  SELECT count(*) INTO v_audit_count FROM fintrack.audit_events WHERE request_id = 'ffffffff-1111-4111-8111-111111111111';

  IF v_transfer_count <> 1 OR v_audit_count <> 2 THEN
    RAISE EXCEPTION 'Ledger or audit count mismatch after restore! transfers: %, audits: %', v_transfer_count, v_audit_count;
  END IF;

  -- Verify ALL 6 security tables have ENABLE and FORCE RLS
  FOREACH v_t IN ARRAY ARRAY['sessions','wallets','transfers','idempotency','audit_events','rate_limits'] LOOP
    SELECT relrowsecurity, relforcerowsecurity INTO v_rls_enabled, v_rls_forced
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'fintrack' AND c.relname = v_t;

    IF NOT (v_rls_enabled AND v_rls_forced) THEN
      RAISE EXCEPTION 'RLS is NOT enabled and forced on % after restore!', v_t;
    END IF;
  END LOOP;

  RAISE NOTICE 'Restored database passed all invariant, balance, and RLS checks successfully!';
END $$;
EOF

echo "=== [7/8] Verifying restored schema_migrations and running migration verifier ==="
# Explicitly verify all expected migration rows survived dump/restore
node scripts/verify-migration-history.mjs "$RESTORE_URL"
echo "Verified: Restored database contains full migration history matching repository files."

# Verify migration runner accepts restored database (0 pending, checksums verified, no history mismatch)
DATABASE_MAINTENANCE_URL="$RESTORE_URL" node scripts/migrate.mjs
echo "Verified: Restored database is fully accepted by migration runner with 0 pending migrations."

echo "=== [8/8] Verifying application login role connection & Alice/Bob tenant isolation ==="
# Altering role password only happens after all test guards have verified disposable cluster
psql "${BASE_URL%/*}/postgres" -v ON_ERROR_STOP=1 -c "ALTER ROLE fintrack_app_login WITH PASSWORD 'ci-only-disposable-password';"
APP_RESTORE_URL="$(echo "$RESTORE_URL" | sed -E 's/\/\/[^:]+:[^@]+@/\/\/fintrack_app_login:ci-only-disposable-password@/')"

psql "$APP_RESTORE_URL" -v ON_ERROR_STOP=1 <<'EOF'
BEGIN;
SET LOCAL ROLE fintrack_runtime;

-- Verify Alice tenant isolation
SELECT set_config('app.session_hash', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', true);
SELECT count(*) FROM fintrack.wallets;
DO $$
DECLARE
  v_count integer;
  v_user uuid;
BEGIN
  SELECT count(*) INTO v_count FROM fintrack.wallets;
  SELECT fintrack.current_session_user_id() INTO v_user;
  IF v_count <> 2 OR v_user <> '11111111-1111-4111-8111-111111111111' THEN
    RAISE EXCEPTION 'Alice tenant isolation failure after restore! count: %, user: %', v_count, v_user;
  END IF;
END $$;

-- Verify Bob tenant isolation
SELECT set_config('app.session_hash', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', true);
DO $$
DECLARE
  v_count integer;
  v_user uuid;
BEGIN
  SELECT count(*) INTO v_count FROM fintrack.wallets;
  SELECT fintrack.current_session_user_id() INTO v_user;
  IF v_count <> 1 OR v_user <> '22222222-2222-4222-8222-222222222222' THEN
    RAISE EXCEPTION 'Bob tenant isolation failure after restore! count: %, user: %', v_count, v_user;
  END IF;
END $$;

ROLLBACK;
EOF

echo "=== Backup & Restore Drill Completed Successfully! ==="
