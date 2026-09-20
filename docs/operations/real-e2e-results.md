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

## 2. Ingestion & Deduplication Metrics Summary

| Ingestion Metric | Historical Import Run 1 | Historical Import Run 2 (Repeat) | Incremental Quick Scan |
|---|---|---|---|
| **Date Range / Watermark** | `[e.g. 2026-09-01 to 2026-09-20]` | `[Same date range]` | `[lastSyncAt → now]` |
| **Discovered Candidate Emails** | `[Count]` | `[Count]` | `[Count]` |
| **Successfully Imported Transactions** | `[Count]` | `0` (Must be 0 on repeat) | `[Count]` |
| **Deduplicated Messages** | `0` | `[Count]` | `0` |
| **Failed / Skipped Non-Bank Emails** | `[Count]` | `[Count]` | `0` |
| **Discovered Banks** | `[e.g. VCB, TCB]` | `[e.g. VCB, TCB]` | `[e.g. VCB]` |

---

## 3. Scenario Acceptance Matrix (Step A through Step P)

| Step ID | Scenario Description | Status (`PASS` / `FAIL` / `SKIPPED`) | Verification Details / Observations |
|---|---|---|---|
| **STEP A** | Private PostgreSQL 17 Start | `[PASS/PENDING]` | Docker container healthy on `127.0.0.1:5432` |
| **STEP B** | Preflight Verification (`npm run preflight:real`) | `[PASS/PENDING]` | 9/9 items `configured`, 0 secrets printed |
| **STEP C** | Prisma Schema Sync (`npx prisma db push`) | `[PASS/PENDING]` | Schema in sync, no business migrations lost |
| **STEP D** | Local Application Launch | `[PASS/PENDING]` | Dev server or production build running on port 3000 |
| **STEP E** | Cockpit UI Initial Render | `[PASS/PENDING]` | Dark-mode theme, lock screen presented |
| **STEP F** | Owner Secret Unlock | `[PASS/PENDING]` | Correct key unlocks; invalid keys rejected |
| **STEP G** | Google OAuth Connection (`gmail.readonly`) | `[PASS/PENDING]` | Consent screen, callback redirect, DB encrypted token |
| **STEP H** | Historical Import (Controlled Range) | `[PASS/PENDING]` | Candidate messages ingested, integer VND preserved |
| **STEP I** | Authoritative Dashboard Balance | `[PASS/PENDING]` | Net Balance = `SUM(IN) - SUM(OUT)` exactly |
| **STEP J** | Cashflow & Categorization Triage | `[PASS/PENDING]` | Unclassified triage, category creation, fund assignment |
| **STEP K** | Repeat Historical Deduplication | `[PASS/PENDING]` | 0 duplicate entries added, ledger stable |
| **STEP L** | Quick Scan & Watermark Advance | `[PASS/PENDING]` | Incremental email imported, `lastSyncAt` updated |
| **STEP M** | Multi-Account Isolation | `[PASS/PENDING]` | Independent accounts, forward duplicate deduped |
| **STEP N** | Clear Financial Data | `[PASS/PENDING]` | Transactions deleted, OAuth connection retained |
| **STEP O** | Reconnect Flow on Revocation | `[PASS/PENDING]` | Transitions to `reconnect_required`, reconnects ok |
| **STEP P** | Factory Reset Purge | `[PASS/PENDING]` | Revocation attempted, all data purged, locked screen |

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

## 5. Known Limitations & Follow-up Items

- **Google Cloud Testing Mode Scope**: Unverified test apps in Google Cloud Console permit up to 100 designated test users and show an initial "Google hasn't verified this app" notice which is expected for private/local development.
- **Gmail Rate Limits**: Gmail API enforces per-user quotas (250 quota units/sec). Batch fetching respects these limits with exponential backoff.
