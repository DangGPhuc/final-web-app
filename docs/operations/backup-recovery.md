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

## 4. Future Backend Recovery Architecture (PostgreSQL)

When migrating to a persistent database:
- **Automated Daily Backups**: Managed pg_dump exports retained for 30 days.
- **Point-in-Time Recovery (PITR)**: Write-ahead log (WAL) archiving enabling recovery to any second within a 7-day window.
- **Geo-redundant Storage**: Encrypted backup copies mirrored to a secondary region.
