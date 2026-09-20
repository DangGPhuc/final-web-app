# Real Environment E2E Execution Evidence — FinTrack Cockpit

> **Phase**: Phase 5 — Real Environment Integration  
> **Status**: TEMPLATE & EXECUTION EVIDENCE LOG  
> **Target Branch**: `refactor/personal-finance-cockpit`  
> **CONFIDENTIALITY NOTICE**:
> Strictly NON-SECRET evidence only.
> Never include:
> - Raw email bodies or sender/recipient personal email addresses.
> - OAuth tokens (access tokens, refresh tokens, auth codes, PKCE verifiers).
> - Google Client Secret, Client ID, or Owner Secret Key.
> - Real database passwords or full connection strings.
> - Personal identifiable information (PII) or real bank account numbers.

---

## 1. Test Environment Metadata

| Field | Configuration / Value | Notes |
|---|---|---|
| **E2E Execution Date & Time** | `[YYYY-MM-DD HH:MM:SS TZ]` | Record when the run was completed |
| **Application Git Commit SHA** | `[COMMIT_SHA]` | Head commit under test |
| **Node.js Runtime** | `[e.g. Node v24.16.0]` | From `process.version` |
| **PostgreSQL Version** | `PostgreSQL 17.4-alpine` | Private localhost container (`127.0.0.1:5432`) |
| **Database Driver / ORM** | `@prisma/client 6.19.3` | Standard PostgreSQL connection pool |
| **Browser Tested** | `[e.g. Chrome 134 / Firefox 136]` | User verification browser |
| **OAuth Consent Mode** | `Google Cloud Testing Mode` | Restricted to authorized test accounts |
| **Number of Test Gmail Accounts** | `[e.g. 1 or 2]` | Dedicated secondary test accounts |

---

## 2. Environment Readiness Gates

| Readiness Gate | Status | Command / Verification Check | Notes |
|---|---|---|---|
| **Preflight real env** | `PASS` | `npm run preflight:real` | 13/13 items configured, 0 secrets printed |
| **Compose config validation** | `PASS` | `docker compose --env-file .env.local config --quiet` | Interpolation valid, exit code 0 |
| **PostgreSQL start** | `PASS` | `docker compose --env-file .env.local up -d postgres` | Container healthy on `127.0.0.1:5432` |
| **Prisma validate real env** | `PASS` | `npm run prisma:validate:real` | Schema parsed and valid |
| **Prisma db push real env** | `PASS` | `npm run prisma:db:push:real` | Schema synchronized without data loss |
| **Prisma generate real env** | `PASS` | `npm run prisma:generate:real` | Client generated cleanly |
| **Real Google OAuth** | `PASS` | Browser OAuth callback flow | Tokens encrypted and stored in DB |

---

## 3. Ingestion & Deduplication Metrics Summary

| Ingestion Metric | Historical Import Run 1 | Historical Import Run 2 (Repeat) | Incremental Quick Scan |
|---|---|---|---|
| **Date Range / Watermark** | `2026-09-01 to 2026-09-20` | `2026-09-01 to 2026-09-20` | `lastSyncAt → now` |
| **Discovered Candidate Emails** | Real forwarded emails | Same candidate window | Real incremental email |
| **Successfully Imported Transactions** | VCB & TCB parsed (IN/OUT) | `0` (Must be 0 on repeat) | Incremental bank notification |
| **Deduplicated Messages** | `0` | Deduplicated via fingerprint | `0` |
| **Failed / Skipped Non-Bank Emails** | Excluded | Excluded | Excluded |
| **Discovered Banks** | VCB, TCB | VCB, TCB | VCB |

---

## 4. Scenario Acceptance Matrix (Step A through Step P)

| Step ID | Scenario Description | Status (`PASS` / `FAIL` / `PENDING`) | Verification Details / Observations |
|---|---|---|---|
| **STEP A** | Private PostgreSQL 17 Start | `PASS` | Docker container healthy on `127.0.0.1:5432` |
| **STEP B** | Preflight Verification (`npm run preflight:real`) | `PASS` | 13/13 items `configured`, 0 secrets printed |
| **STEP C** | Safe Prisma Schema Push (`npm run prisma:db:push:real`) | `PASS` | Schema in sync via explicit `.env.local` runner |
| **STEP D** | Local Application Launch | `PASS` | Server running on `http://localhost:3000` |
| **STEP E** | Cockpit UI Initial Render | `PASS` | Dark-mode theme, lock screen presented on initial visit |
| **STEP F** | Owner Secret Unlock | `PASS` | Authentic secret unlocks cockpit; invalid keys rejected |
| **STEP G** | Google OAuth Connection (`gmail.readonly`) | `PASS` | Consent screen, callback redirect, DB encrypted token |
| **STEP H** | Historical Import (Controlled Range) | `PASS` | Real Gmail API candidate search & parsing of VCB/TCB |
| **STEP I** | Authoritative Dashboard Balance | `PASS` | Net Balance = `SUM(IN) - SUM(OUT)` exactly, integer VND |
| **STEP J** | Cashflow & Categorization Triage | `PASS` | Unclassified triage, manual classification to categories & funds |
| **STEP K** | Repeat Historical Deduplication | `PASS` | 0 duplicate entries added on re-import, ledger stable |
| **STEP L** | Quick Scan & Watermark Advance | `PASS` | Incremental email imported, `lastSyncAt` watermark advances |
| **STEP M** | Multi-Account Isolation | `PASS` | Multiple accounts isolated, forwarding duplicate deduped |
| **STEP N** | Clear Financial Data | `PASS` | Transactions deleted, Gmail preserved, historical re-import ok |
| **STEP O** | Reconnect Flow on Revocation | `PASS` | External revoke triggers `reconnect_required`, reconnect succeeds |
| **STEP P** | Factory Reset Purge | `PENDING REAL RETEST` | **Defect found during initial run**: data wipe PASS, Gmail removal PASS, owner-session termination FAIL (UI remained unlocked). **Fix applied**: server deletes `cockpit_owner_session` cookie; client resets state & transitions to lock screen immediately without `refreshData()`. Awaiting real user retest. |

---

## 4. Sanitized Parser Verification Samples

*(No account numbers, personal names, or exact confidential transactions logged)*

```json
[
  {
    "scenario": "VCB Credit Transaction",
    "parsedBankCode": "VCB",
    "direction": "IN",
    "amount": "5000000",
    "currency": "VND",
    "hasBankRefId": true,
    "hasFingerprint": true,
    "occurredAtPreserved": true
  },
  {
    "scenario": "VCB Debit Transaction",
    "parsedBankCode": "VCB",
    "direction": "OUT",
    "amount": "1200000",
    "currency": "VND",
    "hasBankRefId": true,
    "hasFingerprint": true,
    "occurredAtPreserved": true
  },
  {
    "scenario": "TCB Debit Transaction",
    "parsedBankCode": "TCB",
    "direction": "OUT",
    "amount": "350000",
    "currency": "VND",
    "hasBankRefId": true,
    "hasFingerprint": true,
    "occurredAtPreserved": true
  },
  {
    "scenario": "Forwarded Duplicate Ingestion",
    "outcome": "DEDUPLICATED",
    "matchingStrategy": "bankCode_bankRefId_or_fingerprint",
    "duplicateCountIncremented": true
  }
]
```

---

## 5. Known Limitations & Operational Considerations

- **Google Cloud Testing Mode Scope**: Unverified test apps in Google Cloud Console permit up to 100 designated test users and show an initial "Google hasn't verified this app" warning which is expected for private/local development.
- **Testing Mode 7-Day Refresh Token Lifetime**: In Google Cloud Testing mode, OAuth refresh tokens for external test users expire after 7 days; periodic re-authentication is expected platform behavior during extended testing.
- **Restricted Scope Verification**: Production deployments utilizing `https://www.googleapis.com/auth/gmail.readonly` require official Google OAuth App Verification and security assessments regardless of repository visibility.
- **Gmail API Quotas**: Gmail API interactions are quota-controlled by Google. For current rate limits and quotas, consult the Google Cloud Console Quotas page.
