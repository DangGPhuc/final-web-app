# Security Baseline — FinTrack Pro v2

> **Disclaimer**: This document maps PLANNED, PARTIAL, and IMPLEMENTED controls.
> FinTrack Pro v2 is **NOT** claimed to be "OWASP compliant."
> Formal compliance requires independent verification.
>
> Status values: **IMPLEMENTED** | **PARTIAL** | **PLANNED** | **NOT APPLICABLE**

---

## Current Architecture Boundary Notice

> [!IMPORTANT]
> **Frontend Persistence Status**: The frontend user interface currently operates exclusively with client-side state (`AppContext`) and browser `localStorage`.
> User financial data entered in the current frontend is **NOT** persisted to PostgreSQL yet.
> The backend foundation under `/api/v2/*` provides a hardened, multi-tenant PostgreSQL layer (wallets, transfers, sessions, audit, rate limiting) with session-derived RLS. Frontend cutover to this backend is scheduled for the subsequent iteration.
> No silent mixing of client localStorage and database state is permitted.

---

## OWASP Top 10:2025 Mapping

### A01 — Broken Access Control

| Control | Status | Evidence / Notes |
|---|---|---|
| Every user-owned resource includes `user_id` | IMPLEMENTED | Foundation DB tables (`wallets`, `transfers`, `idempotency`, `audit_events`, `rate_limits`) have `user_id uuid NOT NULL REFERENCES fintrack.users`. |
| Queries enforce `WHERE user_id = ?` | IMPLEMENTED | Server repository queries enforce `WHERE user_id = $1` on all data operations. |
| Row Level Security (RLS) on PostgreSQL | IMPLEMENTED | Foundation tables only. `ENABLE` + `FORCE ROW LEVEL SECURITY`. RLS derives user identity strictly from `fintrack.current_session_user_id()` matching `app.session_hash`. `app.user_id` has ZERO authorization effect. |
| BOLA / IDOR Prevention | IMPLEMENTED | Both source and destination wallets locked and verified to belong to caller's session; foreign wallets return 404. Composite FK `(user_id, wallet_id)` prevents cross-tenant relations even via raw SQL. |
| Database Role Separation | IMPLEMENTED | Web app connects as `fintrack_app_login` (`LOGIN`, `NOINHERIT`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOBYPASSRLS`) with no direct table privileges, executing `SET LOCAL ROLE fintrack_runtime` after transaction `BEGIN`. Elevated credentials fail closed. |
| Service-role key never exposed | IMPLEMENTED | Web runtime role `fintrack_runtime` has no DDL, no TRUNCATE, no DELETE, no bypass RLS. Maintenance scripts run out-of-band via operator credentials (`DATABASE_MAINTENANCE_URL`). |
| Authorization model documented | IMPLEMENTED | Documented in `docs/architecture/data-storage.md` and `docs/backend/FOUNDATION_REVIEW_VI.md`. |
| Frontend backend persistence | PLANNED | Frontend cutover from localStorage to `/api/v2` planned for next iteration. |

### A02 — Security Misconfiguration

| Control | Status | Evidence / Notes |
|---|---|---|
| Security response headers | IMPLEMENTED | `next.config.mjs` — CSP (environment-sensitive, `unsafe-eval` removed in production, `object-src 'none'`), X-Content-Type-Options, Referrer-Policy, Permissions-Policy. |
| Frame protection (clickjacking) | IMPLEMENTED | CSP `frame-ancestors 'none'` + legacy defense-in-depth `X-Frame-Options: DENY`. |
| Production HSTS | IMPLEMENTED | `next.config.mjs` sends `Strict-Transport-Security: max-age=31536000` in production (`!isDev`). `includeSubDomains` omitted to avoid unwarranted claims over unmanaged subdomains. |
| Legacy demo API production shutdown | IMPLEMENTED | In `NODE_ENV=production`, all legacy `/api/*` demo endpoints return HTTP 404. `ENABLE_DEMO_API=true` is ignored in production. Demo routes accessible only in development/test. |
| Stack traces not exposed to users | IMPLEMENTED | `safeErrorMessage()` in `src/lib/error.ts`, sanitized API errors in `src/server/http.ts`. |
| No secrets in source code | IMPLEMENTED | `.env.example` with placeholders; CI secret scanning via Gitleaks and CodeQL enabled. |
| Nonce-based CSP | PLANNED | Requires Next.js nonce integration (future phase). |

### A03 — Software Supply Chain Failures

| Control | Status | Evidence / Notes |
|---|---|---|
| `package-lock.json` committed | IMPLEMENTED | Pinned dependency tree committed and verified in CI. |
| `npm ci` for reproducible installs | IMPLEMENTED | Enforced across all workflows. |
| Spreadsheet dependency migration | IMPLEMENTED | `xlsx` completely removed; migrated to `exceljs` with dynamic import. |
| Automated dependency scanning | IMPLEMENTED | Dependabot configured in `.github/dependabot.yml` for `npm` and `github-actions`. CI runs both `npm audit --omit=dev --audit-level=high` and full `npm audit --audit-level=high`. |
| Pinned Actions and Container Images | IMPLEMENTED | GitHub Actions pinned to verified full 40-character commit SHAs. PostgreSQL CI service pinned to immutable image digest. |
| Static Application Security Testing | IMPLEMENTED | GitHub CodeQL workflow configured in `.github/workflows/codeql.yml` for JavaScript/TypeScript. |
| Automated Secret Scanning Gate | IMPLEMENTED | Dedicated GitHub Actions workflow `.github/workflows/secret-scan.yml` with pinned Gitleaks action (`gitleaks/gitleaks-action@e85a6a3b680786cf8c1f964042ea04ab575b5b16`). |

### A04 — Cryptographic Failures

| Control | Status | Evidence / Notes |
|---|---|---|
| High-entropy session secrets | IMPLEMENTED | 32-byte cryptographically secure session tokens, SHA-256 hashed before storage; database never stores raw tokens. |
| Success-only logout cookie clearing | IMPLEMENTED | `POST /api/v2/session/logout` revokes current session in DB and returns HTTP 200 with `Set-Cookie: __Host-fintrack_session=...Max-Age=0` strictly after revocation commit. Error responses never clear cookies. |
| Safe corrupt storage preservation | IMPLEMENTED | `loadStorageSnapshot()` verifies backup write success, keeps original key untouched, provides raw unparsed download. |
| TLS for database connections | IMPLEMENTED | `src/server/database.ts` requires TLS verification (`rejectUnauthorized: true`, optional `DATABASE_CA`) in production. |
| Object storage for receipts | PLANNED | S3/GCS private encrypted bucket storage planned for receipt images. |

### A05 — Injection

| Control | Status | Evidence / Notes |
|---|---|---|
| Parameterized SQL queries | IMPLEMENTED | All database interactions in `src/server/repository.ts` use parameterized queries (`$1, $2, ...`). Zero string interpolation in SQL. |
| RLS Defense-in-Depth | IMPLEMENTED | RLS derived from session hash (`fintrack.current_session_user_id()`). Even if SQL injection occurred, an attacker setting `app.user_id` cannot bypass tenant isolation. |
| Residual Risk Disclosure | DOCUMENTED | Parameterized queries prevent SQL injection. In the catastrophic event that arbitrary SQL execution is achieved under the runtime role, RLS protects cross-tenant confidentiality, but application-owned records within the attacker's own tenant may still be modified within granted runtime privileges. RLS does not prevent all SQL-injection damage within the attacker's own tenant. |
| CSV / Spreadsheet Formula Injection | IMPLEMENTED | `sanitizeCsvCell()` in `src/lib/utils.ts` neutralizes `=`, `+`, `-`, `@`, `\t`, `\r` prefixes. |
| Receipt image validation at UI & storage | IMPLEMENTED | MIME allowlist (`image/jpeg`, `image/png`, `image/webp`), 1MB local cap, SVG/HTML/javascript: URLs strictly rejected. |
| Strict request body byte streaming | IMPLEMENTED | `readBoundedJsonBody` checks Content-Length and enforces byte budget during stream consumption before buffering or JSON parsing. |

### A06 — Insecure Design

| Control | Status | Evidence / Notes |
|---|---|---|
| Concurrency-safe financial operations | IMPLEMENTED | Wallet balance transfers acquire row locks in stable UUID order (`FOR UPDATE`) before balance evaluation; atomic transfer ledger and audit commitment. |
| Daily transfer resource quota | IMPLEMENTED | Concurrency-safe security quota `MAX_TRANSFERS_PER_USER_PER_DAY = 1000` enforced per user per UTC calendar day via transaction advisory lock `${user}:transfer-daily:${utcDate}`, returning `TRANSFER_DAILY_LIMIT_REACHED` (422). |
| Stacked rate limiting | IMPLEMENTED | Every authenticated API request consumes `global` budget (60/min), with mutating operations stacking `wallet:create` (10/min) or `transfer:create` (20/min). |
| Idempotency guarantees & retention | IMPLEMENTED | Transaction-scoped advisory locks on `user_id:key` with at least 7-day retention SLA. Operator maintenance purges records older than 8 days. |
| Wallet resource quota | IMPLEMENTED | Max 100 wallets per user enforced with advisory lock serialization (`${user}:wallet-create`) and stable `WALLET_LIMIT_REACHED` error. |
| Bounded rate-limiting storage | IMPLEMENTED | `(user_id, scope)` primary key with in-place hit/bucket counter; storage remains strictly bounded regardless of request frequency across time buckets. Scopes: `global` (60/min), `wallet:create` (10/min), `transfer:create` (20/min). |

### A07 — Authentication Failures

| Control | Status | Evidence | Notes |
|---|---|---|---|
| Session verification | IMPLEMENTED | `src/server/session.ts` | Validates `__Host-fintrack_session`, checks expiry and revocation. |
| Session revocation / logout | IMPLEMENTED | `POST /api/v2/session/logout` | Revokes current session and conflicts with active mutation row-locks (`FOR SHARE`). |
| Public user login / registration | PLANNED | Identity issuance / OAuth | Full passwordless/OAuth login planned for next iteration. |
| Password policy & MFA | PLANNED | Authentication provider | Delegated to OAuth / Supabase Auth in future phase. |

### A08 — Software or Data Integrity Failures

| Control | Status | Evidence / Notes |
|---|---|---|
| Database migration discipline & checksums | IMPLEMENTED | Sequential immutable migrations (`001`, `002`, `003`). `scripts/migrate.mjs` enforces SHA-256 checksum verification via `fintrack.schema_migrations` and fails closed on tampering. |
| Logical Backup & Restore Drill | PARTIAL | Automated logical restore drill in CI (`scripts/backup-restore-drill.sh`) verifying schema, balances, and RLS on all 6 tables. Note: `pg_dump` does not serialize cluster-wide roles (`fintrack_runtime`, `fintrack_app_login`), requiring bootstrap logic during disaster recovery. Full fresh-cluster PITR remains PLANNED for production infrastructure. |
| Client storage schema versioning | IMPLEMENTED | `SCHEMA_VERSION = 1` in `src/lib/storage-schema.ts`. Unknown future versions rejected. |

### A09 — Security Logging and Monitoring Failures

| Control | Status | Evidence / Notes |
|---|---|---|
| Structured security logging | IMPLEMENTED | `src/server/logger.ts` emits sanitized JSON logs for 401, 403, 429, BOLA denials, quotas, and session revocations with `requestId` and `timestamp`. Never logs secrets, cookies, SQL, or notes. |
| Audit event correlation | IMPLEMENTED | Database `audit_events` requires valid non-null `request_id uuid` matching HTTP `X-Request-Id` response header for end-to-end trace correlation. |
| Out-of-band maintenance | IMPLEMENTED | `scripts/backend-maintenance.mjs` purges sessions > 30 days and idempotency > 8 days using operator credentials (`DATABASE_MAINTENANCE_URL`). Application roles cannot execute maintenance; no `RETURNING token_hash`. |
| Centralized Alerting & Incident Notification | PLANNED / PARTIAL | Structured security logging is fully implemented, but automated operational alerting (Slack/PagerDuty thresholds, Prometheus metrics) is PLANNED. A09 is not considered fully closed until alerting evidence exists. |

---

## Storage Growth & Retention Policies

| Table | Nature | Retention Policy | Capacity / Growth Profile |
|---|---|---|---|
| `transfers` | Durable Financial Ledger | Permanent (never deleted) | Growth proportional to user transaction volume (~150 bytes/row). |
| `audit_events` | Durable Compliance Audit | Permanent (never deleted) | 1:1 correlation with wallet/transfer mutations (~120 bytes/row). |
| `wallets` | Domain Entity | Lifecycle bound to user account | Quota capped at 100 wallets per user (~180 bytes/row). |
| `sessions` | Ephemeral Auth State | Purged after 30 days post expiry/revocation | Cleaned out-of-band via `scripts/backend-maintenance.mjs`. |
| `idempotency` | Ephemeral Request Deduplication | Guaranteed >= 7 days; purged > 8 days | Cleaned out-of-band via `scripts/backend-maintenance.mjs`. |
| `rate_limits` | Security Counter | Fixed bounded size (max 3 rows per active user) | In-place updates on `(user_id, scope)` primary key (~80 bytes/row). |

> [!IMPORTANT]
> Financial ledger records (`transfers`, `audit_events`) are durable records and are **NEVER** deleted merely to reduce database storage.

## Truthful Implementation Statuses

| Capability | Status | Implementation Evidence / Notes |
|---|---|---|
| Database-level logical restore | **IMPLEMENTED** | Verified automated script `scripts/backup-restore-drill.sh` testing data restoration, balance invariants, all 6 security tables with ENABLE + FORCE RLS, tenant isolation, full `schema_migrations` history preservation, and subsequent migration runner acceptance. |
| Fresh-cluster disaster recovery | **PARTIAL / PLANNED** | Database logical restore verified. Provisioning cluster-level roles (`fintrack_runtime`, `fintrack_app_login`) on a blank cluster requires version-controlled bootstrap prior to restore. Full fresh-cluster disaster recovery orchestration is PLANNED. |
| Authentication | **PARTIAL / PLANNED** | Session verification, constant-time hashing, and server-side revocation implemented. Real identity issuance, passwordless/OAuth login planned for next iteration. |
| Centralized monitoring + alerting | **PARTIAL / PLANNED** | Structured security logging with UUID `request_id` implemented in `src/server/logger.ts`. Centralized metric aggregation (Prometheus/Datadog) and alerting rules are planned. |
| Frontend PostgreSQL cutover | **PLANNED** | Frontend currently uses client-side state and localStorage exclusively. PostgreSQL cutover planned for next iteration. |
| Private object storage | **PLANNED** | Planned for subsequent receipt attachments phase. |
| Managed encrypted backup | **PLANNED** | Automated logical dump verified. Managed KMS-encrypted backups planned for cloud production phase. |
| Point-in-Time Recovery (PITR) | **PLANNED** | Continuous WAL archiving and PITR planned for production cloud deployment. Full disaster recovery is NOT claimed. |

### Schema Object Ownership Model
> [!IMPORTANT]
> Application runtime roles (`fintrack_runtime`, `fintrack_app_login`) do **NOT** own application tables. All tables are created and owned exclusively by the dedicated operator/migration role. Runtime identity guarantees in `transaction()` strictly verify zero table ownership for the connecting role (`tableowner = session_user` count is 0).

---

## Secret Scanning Gate

FinTrack Pro v2 enforces automated secret scanning via:
1. **GitHub Actions Gate**: Configured in `.github/workflows/secret-scan.yml` using pinned Gitleaks action (`gitleaks/gitleaks-action@e85a6a3b680786cf8c1f964042ea04ab575b5b16`).
2. **Local Pre-commit Hook**: Developers should install and run `gitleaks detect --source . --verbose` locally before pushing code.

