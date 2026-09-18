# FinTrack Pro — Identity & Session Architecture (v2)

## 1. Executive Summary

FinTrack Pro v2 introduces **Real User Authentication** using **Google OpenID Connect (OIDC)** as the initial external identity provider.

### Core Architectural Principle
External OAuth/OIDC proves user identity; FinTrack continues to issue, own, and verify its own opaque session system.

```
Google OIDC
    ↓ (code exchange + JWKS ID-token verification)
verified provider identity: (provider, provider_subject)
    ↓ (atomic lookup or creation)
FinTrack auth_identity
    ↓ (1-to-1 or 1-to-many relationship)
FinTrack user
    ↓ (256-bit cryptographically secure randomness)
opaque random FinTrack session
    ↓ (Set-Cookie)
HttpOnly __Host-fintrack_session cookie
    ↓ (SHA-256 hash lookup)
existing session-hash PostgreSQL Row-Level Security (RLS)
```

---

## 2. Authentication Principles & Invariants

1. **No Password Storage**: FinTrack does not implement custom password storage, password hashes, or credential verification.
2. **No Custom JWT Signing**: Provider tokens are validated using standards-compliant OIDC libraries; FinTrack does not issue custom JWTs.
3. **No Tokens in LocalStorage**: Neither external OAuth tokens (access/refresh/ID) nor FinTrack session tokens are ever placed in `localStorage` or accessible to client-side JavaScript.
4. **Provider Token Minimization**: External Google `access_token` and `refresh_token` are immediately discarded upon verifying identity claims. They are never stored in the database, logged, or returned to the client.
5. **Authoritative Identity Key**: The authoritative external identity key is `(provider, provider_subject)`. Email is considered informational contact metadata and is **never** used alone to link accounts.

---

## 3. Standards-Compliant OIDC Library

FinTrack uses `openid-client` (maintained by Filip Skokan / Panva), an IETF certified OpenID Connect client library:
- **Discovery**: Fetches and caches OpenID configuration (`https://accounts.google.com/.well-known/openid-configuration`) and Google public certificates (JWKS).
- **Cryptographic Verification**: Verifies ID Token JWS signatures (RS256) against Google JWKS.
- **Claims Enforcement**: Validates issuer (`iss`), audience (`aud`), expiration (`exp`), and nonce.
- **PKCE Support**: Automates RFC 7636 PKCE S256 code challenge generation and verification.

---

## 4. Database Schema (Migration 006)

### `fintrack.auth_identities`
Maps external identity claims to internal FinTrack users:
- `id`: UUID primary key.
- `user_id`: UUID references `fintrack.users(id)` ON DELETE CASCADE.
- `provider`: Provider identifier (e.g. `'google'`).
- `provider_subject`: Authoritative external subject ID from provider (`sub` claim).
- `email`: User email (nullable).
- `email_verified`: Boolean indicating provider email verification status.
- `display_name`: User full name (nullable).
- `avatar_url`: User profile image URL (nullable).
- `created_at`: Timestamp.
- `last_login_at`: Timestamp updated on each successful login.
- **Unique Constraint**: `UNIQUE(provider, provider_subject)`.

### `fintrack.oauth_login_states`
Short-lived transient authentication state:
- `state_hash`: SHA-256 hash of high-entropy OAuth state (primary key).
- `provider`: Provider name.
- `code_verifier`: PKCE code verifier (S256).
- `nonce_hash`: SHA-256 hash of OIDC nonce.
- `redirect_path`: Strictly validated relative local return path.
- `expires_at`: Expiration timestamp (~10 minutes lifetime).
- `consumed_at`: One-time consumption timestamp (prevents replay).
- `created_at`: Timestamp.

---

## 5. Database Role Privilege Matrix

Application access is segregated between financial runtime operations and authentication operations:

| Table / Object | `fintrack_runtime` (Financial App) | `fintrack_auth_runtime` (Authentication) | `fintrack_app_login` / `fintrack_auth_login` |
| :--- | :--- | :--- | :--- |
| `fintrack.wallets` | SELECT, INSERT, UPDATE(balance) | **NO ACCESS (0 DML)** | **NO ACCESS** |
| `fintrack.transfers` | SELECT, INSERT | **NO ACCESS (0 DML)** | **NO ACCESS** |
| `fintrack.idempotency` | SELECT, INSERT | **NO ACCESS (0 DML)** | **NO ACCESS** |
| `fintrack.rate_limits` | SELECT, INSERT, UPDATE | **NO ACCESS (0 DML)** | **NO ACCESS** |
| `fintrack.audit_events` | INSERT | **NO ACCESS (0 DML)** | **NO ACCESS** |
| `fintrack.users` | SELECT (own session user only) | SELECT, INSERT | **NO ACCESS** |
| `fintrack.sessions` | SELECT, UPDATE(revoked_at) | SELECT, INSERT, UPDATE(revoked_at) | **NO ACCESS** |
| `fintrack.auth_identities` | SELECT (own session user only) | SELECT, INSERT, UPDATE | **NO ACCESS** |
| `fintrack.oauth_login_states`| **NO ACCESS** | SELECT, INSERT, UPDATE(consumed_at) | **NO ACCESS** |

Both login roles (`fintrack_app_login` and `fintrack_auth_login`) have `LOGIN`, `NOINHERIT`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOBYPASSRLS` and hold zero direct DML table privileges.

---

## 6. FinTrack Session Issuance & Cookie Security

Upon identity verification:
1. **Entropy**: Generates 32 bytes (256 bits) of cryptographically secure randomness via Node `randomBytes(32)` encoded as 43-character base64url string.
2. **Hashing**: Computes `SHA-256(rawToken)`. Only the 64-character hex hash is written to `fintrack.sessions(token_hash)`.
3. **Fixation Prevention**: If the browser sends an existing session cookie during callback, the previous session is revoked before the new session is committed.
4. **Cookie Attributes**:
   - Name: `__Host-fintrack_session`
   - Attributes: `Secure; HttpOnly; SameSite=Lax; Path=/`
   - Domain: **Omitted** (enforces host-only origin binding).
   - Max-Age: Exactly aligns with database `expires_at` (24 hours / 86,400 seconds).

---

## 7. Safe Session Inspection (`/api/v2/session/me`)

The `/api/v2/session/me` endpoint returns safe, user-facing identity fields only:
```json
{
  "success": true,
  "data": {
    "userId": "uuid",
    "displayName": "User Name",
    "avatarUrl": "https://...",
    "email": "user@example.com"
  }
}
```
Headers strictly include `Cache-Control: no-store` and `Vary: Cookie`. Tokens, hashes, provider secrets, and internal states are never exposed.

---

## 8. Maintenance & Abuse Prevention

- **Pre-Auth Abuse Boundary**: Outstanding unconsumed OAuth login states are strictly bounded (`MAX_OUTSTANDING_OAUTH_STATES = 1000`). Stale states expire after 10 minutes.
- **Automated Retention**: `scripts/backend-maintenance.mjs` purges expired unconsumed states immediately and consumed states older than 30 days.
- **Open Redirect Protection**: `redirect_path` is strictly validated to allow only local relative paths (rejects scheme, `//`, `/\`, and encoded bypasses).
