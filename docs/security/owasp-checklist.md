# OWASP Verification Checklist — FinTrack Pro v2

> **Scope**: FinTrack Pro v2 application controls, API boundaries, and hardened backend foundation.
> **Target Standard**: OWASP ASVS 5.0 Level 2 & OWASP Top 10:2025
> **Audit Status**: Pre-Production Baseline (Foundation Hardened)
> **Notice**: FinTrack Pro v2 does NOT claim to be "OWASP compliant." Formal compliance requires external certification.

---

## 1. Architecture & Threat Modeling (ASVS V1)

- [x] **Boundary Separation (IMPLEMENTED)**: Distinct separation between client state (AppContext/localStorage), domain integrity engine (`domain-engine.ts`), serialization validator (`storage-schema.ts`), and backend database foundation (`src/server/*`).
- [x] **No Secrets in Client (IMPLEMENTED)**: Client bundles do not contain API keys, database credentials, or signing secrets.
- [x] **Security Baseline Maintained (IMPLEMENTED)**: Documented in `docs/security/security-baseline.md`.
- [x] **Dependency Policy Maintained (IMPLEMENTED)**: Documented in `docs/security/dependency-policy.md`.
- [x] **Multi-tenant Data Isolation (IMPLEMENTED for Foundation Tables)**: Strict user-scoped isolation model (`user_id` on all tables, RLS policies derived from session hash via `fintrack.current_session_user_id()`).

---

## 2. Authentication & Session Management (ASVS V2 & V3)

- [x] **Secure Session Tokens (IMPLEMENTED)**: `__Host-fintrack_session` cookie (`Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, no Domain), 32-byte cryptographically secure token, SHA-256 stored.
- [x] **Success-Only Logout Cookie Clearing (IMPLEMENTED)**: `POST /api/v2/session/logout` revokes current session in DB and returns HTTP 200. `Set-Cookie: __Host-fintrack_session=...Max-Age=0` is emitted strictly after successful database revocation commit. On failure (401, 403, 429, database error), no `Set-Cookie` header is emitted. Conflicting row locks (`FOR SHARE`) prevent in-flight mutation bypass.
- [x] **Out-of-Band Retention Maintenance (IMPLEMENTED)**: `scripts/backend-maintenance.mjs` purges sessions expired/revoked > 30 days and idempotency records > 8 days (preserving 7-day guarantee) via operator credentials (`DATABASE_MAINTENANCE_URL`). Application roles cannot execute maintenance; no `RETURNING token_hash`.
- [ ] **Public Login Flow / Identity Issuance (PLANNED)**: OAuth / passwordless login planned for next iteration.
- [ ] **MFA Support (PLANNED)**: Multi-factor authentication planned for user accounts.

---

## 3. Access Control (ASVS V4 / OWASP Top 10 A01 / API1, API4, API5)

- [x] **Client-Side Model Enforcement (IMPLEMENTED)**: Immutable wallet types, credit-limit debt enforcement, system transaction protection (BILL/GOAL immutability, origin=GOAL/BILL_PAYMENT enforcement).
- [x] **Server-Side Authorization & BOLA Prevention (IMPLEMENTED)**: Server validates `user_id` from authenticated session on every query and mutation. Foreign wallets return 404. Composite foreign keys `(user_id, wallet_id)` enforce tenant integrity at DB level.
- [x] **RLS Defense-in-Depth (IMPLEMENTED)**: RLS identity derives from `app.session_hash`. Setting `app.user_id` directly in SQL has ZERO authorization effect.
- [x] **Production Connection Role Separation (IMPLEMENTED)**: Connection pool logs in as `fintrack_app_login` (`LOGIN`, `NOINHERIT`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOBYPASSRLS`) with no direct table privileges, executing `SET LOCAL ROLE fintrack_runtime` after transaction `BEGIN`. Elevated credentials fail closed.
- [x] **Production Mock Mutation Gating & Legacy Shutdown (IMPLEMENTED)**: In `NODE_ENV=production`, all legacy demo routes (`/api/*`) return HTTP 404. `ENABLE_DEMO_API=true` is ignored in production. Production Mock Mutation Gating disables all mock mutations.
- [x] **Wallet Resource Quota (IMPLEMENTED)**: Concurrency-safe limit of 100 wallets per user enforced via advisory transaction lock and `WALLET_LIMIT_REACHED` error (422).
- [x] **Daily Transfer Resource Quota (IMPLEMENTED)**: Concurrency-safe security quota `MAX_TRANSFERS_PER_USER_PER_DAY = 1000` enforced per user per UTC calendar day via transaction advisory lock `${user}:transfer-daily:${utcDate}`, returning `TRANSFER_DAILY_LIMIT_REACHED` (422).
- [x] **Stacked Rate Limiting (IMPLEMENTED)**: Every authenticated API request consumes `global` budget (60/min), and sensitive mutations additionally consume business budgets (`wallet:create` 10/min, `transfer:create` 20/min). If either limit is exceeded, HTTP 429 is returned.
- [ ] **Frontend Backend Persistence Cutover (PLANNED)**: UI still operates via localStorage; cutover to `/api/v2` planned for next iteration.

---

## 4. Input Validation & Sanitization (ASVS V5 / OWASP Top 10 A05 / API3)

- [x] **Snapshot Schema Validation (IMPLEMENTED)**: Strict type, enum, number range, category referential integrity, and bidirectional bill-payment integrity via `storage-schema.ts`.
- [x] **Domain Invariant Validation (IMPLEMENTED)**: Business-rule enforcement in `src/server/domain.ts` and `domain-engine.ts`.
- [x] **Mandatory Audit Request ID (IMPLEMENTED)**: All mutations require valid non-null UUID `requestId` matching `X-Request-Id`.
- [x] **CSV/Spreadsheet Formula Injection Defense (IMPLEMENTED)**: All user-controlled fields sanitized in CSV/Excel export (`sanitizeCsvCell()`).
- [x] **Receipt File Validation at UI Boundary (IMPLEMENTED)**: Restricts to `image/jpeg,image/png,image/webp`, max 1 MB local cap.
- [x] **Strict Request Body Size & Streaming (IMPLEMENTED)**: `readBoundedJsonBody` enforces UTF-8 byte limits during stream reading before buffering or parsing.
- [ ] **Object Storage for Receipts (PLANNED)**: Private S3/GCS bucket storage for receipt attachments.

---

## 5. Cryptography & Data Protection (ASVS V6 & V9 / OWASP Top 10 A04)

- [x] **Versioned Persistence (IMPLEMENTED)**: Schemas tagged with `schemaVersion: 1`.
- [x] **Safe Recovery Keying (IMPLEMENTED)**: Corrupted snapshots never overwritten; safely duplicated to `fintrack_recovery_corrupt_<timestamp>`.
- [x] **Database TLS Enforcement (IMPLEMENTED)**: TLS with certificate verification required in production database connections.
- [x] **HSTS (IMPLEMENTED)**: `Strict-Transport-Security: max-age=31536000` header in production.
- [x] **Migration Checksum Verification (IMPLEMENTED)**: `scripts/migrate.mjs` verifies SHA-256 checksums stored in `fintrack.schema_migrations` and fails closed on tampering.
- [ ] **Point-in-Time Recovery (PITR) (PLANNED)**: Automated logical restore drill implemented in CI (`scripts/backup-restore-drill.sh`); infrastructure PITR planned for deployment phase.

---

## 6. Error Handling, Logging & Monitoring (ASVS V7 & V8 / OWASP Top 10 A09, A10)

- [x] **Safe Error Formatting (IMPLEMENTED)**: `safeErrorMessage()` prevents internal stack trace leaks.
- [x] **Structured Security Logging (IMPLEMENTED)**: `src/server/logger.ts` outputs sanitized JSON logs for 401, 403, 429, BOLA denials, quotas, and session revocations. Never leaks tokens, cookies, or notes.
- [x] **Audit Event Correlation (IMPLEMENTED)**: `request_id uuid` stored in `fintrack.audit_events` matching response header `X-Request-Id`.
- [x] **Bounded Rate Limiting Storage (IMPLEMENTED)**: Storage-bounded rate limiting per user and scope (`global`, `wallet:create`, `transfer:create`) with fixed 1-row invariant per user-scope.
- [ ] **Operational Monitoring & Alert Thresholds (PLANNED / PARTIAL)**: Security logging is IMPLEMENTED; automated alerting thresholds, Prometheus metrics, and incident paging are PLANNED. OWASP A09 is not considered fully closed until active alerting is deployed.

---

## 7. HTTP Security Headers (ASVS V14 / OWASP Top 10 A02)

Configured in `next.config.mjs`:

- [x] `Content-Security-Policy`: Restricts scripts, styles, objects (`object-src 'none'`), and framing (`frame-ancestors 'none'`). `'unsafe-eval'` excluded in production.
- [x] `Strict-Transport-Security: max-age=31536000`: Production HSTS (without `includeSubDomains`).
- [x] `X-Content-Type-Options: nosniff`: Prevents MIME type sniffing.
- [x] `Referrer-Policy: strict-origin-when-cross-origin`: Minimizes referrer leakage.
- [x] `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`: Restricts sensitive browser APIs.
- [x] `X-Frame-Options: DENY`: Clickjacking prevention.
