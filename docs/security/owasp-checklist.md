# OWASP Verification Checklist — FinTrack Pro v2

> **Scope**: FinTrack Pro v2 application controls, API boundaries, and future backend transition.  
> **Target Standard**: OWASP ASVS 5.0 Level 2 & OWASP Top 10:2025  
> **Audit Status**: Active / Pre-Production Baseline

---

## 1. Architecture & Threat Modeling (ASVS V1)

- [x] **Boundary Separation**: Distinct separation between client state (AppContext), domain integrity engine (`domain-engine.ts`), and serialization validator (`storage-schema.ts`).
- [x] **No Secrets in Client**: Client bundles do not contain API keys, database credentials, or signing secrets.
- [x] **Security Baseline Maintained**: Documented in `docs/security/security-baseline.md`.
- [x] **Dependency Policy Maintained**: Documented in `docs/security/dependency-policy.md`.
- [ ] **Multi-tenant Data Isolation**: Strict user-scoped isolation model (`user_id` on all tables, RLS policies) designed for database phase.

---

## 2. Authentication & Session Management (ASVS V2 & V3)

*Note: Application currently operates in local/demo mode without user accounts.*

- [ ] **Secure Session Tokens**: HTTP-only, Secure, SameSite=Lax/Strict session cookies (planned for Auth phase).
- [ ] **Brute Force Protection**: Rate limiting on login and credential recovery endpoints.
- [ ] **MFA Support**: TOTP / WebAuthn support planned for user accounts.
- [ ] **Token Expiry**: Short-lived access tokens (15m) + revocable refresh tokens (7d).

---

## 3. Access Control (ASVS V4 / OWASP Top 10 A01 / API1, API5)

- [x] **Client-Side Model Enforcement**: Immutable wallet types, credit-limit debt enforcement, system transaction protection (BILL/GOAL immutability, origin=GOAL/BILL_PAYMENT enforcement).
- [x] **API Guards**: Mutation APIs reject arbitrary payloads, missing required fields, and oversized requests (`413/422/400`).
- [x] **Production Mock Mutation Gating**: In production, mock mutation endpoints return `501 Not Implemented` unless `ENABLE_DEMO_API=true`.
- [x] **Demo-Only Indication**: All Mock API endpoints respond with `X-Demo-Only: true` and `X-Persistence: none`.
- [ ] **Server-Side Authorization**: Ensure server validates `user_id` on every query and mutation (BOLA/IDOR prevention).

---

## 4. Input Validation & Sanitization (ASVS V5 / OWASP Top 10 A05 / API3)

- [x] **Snapshot Schema Validation**: Strict type, enum, number range, category referential integrity, and bidirectional bill-payment integrity via `storage-schema.ts`.
- [x] **Domain Invariant Validation**: Business-rule enforcement in `domain-engine.ts` (e.g. transfer fee non-negative, budget category exists and is EXPENSE, non-negative balances).
- [x] **Strict Datetime Parsing**: Rejects impossible calendar dates (e.g. Feb 31) and invalid formats without falling back to current time.
- [x] **CSV/Spreadsheet Formula Injection Defense**: All user-controlled fields (`note`, `categoryName`, `walletName`, `toWalletName`) sanitized in CSV/Excel export.
- [x] **Receipt File Validation at UI Boundary**: Wired into `QuickAddModal` and `EditTransactionModal`, restricted to `image/jpeg,image/png,image/webp`, max 1 MB local cap.
- [x] **Persisted Receipt Security**: Storage schema validates Base64 Data URL format, strictly rejects SVG, HTML, javascript:, remote HTTP URLs, and oversized attachments.
- [x] **Payload Size Limits**: Max 5 MB UTF-8 byte import limit in AppContext and 50 KB body size cap in API routes.

---

## 5. Cryptography & Data Protection (ASVS V6 & V9 / OWASP Top 10 A04)

- [x] **Versioned Persistence**: Schemas tagged with `schemaVersion: 1` preventing arbitrary parsing or schema confusion.
- [x] **Safe Recovery Keying**: Corrupted snapshots never overwritten; safely duplicated to `fintrack_recovery_corrupt_<timestamp>` with setItem success verification and raw unparsed download.
- [x] **Pre-Save Persistence Gate**: In-memory snapshot validated via `validateAndNormalizeAppSnapshot()` before persisting; invalid state sets `SAVE_ERROR` and does not overwrite storage.
- [ ] **Transport Layer Security**: HTTPS enforced via HSTS in production deployment.
- [ ] **Encrypted Storage at Rest**: Sensitive financial records encrypted in PostgreSQL database.

---

## 6. Error Handling & Logging (ASVS V7 & V8 / OWASP Top 10 A09, A10)

- [x] **Safe Error Formatting**: `safeErrorMessage()` prevents internal stack trace or raw exception leaks to users.
- [x] **Structured Error Model**: Standardized `AppErrorCode` and error response builders in `src/lib/error.ts`.
- [x] **Storage Failure Transparency**: Context status (`SAVE_ERROR`, `RECOVERY_REQUIRED`) clearly presented via `StorageStatusBanner` with verified recovery copy tracking.
- [ ] **Audit Logging**: Security events (login, exports, corrupt data recovery) logged to persistent audit store (see `docs/security/audit-logging.md`).

---

## 7. HTTP Security Headers (ASVS V14 / OWASP Top 10 A02)

Configured in `next.config.mjs`:

- [x] `Content-Security-Policy`: Restricts scripts, styles, objects (`object-src 'none'`), and framing (`frame-ancestors 'none'`). `'unsafe-eval'` excluded in production.
- [x] `X-Content-Type-Options: nosniff`: Prevents MIME type sniffing.
- [x] `Referrer-Policy: strict-origin-when-cross-origin`: Minimizes referrer leakage.
- [x] `Permissions-Policy: camera=(), microphone=(), geolocation=()`: Restricts sensitive browser APIs.
- [x] `X-Frame-Options: DENY`: Prevents clickjacking in legacy user agents alongside CSP frame-ancestors.
