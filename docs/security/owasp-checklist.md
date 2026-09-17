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
- [x] **Session Revocation / Logout (IMPLEMENTED)**: `POST /api/v2/session/logout` revokes current session in DB and clears cookie. Conflicting row locks (`FOR SHARE`) prevent in-flight mutation bypass.
- [x] **Out-of-Band Session Cleanup (IMPLEMENTED)**: `scripts/session-maintenance.mjs` purges sessions expired/revoked > 30 days via operator credentials.
- [ ] **Public Login Flow / Identity Issuance (PLANNED)**: OAuth / passwordless login planned for next iteration.
- [ ] **MFA Support (PLANNED)**: Multi-factor authentication planned for user accounts.

---

## 3. Access Control (ASVS V4 / OWASP Top 10 A01 / API1, API5)

- [x] **Client-Side Model Enforcement (IMPLEMENTED)**: Immutable wallet types, credit-limit debt enforcement, system transaction protection (BILL/GOAL immutability, origin=GOAL/BILL_PAYMENT enforcement).
- [x] **Server-Side Authorization & BOLA Prevention (IMPLEMENTED)**: Server validates `user_id` from authenticated session on every query and mutation. Foreign wallets return 404. Composite foreign keys `(user_id, wallet_id)` enforce tenant integrity at DB level.
- [x] **RLS Defense-in-Depth (IMPLEMENTED)**: RLS identity derives from `app.session_hash`. Setting `app.user_id` directly in SQL has ZERO authorization effect.
- [x] **Production Mock Mutation Gating & Legacy Shutdown (IMPLEMENTED)**: In `NODE_ENV=production`, all legacy demo routes (`/api/*`) return HTTP 404. `ENABLE_DEMO_API=true` is ignored in production. Production Mock Mutation Gating disables all mock mutations.
- [x] **Wallet Resource Quota (IMPLEMENTED)**: Concurrency-safe limit of 100 wallets per user enforced via advisory transaction lock and `WALLET_LIMIT_REACHED` error.
- [ ] **Frontend Backend Persistence Cutover (PLANNED)**: UI still operates via localStorage; cutover to `/api/v2` planned for next iteration.

---

## 4. Input Validation & Sanitization (ASVS V5 / OWASP Top 10 A05 / API3)

- [x] **Snapshot Schema Validation (IMPLEMENTED)**: Strict type, enum, number range, category referential integrity, and bidirectional bill-payment integrity via `storage-schema.ts`.
- [x] **Domain Invariant Validation (IMPLEMENTED)**: Business-rule enforcement in `src/server/domain.ts` and `domain-engine.ts`.
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
- [ ] **Point-in-Time Recovery (PITR) (PLANNED)**: Automated logical restore drill implemented in CI (`scripts/backup-restore-drill.sh`); infrastructure PITR planned for deployment phase.

---

## 6. Error Handling, Logging & Monitoring (ASVS V7 & V8 / OWASP Top 10 A09, A10)

- [x] **Safe Error Formatting (IMPLEMENTED)**: `safeErrorMessage()` prevents internal stack trace leaks.
- [x] **Structured Security Logging (IMPLEMENTED)**: `src/server/logger.ts` outputs sanitized JSON logs for 401, 403, 429, BOLA denials, quotas, and session revocations. Never leaks tokens, cookies, or notes.
- [x] **Audit Event Correlation (IMPLEMENTED)**: `request_id uuid` stored in `fintrack.audit_events` matching response header `X-Request-Id`.
- [x] **Bounded Rate Limiting (IMPLEMENTED)**: Storage-bounded rate limiting per user and scope (`global`, `wallet:create`, `transfer:create`) with fixed 1-row invariant per user-scope.

---

## 7. HTTP Security Headers (ASVS V14 / OWASP Top 10 A02)

Configured in `next.config.mjs`:

- [x] `Content-Security-Policy`: Restricts scripts, styles, objects (`object-src 'none'`), and framing (`frame-ancestors 'none'`). `'unsafe-eval'` excluded in production.
- [x] `Strict-Transport-Security: max-age=31536000`: Production HSTS (without `includeSubDomains`).
- [x] `X-Content-Type-Options: nosniff`: Prevents MIME type sniffing.
- [x] `Referrer-Policy: strict-origin-when-cross-origin`: Minimizes referrer leakage.
- [x] `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`: Restricts sensitive browser APIs.
- [x] `X-Frame-Options: DENY`: Clickjacking prevention.
