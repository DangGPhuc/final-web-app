# Security Baseline — FinTrack Pro v2

> **Disclaimer**: This document maps PLANNED and IMPLEMENTED controls.
> FinTrack Pro v2 is NOT claimed to be "OWASP compliant."
> Formal compliance requires independent verification.
>
> Status values: **IMPLEMENTED** | **PARTIAL** | **PLANNED** | **NOT APPLICABLE**

---

## OWASP Top 10:2025 Mapping

### A01 — Broken Access Control

| Control | Status | Evidence / Notes |
|---|---|---|
| Every user-owned resource includes `user_id` | PLANNED | No backend yet; designed in `docs/architecture/data-storage.md` |
| Queries enforce `WHERE id = ? AND user_id = ?` | PLANNED | Future PostgreSQL phase |
| Row Level Security (RLS) on Supabase/PG | PLANNED | Future backend phase |
| No direct object references to other users' data | PLANNED | Client-side only currently |
| Service-role key never exposed to browser | PLANNED | No key exists yet |
| Authorization model documented | PARTIAL | See `docs/architecture/data-storage.md` §Ownership |

### A02 — Security Misconfiguration

| Control | Status | Evidence / Notes |
|---|---|---|
| Security response headers | IMPLEMENTED | `next.config.mjs` — CSP, X-Content-Type-Options, Referrer-Policy, Permissions-Policy |
| Frame protection (clickjacking) | IMPLEMENTED | `frame-ancestors 'none'` in CSP |
| Demo-only API headers (`X-Demo-Only`) | IMPLEMENTED | All API routes |
| Stack traces not exposed to users | IMPLEMENTED | `safeErrorMessage()` in `src/lib/error.ts` |
| No secrets in source code | IMPLEMENTED | Secrets audit passed; `.env.example` created |
| HSTS | PLANNED | Requires HTTPS deployment; add at reverse proxy |
| Nonce-based CSP | PLANNED | Requires Next.js nonce integration (future) |
| No default credentials | NOT APPLICABLE | No authentication yet |

### A03 — Software Supply Chain Failures

| Control | Status | Evidence / Notes |
|---|---|---|
| `package-lock.json` committed | IMPLEMENTED | Pinned dependency tree |
| `npm ci` for reproducible installs | IMPLEMENTED | See `docs/security/dependency-policy.md` |
| Automated dependency scanning | PLANNED | Recommend Dependabot / `npm audit` in CI |
| XLSX dependency reviewed | PARTIAL | Used for export only; migration path documented in `docs/security/dependency-policy.md` |
| Major version reviews required | PLANNED | Policy documented |

### A04 — Cryptographic Failures

| Control | Status | Evidence / Notes |
|---|---|---|
| No sensitive data in localStorage in plain text (future) | PLANNED | Current: demo data only; future: no PII without encryption |
| HTTPS required for production | PLANNED | Local dev only currently |
| No weak hash algorithms | NOT APPLICABLE | No hashing implemented yet |
| Secrets not in version control | IMPLEMENTED | `.env.example` with placeholders; no real secrets found in audit |
| TLS for database connections | PLANNED | PostgreSQL requirement documented |

### A05 — Injection

| Control | Status | Evidence / Notes |
|---|---|---|
| No SQL queries (client-side only) | NOT APPLICABLE | No database yet |
| Parameterized queries planned | PLANNED | Required for future PostgreSQL |
| No `eval()` or `new Function()` in source | IMPLEMENTED | Audit confirmed — none found |
| No `dangerouslySetInnerHTML` | IMPLEMENTED | Audit confirmed — none found |
| CSV formula injection (spreadsheet) | IMPLEMENTED | `sanitizeCsvCell()` in `src/lib/utils.ts` |
| API inputs explicitly validated | IMPLEMENTED | All POST routes have field-level validation |
| Import payload validated end-to-end | IMPLEMENTED | `validateAndNormalizeAppSnapshot()` |

### A06 — Insecure Design

| Control | Status | Evidence / Notes |
|---|---|---|
| Domain operations are pure functions with explicit invariants | IMPLEMENTED | `src/lib/domain-engine.ts` |
| Storage round-trip invariant (domain → serialize → validate → deserialize) | IMPLEMENTED | Tests JJ–LL |
| Safe corrupt storage recovery (no data loss) | IMPLEMENTED | `AppContext.tsx` recovery flow |
| Authorization model designed before backend | PARTIAL | Documented; not yet enforced |
| Secrets management designed | PARTIAL | Policy documented; no backend yet |

### A07 — Authentication Failures

| Control | Status | Evidence | Notes |
|---|---|---|---|
| Authentication | PLANNED | No backend yet | Planned with JWT / Supabase Auth |
| Session management | PLANNED | No sessions yet | |
| Password policy | PLANNED | | |
| MFA support | PLANNED | | |
| Brute force protection | PLANNED | | |

### A08 — Software or Data Integrity Failures

| Control | Status | Evidence / Notes |
|---|---|---|
| Storage schema versioning | IMPLEMENTED | `SCHEMA_VERSION = 1` in `src/lib/storage-schema.ts` |
| Unknown future schema version rejected | IMPLEMENTED | `validateAndNormalizeAppSnapshot()` |
| Legacy (unversioned) snapshot migration | IMPLEMENTED | v0 → v1 migration path |
| Import validates before replacing state | IMPLEMENTED | Atomic swap only after full validation |
| Corrupt import leaves current state untouched | IMPLEMENTED | `AppContext.importDatabaseJSON` |
| Domain ↔ storage round-trip invariant | IMPLEMENTED | Tests JJ–LL |
| Subresource Integrity (SRI) for CDN resources | NOT APPLICABLE | No external CDN resources |

### A09 — Security Logging and Alerting Failures

| Control | Status | Evidence / Notes |
|---|---|---|
| Security audit logging design | PARTIAL | `docs/security/audit-logging.md` — designed, not yet implemented |
| No sensitive data in logs | IMPLEMENTED | `console.error` calls use `safeErrorMessage()` — no stack traces, no payloads |
| Storage errors visible to user | IMPLEMENTED | `storageStatus` / `storageError` in AppContext |
| Future: centralized log aggregation | PLANNED | |

### A10 — Mishandling of Exceptional Conditions

| Control | Status | Evidence / Notes |
|---|---|---|
| Centralized error model | IMPLEMENTED | `src/lib/error.ts` — `AppErrorCode`, `domainError()`, `safeErrorMessage()` |
| Stack traces not surfaced to users | IMPLEMENTED | `safeErrorMessage()` strips stack |
| JSON parse errors handled safely | IMPLEMENTED | All JSON.parse calls wrapped in try/catch |
| Storage save failures reported to user | IMPLEMENTED | `SAVE_ERROR` status, `retrySave()` |
| Oversized import rejected before parse | IMPLEMENTED | `MAX_IMPORT_BYTES = 5 MB` check |
| API error responses sanitized | IMPLEMENTED | No stack traces in API responses |

---

## OWASP API Security Top 10:2023 Mapping

| Category | Status | Notes |
|---|---|---|
| API1 — Broken Object Level Authorization | PLANNED | No backend yet; ownership model documented |
| API2 — Broken Authentication | PLANNED | No authentication yet |
| API3 — Broken Object Property Level Authorization | IMPLEMENTED | POST routes return explicit allowlist only (no arbitrary echo) |
| API4 — Unrestricted Resource & Rate Limiting | PARTIAL | Content-Length + payload size checks; no rate limiting yet |
| API5 — Broken Function Level Authorization | PLANNED | No roles yet; all routes are public demo |
| API6 — Unrestricted Access to Sensitive Business Flows | PARTIAL | Domain engine enforces financial invariants; no auth gating yet |
| API7 — Server Side Request Forgery (SSRF) | NOT APPLICABLE | No user-controlled URL fetching |
| API8 — Security Misconfiguration | IMPLEMENTED | Demo-only headers, input validation on all POST routes |
| API9 — Improper Inventory Management | PARTIAL | All routes documented; no versioning strategy yet |
| API10 — Unsafe Consumption of APIs | NOT APPLICABLE | No third-party API consumption currently |

---

## Remaining Known Risks

1. **No authentication** — all local data is unprotected if device is shared
2. **localStorage not encrypted** — financial data stored in plaintext in browser storage
3. **CSP uses `unsafe-inline` / `unsafe-eval`** — required by Next.js; nonce-based CSP is a future improvement
4. **No rate limiting** — API routes have no throttle; low risk for demo/client-side
5. **XLSX dependency** — see `docs/security/dependency-policy.md` for migration path
6. **No server-side receipt validation** — client-side only; full validation pipeline is future work
7. **No audit logging implemented** — designed only
