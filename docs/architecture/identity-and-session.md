# FinTrack Pro — Identity & Session Architecture (v2 Hardened)

## 1. Executive Summary

FinTrack Pro v2 implements **Real User Authentication** using **Google OpenID Connect (OIDC)** as the initial identity provider, secured by a hardened **Zero-Trust Auth Trust Boundary**.

### Core Architectural Principle
External OAuth/OIDC proves user identity; FinTrack continues to issue, own, and verify its own opaque session system.

```
Google OIDC (External Identity Provider)
    ↓ (code exchange + JWKS ID-token verification outside DB tx)
verified provider identity: (provider, provider_subject)
    ↓ (transaction-scoped advisory lock + atomic lookup or creation)
FinTrack auth_identity
    ↓ (1-to-1 relationship with FinTrack user; zero orphan users)
FinTrack user
    ↓ (256-bit cryptographically secure randomness)
opaque random FinTrack session
    ↓ (Set-Cookie: __Host-fintrack_session with clamped Max-Age)
HttpOnly __Host-fintrack_session cookie
    ↓ (SHA-256 hash lookup via scoped RLS)
session-hash PostgreSQL Row-Level Security (RLS)
```

---

## 2. Authentication Principles & Invariants

1. **No Password Storage**: FinTrack does not store passwords, password hashes, or implement custom credential storage.
2. **No Custom JWT Signing**: Provider tokens are validated using standards-compliant OIDC libraries; FinTrack issues high-entropy opaque random session tokens.
3. **No Tokens in LocalStorage**: External OAuth tokens and FinTrack session tokens are never accessible to client-side JavaScript or stored in `localStorage`.
4. **Provider Token Minimization**: External Google `access_token` and `refresh_token` are immediately discarded upon verifying identity claims. They are never stored in the database, logged, or returned to the client.
5. **Authoritative Identity Key**: The authoritative external identity key is `(provider, provider_subject)`. Email is informational profile metadata and **never** auto-links accounts.
6. **Explicit Email Verification Policy**: Google login requires a valid non-empty email claim where `email_verified === true`. Accounts with missing or unverified emails are rejected with `AUTH_IDENTITY_INVALID`.

---

## 3. Browser-Bound OAuth State & Login-CSRF Protection

To eliminate login-CSRF and session-swapping attacks across different browsers/devices:
1. **Transient Browser Binder**: When `/api/v2/auth/google/start` initiates an OAuth login, it generates a 32-byte cryptographically-secure random binder (`base64url`).
2. **Client-Side Cookie**: The raw binder is set on the user's browser in a transient cookie:
   - Name: `__Host-fintrack_oauth`
   - Attributes: `Secure; HttpOnly; SameSite=Lax; Path=/` (No Domain attribute)
   - Lifetime: 10 minutes (`Max-Age=600`, matching state expiration).
3. **Database Hash Storage**: PostgreSQL stores **only** `SHA-256(raw binder)` in `fintrack.oauth_login_states(browser_bind_hash)`. The raw binder is never stored in the database.
4. **Callback Validation**: The callback endpoint validates that `SHA-256(state)` and `SHA-256(__Host-fintrack_oauth)` match the **same** active row in `fintrack.oauth_login_states`. States initiated from Browser A and submitted to Browser B are rejected with `AUTH_STATE_INVALID`.
5. **Per-Browser Active State Limit**: Prior active states for the same browser binder are invalidated upon starting a new login, preventing state accumulation.
6. **Provider Error Consumption**: If Google returns a provider error (e.g., `access_denied`), the state and binder are validated and atomically consumed so stale states cannot linger or be replayed.

---

## 4. Three-Phase Callback Architecture

To avoid holding open database connections, row locks, or transactions during external network I/O:

```
+-------------------------------------------------------------------------+
| PHASE A — SHORT DB TRANSACTION (Atomic State Claim)                    |
| - Validate stateHash & browserBindHash match active unconsumed row      |
| - Verify state has not expired                                          |
| - Mark state consumed_at = now()                                        |
| - COMMIT (Releases DB connection back to pool)                          |
+-------------------------------------------------------------------------+
                                    ↓
+-------------------------------------------------------------------------+
| PHASE B — EXTERNAL NETWORK I/O (NO Database Transaction)                |
| - Perform Google authorizationCodeGrant exchange via openid-client      |
| - Cryptographically verify ID token against Google JWKS                 |
| - Execute pure validateGoogleIdentityClaims() function                 |
+-------------------------------------------------------------------------+
                                    ↓
+-------------------------------------------------------------------------+
| PHASE C — SHORT DB TRANSACTION (Identity Resolution & Session Issuance) |
| - Acquire transaction-scoped advisory lock on provider + providerSubject|
| - Lookup existing identity FOR UPDATE                                   |
| - If new user: generate server UUID (crypto.randomUUID()) & insert      |
| - Attach/update auth_identity (zero orphan user guarantee)              |
| - Revoke pre-existing FinTrack session if present                       |
| - Issue fresh FinTrack session with explicit expiration timestamp       |
| - COMMIT (Releases DB connection back to pool)                          |
+-------------------------------------------------------------------------+
```

---

## 5. Canonical Origin & Redirect URI Safety

1. **Canonical `APP_ORIGIN`**: Configured via `process.env.APP_ORIGIN` (must be HTTPS in production, no path/query/hash). The application never trusts the incoming request `Host` or `Origin` header for post-login destination redirects.
2. **Canonical Google Redirect URI**: `GOOGLE_OIDC_REDIRECT_URI` is validated against `APP_ORIGIN` at configuration/use time. Its origin must strictly equal `APP_ORIGIN` and its pathname must strictly equal `/api/v2/auth/google/callback`.
3. **Canonical OIDC Exchange URL**: `openid-client` code exchange uses a URL constructed from `GOOGLE_OIDC_REDIRECT_URI` with only query parameters copied from the incoming request, neutralizing request host header poisoning.
4. **Fetch Metadata**: `/api/v2/auth/google/start` inspects `Sec-Fetch-Site`. If present and not `same-origin`, the request is rejected with `AUTH_FORBIDDEN` (403). Direct user navigation without Fetch Metadata is permitted.

---

## 6. Concurrent First-Login & Orphan User Prevention

To guarantee that concurrent first-login attempts for the same external identity produce exactly **one** FinTrack user and **one** `auth_identity`:
1. **Advisory Xact Lock**: Before looking up or creating identity, the transaction acquires:
   ```sql
   SELECT pg_advisory_xact_lock(hashtextextended('auth-identity:' || provider || ':' || providerSubject, 0));
   ```
2. **Server-Side UUID Generation**: New user IDs are generated in trusted server code via `crypto.randomUUID()`. Users are inserted directly without `RETURNING id`, eliminating the need for `SELECT` privileges on `fintrack.users`.
3. **Lookup / Create Sequence**:
   - Identity lookup `FOR UPDATE`.
   - If present: update profile metadata, return existing `user_id`.
   - If absent: insert user with pre-generated UUID, insert identity with `ON CONFLICT (provider, provider_subject) DO UPDATE`, return `user_id`.
4. **Invariant**: Exactly one FinTrack user and one auth identity exist for any given external subject. No orphan users can be created during concurrent attempts.

---

## 7. Database Privilege Hardening (Migrations 006 & 007)

| Table / Object | `fintrack_runtime` (Financial App) | `fintrack_auth_runtime` (Authentication) | `fintrack_auth_login` / `fintrack_app_login` |
| :--- | :--- | :--- | :--- |
| `fintrack.wallets` | SELECT, INSERT, UPDATE(balance) | **NO ACCESS (0 DML)** | **NO ACCESS** |
| `fintrack.transfers` | SELECT, INSERT | **NO ACCESS (0 DML)** | **NO ACCESS** |
| `fintrack.idempotency` | SELECT, INSERT | **NO ACCESS (0 DML)** | **NO ACCESS** |
| `fintrack.rate_limits` | SELECT, INSERT, UPDATE | **NO ACCESS (0 DML)** | **NO ACCESS** |
| `fintrack.audit_events` | INSERT | **NO ACCESS (0 DML)** | **NO ACCESS** |
| `fintrack.users` | SELECT (own session user only) | **INSERT ONLY** (REVOKED SELECT) | **NO ACCESS** |
| `fintrack.sessions` | SELECT, UPDATE(revoked_at) | INSERT, SELECT/UPDATE (exact `app.auth_revoke_hash` only) | **NO ACCESS** |
| `fintrack.auth_identities` | SELECT (own session user only) | SELECT, INSERT, UPDATE (metadata only) | **NO ACCESS** |
| `fintrack.oauth_login_states`| **NO ACCESS** | SELECT, INSERT, UPDATE(consumed_at) | **NO ACCESS** |

### Policy Narrowing
- **Users**: `fintrack_auth_runtime` has `INSERT` and `REFERENCES(id)` on `fintrack.users`, but **zero SELECT** privileges. It cannot enumerate users.
- **Sessions**: `fintrack_auth_runtime` has INSERT for new sessions. SELECT and UPDATE for revocation are restricted by RLS to `token_hash = nullif(current_setting('app.auth_revoke_hash', true), '')`. It cannot enumerate or update unrelated sessions.
- **FORCE RLS**: All 9 security-sensitive tables enforce `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`.

---

## 8. Session & Cookie Expiration Invariant

- **Database Session**: Created with an explicit absolute expiration timestamp (`expires_at = now() + 24 hours`).
- **Cookie Max-Age**: Computed as `Math.floor((expiresAt.getTime() - Date.now()) / 1000)`, clamped to `<= SESSION_MAX_AGE_SECONDS`.
- **Invariant**: The browser cookie Max-Age never exceeds the database session `expires_at`.

---

## 9. Frontend Auth State Correctness

- **Failed Logout**: If `/api/v2/session/logout` returns non-200 (403, 500, 503) or encounters a network failure, the frontend preserves the authenticated state, sets an error (`LOGOUT_FAILED`), and does **not** falsely display the user as unauthenticated.
- **Backend Error vs Unauthenticated**: `/api/v2/session/me` returning 401 transitions the status to `UNAUTHENTICATED`. Non-401 non-200 responses (500, 502, 503) transition the status to `ERROR` (`AUTH_BACKEND_ERROR`), clearly separating backend downtime from session expiration.

---

## 10. Abuse Prevention & Roadmap

- **Pre-Auth Rate Limits**: Max 1 active OAuth login state per browser binder; global circuit-breaker limit of 1,000 active states.
- **Automated Retention**: `scripts/backend-maintenance.mjs` purges expired unconsumed states and consumed states older than 30 days.
- **Infrastructure WAF / IP Throttling**: Cloud WAF, L7 rate limiting, and IP reputation filtering remain **PLANNED** for production infrastructure deployment.
