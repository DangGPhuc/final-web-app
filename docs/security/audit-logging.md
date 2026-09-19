# Audit Logging Policy & Architecture — FinTrack Pro v2

> **Scope**: Specification and requirements for recording security, financial lifecycle, and data integrity events within FinTrack Pro v2.

---

## 1. Objectives

1. **Integrity Assurance**: Provide an undeniable audit trail of all financial mutations, reconciliations, and balance alterations.
2. **Incident Detection & Forensics**: Enable rapid detection of tampering, schema corruption, quota failures, or unauthorized access.
3. **Regulatory Readiness**: Lay the foundation for personal finance data regulations (GDPR/Personal Data Protection Decree No. 13/2023/NĐ-CP).

---

## 2. Event Taxonomy

### A. Data Integrity & Storage Events

| Event Code | Name | Severity | Trigger |
|---|---|---|---|
| `STORAGE_CORRUPT_DETECTED` | Corrupt Storage Snapshot | ERROR | `JSON.parse` failure or schema validation rejection on reload |
| `STORAGE_RECOVERY_CREATED` | Recovery Key Preserved | WARN | Raw corrupted payload written to `fintrack_recovery_corrupt_<timestamp>` |
| `STORAGE_SAVE_FAILED` | LocalStorage Write Quota Failure | ERROR | Browser rejects `setItem` (localStorage full or disabled) |
| `SCHEMA_MIGRATION_EXECUTED`| Schema Auto-Migration | INFO | Snapshot migrated from legacy v0 to v1 schema |
| `DATABASE_IMPORT_SUCCESS` | Snapshot Restored | INFO | User imports valid JSON snapshot |
| `DATABASE_IMPORT_FAILED`  | Snapshot Import Rejected | WARN | User attempts to import invalid or oversized JSON |

### B. Financial Mutations & Invariants

| Event Code | Name | Severity | Trigger |
|---|---|---|---|
| `TX_GOAL_DEPOSIT` | Goal Deposit | INFO | Wallet funds transferred to savings goal |
| `TX_GOAL_WITHDRAWAL` | Goal Withdrawal | INFO | Goal funds transferred back to asset wallet |
| `TX_BILL_PAYMENT` | Bill Paid | INFO | Linked payment transaction created for recurring bill |
| `TX_BILL_REVERSAL` | Bill Payment Undone | WARN | Bill unpay executed; coordinated transaction removal |
| `WALLET_DEBT_LIMIT_WARN` | Credit Card Limit Exceeded | WARN | Transaction rejected due to credit card limit check |
| `WALLET_DELETED` | Wallet Removed | WARN | Zero-balance, unreferenced wallet deleted |

### C. Data Export & Disclosure

| Event Code | Name | Severity | Trigger |
|---|---|---|---|
| `DATA_EXPORT_JSON` | Full Database JSON Export | WARN | User downloads complete application database |
| `DATA_EXPORT_CSV` | CSV Export | INFO | User exports transactions to CSV |
| `DATA_EXPORT_XLSX` | Excel Export | INFO | User exports financial summary to Excel |

---

## 3. Log Entry Schema

Each audit event adheres to the following structured JSON format:

```json
{
  "eventId": "evt_01J7K3M4P9X8Z1Q...",
  "timestamp": "2026-09-17T14:30:00.000Z",
  "eventType": "STORAGE_CORRUPT_DETECTED",
  "severity": "ERROR",
  "actor": {
    "userId": "usr_demo_local",
    "ipAddress": "127.0.0.1",
    "userAgent": "Mozilla/5.0..."
  },
  "resource": {
    "type": "STORAGE_SNAPSHOT",
    "id": "fintrack_pro_v2_data"
  },
  "details": {
    "errorReason": "Giao dịch chuyển khoản tx-002 thiếu transferKind",
    "recoveryKey": "fintrack_recovery_corrupt_1758119400000",
    "actionTaken": "RECOVERY_REQUIRED mode entered; original data not overwritten"
  },
  "status": "FAILURE"
}
```

---

## 4. Privacy & Masking Rules

1. **No Account Numbers / Full Card Numbers**: Mask bank accounts to last 4 digits (e.g., `•••• 5824`).
2. **No Secret Tokens**: Authentication tokens or passwords must NEVER appear in audit details.
3. **PII Minimization**: Notes containing user-entered text must be truncated or hashed if written to centralized cloud logging.

---

## 5. Storage & Retention

- **Client Storage Phase**: In-memory event collection during session; exportable in diagnostic reports.
- **PostgreSQL / Supabase Backend Phase**:
  - Dedicated append-only `audit_logs` table.
  - Insert-only permissions via PostgreSQL RLS (no UPDATE or DELETE for application users).
  - Retention requirement: Minimum 365 days for financial transaction events.
