# Backup & Recovery Runbook — FinTrack Pro v2

> **Scope**: Operating procedures for data resilience, disaster recovery, corrupt snapshot preservation, and backup restoration in FinTrack Pro v2.

---

## 1. Resilience Philosophy

Financial data cannot be recreated from memory. The core storage engine enforces three fundamental safeguards:

1. **Non-Destructive Failure**: When storage data cannot be parsed or validated, the app **NEVER** overwrites it with default data.
2. **Automated Quarantine**: Raw corrupted snapshots are immediately cloned to an immutable quarantine key before any fallback data is mounted.
3. **Transparent Notification**: The user is alerted immediately via `StorageStatusBanner` with options to export, repair, or retry.

---

## 2. Storage Key Architecture

| Key | Lifecycle | Purpose |
|---|---|---|
| `fintrack_pro_v2_data` | Active | Primary JSON snapshot loaded on startup and saved on state change. |
| `fintrack_recovery_corrupt_<timestamp>` | Quarantine / Immutable | Preserved raw byte string when primary data fails parsing or validation. |
| `fintrack_active_tab` | Transient | UI tab persistence (e.g. `'dashboard'`, `'wallets'`). |
| `fintrack_theme` | Transient | Theme preference (`'light'` / `'dark'`). |

---

## 3. Operational Runbooks

### Runbook A: Corrupted Snapshot Detected at Startup (`RECOVERY_REQUIRED`)

**Symptom**: User opens FinTrack Pro v2 and sees an amber banner: *"Chế độ phục hồi dữ liệu an toàn: Dữ liệu không vượt qua kiểm tra tính toàn vẹn..."*

**Procedure**:
1. **Do not close browser cache**: The corrupted data is intact.
2. Open Browser Developer Tools (`F12` -> `Application` -> `Storage` -> `Local Storage`).
3. Locate the key `fintrack_recovery_corrupt_<timestamp>`.
4. Copy the raw string content into an editor (e.g. VS Code).
5. Inspect the error message shown in the banner (e.g. *"ID giao dịch trùng lặp"* or *"Giao dịch tx-xxx thiếu transferKind"*).
6. Fix the JSON syntax or referential issue.
7. Click **"Cài đặt" (Settings) -> "Nhập dữ liệu JSON"** and upload the corrected JSON file.
8. Verify all accounts and transactions appear accurately.

---

### Runbook B: LocalStorage Quota Exceeded (`SAVE_ERROR`)

**Symptom**: User adds a transaction, bill, or receipt and sees a red banner: *"Lỗi lưu trữ dữ liệu cục bộ: Không thể ghi dữ liệu vào localStorage..."*

**Procedure**:
1. **Do not refresh the page**: New changes are in RAM. Refreshing will discard unsaved mutations.
2. Click **"Xuất bản sao lưu ngay"** on the banner to download `fintrack_backup_<timestamp>.json`.
3. Clear unnecessary browser cache or remove orphaned test keys from `localStorage`.
4. If attached receipt images are excessively large, remove them from recent transactions.
5. Click **"Thử lưu lại"** to test if write succeeds.
6. Once the banner disappears, status has returned to `OK`.

---

### Runbook C: Scheduled Regular Backup

**Cadence**: Recommended weekly or before updating browser / clearing browser data.

**Procedure**:
1. Navigate to **"Cài đặt" (Settings)** tab.
2. Under **"Dữ liệu & Sao lưu"**, click **"Xuất toàn bộ dữ liệu (JSON)"**.
3. A file named `fintrack_backup_YYYY-MM-DD.json` will be downloaded.
4. Verify file contents: Ensure `"schemaVersion": 1` is present at the root level.
5. Store in secure personal storage (e.g., encrypted cloud drive).

---

### Runbook D: Restoring from a Backup File

**Procedure**:
1. Navigate to **"Cài đặt" (Settings)** tab.
2. Under **"Dữ liệu & Sao lưu"**, click **"Nhập dữ liệu JSON"**.
3. Select your `.json` backup file.
4. The system automatically:
   - Validates file size (rejected if > 5 MB).
   - Validates schema structure, references, and versions via `validateAndNormalizeAppSnapshot()`.
   - If valid, hydrates all wallets, transactions, budgets, bills, and goals.
   - If invalid, aborts immediately without modifying current application state.

---

## 4. PostgreSQL Database-Level Restore Drill & Limitations

> [!IMPORTANT]
> **Database-Level Restore Only**: FinTrack's automated drill (`scripts/backup-restore-drill.sh`) performs a **Database-Level Logical Restore**, not a fresh-cluster disaster recovery. PostgreSQL `pg_dump` exports schema and table objects for a specific database but **DOES NOT serialize cluster-wide global objects** such as roles (`pg_roles`).
> On a newly instantiated, blank PostgreSQL cluster/container, disaster recovery procedures MUST first run the version-controlled migration/bootstrap scripts (`001_backend_foundation.sql` through `003_backend_deployment_closure.sql`) to provision the cluster-level roles (`fintrack_runtime`, `fintrack_app_login`) before restoring database dumps.

### Security Invariants Validated on Restore
Every logical restore drill verifies:
1. **Cluster Role Dependency**: Validates that backup files do not contain cluster-global role declarations, requiring operator bootstrap.
2. **Mandatory Row-Level Security**: Verifies that `relrowsecurity = true` AND `relforcerowsecurity = true` (FORCE RLS) on **all 6 security tables**:
   - `fintrack.sessions`
   - `fintrack.wallets`
   - `fintrack.transfers`
   - `fintrack.idempotency`
   - `fintrack.audit_events`
   - `fintrack.rate_limits`
3. **Tenant Data Isolation**: Verifies that restoring preserves row security by executing queries under `fintrack_runtime` for separate tenants (Alice vs. Bob) and asserting zero cross-tenant leakage.
4. **Login Privilege Sandboxing**: Connects as `fintrack_app_login`, executes `SET LOCAL ROLE fintrack_runtime`, sets `app.session_hash`, and asserts `current_session_user_id()` correctly resolves.
5. **Ledger & Audit Parity**: Validates account balances match the cumulative transfer ledger and all transfer mutations correlate with a valid `request_id` in `fintrack.audit_events`.

---

## 5. Storage Growth & Retention Policies

| Table | Nature | Retention Policy | Maintenance Purge | Notes |
|---|---|---|---|---|
| `transfers` | Durable Ledger | Permanent (Indefinite) | **NEVER** | Immutable financial double-entry transaction history. Must NEVER be deleted merely to reduce storage. |
| `audit_events` | Durable Compliance | Permanent (Indefinite) | **NEVER** | Security audit trail correlating mutations with `request_id` and actor. Retained for compliance. |
| `idempotency` | Mutation Dedup | Minimum 7 days | Yes (> 8 days) | Guaranteed public retention is at least 7 days. Operator cleanup purges records older than 8 days to prevent boundary races. |
| `sessions` | Auth State | 30 days post-expiry | Yes (> 30 days) | Expired or revoked sessions retained for 30 days for forensic investigation, then purged. |
| `rate_limits` | Traffic Throttling | Transient / Bounded | Yes | In-memory/database counters partitioned by minute buckets. Kept strictly bounded. |

### Operational Maintenance Automation
Operator maintenance tasks are executed via:
```bash
DATABASE_MAINTENANCE_URL=postgresql://fintrack_admin:.../fintrack node scripts/backend-maintenance.mjs
```
- **Operator-Only Authentication**: Refuses to run if connected as application roles (`fintrack_app_login` or `fintrack_runtime`).
- **Zero Token Leaks**: Sessions are deleted without `RETURNING token_hash`.
- **Atomic Operations**: Deletions execute within batched transactions reporting purged row counts only.

