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
| Service-role key never exposed | IMPLEMENTED | Web app runs as least-privileged `fintrack_runtime` (no DDL, no TRUNCATE, no DELETE, no bypass RLS). Maintenance scripts run out-of-band via operator credentials. |
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
| No secrets in source code | IMPLEMENTED | `.env.example` with placeholders; CI and CodeQL scanning enabled. |
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
| Secret Scanning Guidance | IMPLEMENTED | Documented in §Secret Scanning Guidance below (native GitHub Secret Scanning with Push Protection or `gitleaks` pre-commit hooks). |

### A04 — Cryptographic Failures

| Control | Status | Evidence / Notes |
|---|---|---|
| High-entropy session secrets | IMPLEMENTED | 32-byte cryptographically secure session tokens, SHA-256 hashed before storage; database never stores raw tokens. |
| Session revocation & cookie clearing | IMPLEMENTED | `POST /api/v2/session/logout` revokes current session in DB and clears `__Host-fintrack_session` cookie (`Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, no Domain). |
| Safe corrupt storage preservation | IMPLEMENTED | `loadStorageSnapshot()` verifies backup write success, keeps original key untouched, provides raw unparsed download. |
| TLS for database connections | IMPLEMENTED | `src/server/database.ts` requires TLS verification (`rejectUnauthorized: true`, optional `DATABASE_CA`) in production. |
| Object storage for receipts | PLANNED | S3/GCS private encrypted bucket storage planned for receipt images. |

### A05 — Injection

| Control | Status | Evidence / Notes |
|---|---|---|
| Parameterized SQL queries | IMPLEMENTED | All database interactions in `src/server/repository.ts` use parameterized queries (`$1, $2, ...`). Zero string interpolation in SQL. |
| RLS Defense-in-Depth | IMPLEMENTED | RLS derived from session hash (`fintrack.current_session_user_id()`). Even if SQL injection occurred, an attacker setting `app.user_id` cannot bypass tenant isolation. |
| CSV / Spreadsheet Formula Injection | IMPLEMENTED | `sanitizeCsvCell()` in `src/lib/utils.ts` neutralizes `=`, `+`, `-`, `@`, `\t`, `\r` prefixes. |
| Receipt image validation at UI & storage | IMPLEMENTED | MIME allowlist (`image/jpeg`, `image/png`, `image/webp`), 1MB local cap, SVG/HTML/javascript: URLs strictly rejected. |
| Strict request body byte streaming | IMPLEMENTED | `readBoundedJsonBody` checks Content-Length and enforces byte budget during stream consumption before buffering or JSON parsing. |

### A06 — Insecure Design

| Control | Status | Evidence / Notes |
|---|---|---|
| Concurrency-safe financial operations | IMPLEMENTED | Wallet balance transfers acquire row locks in stable UUID order (`FOR UPDATE`) before balance evaluation; atomic transfer ledger and audit commitment. |
| Idempotency guarantees | IMPLEMENTED | Transaction-scoped advisory locks on `user_id:key` with 7-day retention policy and normalized SHA-256 payload fingerprinting. |
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
| Database migration discipline | IMPLEMENTED | Sequential immutable migrations (`001_backend_foundation.sql`, `002_backend_security_hardening.sql`). CI validates clean install and 001 → 002 upgrade path. |
| Logical Backup & Restore Drill | PARTIAL | Automated logical restore drill against clean database in CI (`scripts/backup-restore-drill.sh`) verifying schema, balances, and RLS. Managed Point-in-Time Recovery (PITR) remains PLANNED for production infrastructure. |
| Client storage schema versioning | IMPLEMENTED | `SCHEMA_VERSION = 1` in `src/lib/storage-schema.ts`. Unknown future versions rejected. |

### A09 — Security Logging and Monitoring Failures

| Control | Status | Evidence / Notes |
|---|---|---|
| Structured security logging | IMPLEMENTED | `src/server/logger.ts` emits sanitized JSON logs for 401, 403, 429, BOLA denials, quotas, and session revocations with `requestId` and `timestamp`. Never logs secrets, cookies, SQL, or notes. |
| Audit event correlation | IMPLEMENTED | Database `audit_events` records `request_id uuid` matching HTTP `X-Request-Id` response header for end-to-end trace correlation. |
| Out-of-band session maintenance | IMPLEMENTED | `scripts/session-maintenance.mjs` purges sessions expired/revoked > 30 days using operator credentials (forbidden for `fintrack_runtime`). |

---

## Secret Scanning Guidance

For repositories hosted on GitHub:
1. **GitHub Secret Scanning & Push Protection**: Enable under *Settings > Code security and analysis > Secret scanning*. This prevents secret leaks before git push succeeds.
2. **Local Pre-commit Hook (Open Source / Free Plans)**: If GitHub Secret Scanning is unavailable on the plan, configure `gitleaks` or `git-secrets`:
   ```bash
   # Install gitleaks
   brew install gitleaks # or curl -sSfL https://github.com/gitleaks/gitleaks/releases/download/...
   # Run scan
   gitleaks detect --source . --verbose
   ```
3. **CI Gate**: Run secret scanning in GitHub Actions on every pull request.
