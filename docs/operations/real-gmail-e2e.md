# Real Environment Integration Runbook — FinTrack Personal Finance Cockpit

> **Phase**: Phase 5 — Real Environment Integration  
> **Status**: OPERATIONAL RUNBOOK (Manual Actions Required by User)  
> **Target Branch**: `refactor/personal-finance-cockpit`  
> **Applicability**: Local persistent PostgreSQL 17 + Real Google OAuth 2.0 (`gmail.readonly`)

---

## 1. Security Invariants & Golden Rules

Before executing any operation in this runbook, adhere strictly to these non-negotiable security boundaries:

1. **Zero Secret Leakage**:
   - Never commit `.env.local` or any file containing plaintext credentials to git.
   - Never paste `GOOGLE_CLIENT_SECRET`, `OWNER_SECRET_KEY`, `TOKEN_ENCRYPTION_KEY`, or `DATABASE_URL` with credentials into AI chat prompts, logs, GitHub issues, or pull request descriptions.
   - Never request or store user Google account passwords or banking login passwords. FinTrack operates exclusively via OAuth 2.0 tokens (`gmail.readonly`) and bank notification emails.
2. **Local Isolation**:
   - The persistent PostgreSQL database must bind strictly to `127.0.0.1` (IPv4 loopback). Do not expose port 5432 to public or external networks.
3. **Dedicated Test Mailbox Requirement**:
   - **DO NOT** execute initial E2E tests against your primary personal or business Gmail mailbox.
   - Use a **dedicated secondary Gmail account** configured with controlled test bank notification emails.
4. **Authoritative Ledger Guarantee**:
   - Double-entry ledger balance is authoritative: `SUM(IN) - SUM(OUT)`. Manual category classification or budget allocation never changes the raw transaction amount or ledger balance.

---

## 2. Separation of Responsibilities

| Activity | Performed By | Details / Constraints |
|---|---|---|
| Google Cloud Project Setup & OAuth Client Creation | **USER (Manual)** | Must be done directly in Google Cloud Console. Anti-IDE will never automate or prompt for Google login. |
| Generating Local Secrets (`openssl rand -hex 32`) | **USER (Local Terminal)** | Executed directly on user's machine; values stored only in `.env.local`. |
| Populating `.env.local` with Real Credentials | **USER (Local Editor)** | Kept strictly private and gitignored. |
| Test Email Seeding (VCB, Techcombank samples) | **USER (Manual Email)** | Send controlled notification emails to the dedicated test Gmail account. |
| Database Provisioning (`docker-compose.yml`) | **AUTOMATED / ASSISTANT** | Local Docker Compose setup on `127.0.0.1:5432`. |
| Preflight Verification (`npm run preflight:real`) | **AUTOMATED / ASSISTANT** | Validates config sanity without printing any secret values. |
| Schema Migration (`npx prisma db push`) | **AUTOMATED / CLI** | Applies Prisma schema safely to persistent PostgreSQL. |
| Verification Test Suite (`npm test`, `npm run typecheck`) | **AUTOMATED / ASSISTANT** | Ensures all regression and security gates pass cleanly. |

---

## 3. Google Cloud Console Setup (USER MANUAL ACTIONS)

Follow these exact steps in your web browser:

### Step 3.1: Create / Select Google Cloud Project
1. Navigate to [Google Cloud Console](https://console.cloud.google.com/).
2. Log in with your developer Google account.
3. Click the Project dropdown in the top navigation bar and click **New Project**.
4. Project Name: `FinTrack Cockpit Test` (or any preferred identifier).
5. Click **Create** and ensure the project is active.

### Step 3.2: Enable Gmail API
1. Open the navigation menu -> **APIs & Services** -> **Library**.
2. Search for `Gmail API`.
3. Select **Gmail API** and click **Enable**.

### Step 3.3: Configure OAuth Consent Screen
1. In the left navigation, click **APIs & Services** -> **OAuth consent screen**.
2. User Type: Select **External** and click **Create**.
3. App information:
   - **App name**: `FinTrack Personal Finance Cockpit`
   - **User support email**: Select your developer email.
   - **Developer contact information**: Enter your email.
4. Click **Save and Continue**.
5. Scopes:
   - Click **Add or Remove Scopes**.
   - Select:
     - `.../auth/userinfo.email` (`email`)
     - `.../auth/userinfo.profile` (`profile`)
     - `openid`
     - `https://www.googleapis.com/auth/gmail.readonly` (Read resources from Gmail)
   - Click **Update** -> **Save and Continue**.
6. Test users:
   - Click **Add Users**.
   - Enter the email address of your **dedicated secondary test Gmail account** (e.g. `your-test-account@gmail.com`).
   - Click **Add** -> **Save and Continue**.
7. Publishing status:
   - **CRITICAL**: Keep publishing status in **Testing** mode. Do NOT click "Publish App".
   - In Testing mode, only explicitly authorized test users can authenticate, preventing unintended access.

### Step 3.4: Create OAuth 2.0 Client Credentials
1. In the left navigation, click **APIs & Services** -> **Credentials**.
2. Click **+ Create Credentials** -> **OAuth client ID**.
3. Application type: Select **Web application**.
4. Name: `FinTrack Web Cockpit (Local Dev)`.
5. **Authorized JavaScript origins**:
   - Click **+ Add URI** -> enter: `http://localhost:3000`
6. **Authorized redirect URIs**:
   - Click **+ Add URI** -> enter: `http://localhost:3000/api/google/callback`
7. Click **Create**.
8. A modal will display your **Client ID** and **Client Secret**.
   - Copy **Client ID**.
   - Copy **Client Secret**.
   - **WARNING**: Do NOT share, commit, or paste these into any AI chat window. Put them directly into your local `.env.local`.

---

## 4. Local Secret Generation & `.env.local` Setup

On your local workstation terminal, generate two cryptographically secure 256-bit random keys:

```bash
# Generate TOKEN_ENCRYPTION_KEY (64 hex characters / 32 bytes)
openssl rand -hex 32

# Generate OWNER_SECRET_KEY (64 hex characters / 32 bytes)
openssl rand -hex 32
```

Create or edit `.env.local` in the project root:

```env
# ── Database (Persistent Local PostgreSQL 17) ──────────────────
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/personal_finance

# ── Token Encryption (AES-256-GCM Master Key) ───────────────────
TOKEN_ENCRYPTION_KEY=<paste_64_hex_chars_from_openssl_rand_hex_32>

# ── Single-Owner Authentication Boundary ───────────────────────
OWNER_SECRET_KEY=<paste_64_hex_chars_from_openssl_rand_hex_32>

# ── Application Origin ──────────────────────────────────────────
APP_ORIGIN=http://localhost:3000

# ── Google OAuth 2.0 Credentials ───────────────────────────────
GOOGLE_CLIENT_ID=<paste_client_id_from_google_cloud_console>
GOOGLE_CLIENT_SECRET=<paste_client_secret_from_google_cloud_console>
GOOGLE_REDIRECT_URI=http://localhost:3000/api/google/callback

# ── Environment Safety Flags ───────────────────────────────────
ALLOW_DEMO_DATA=false
ALLOW_MOCK_OAUTH=false
```

Verify that `.env.local` is ignored by Git:
```bash
git check-ignore -v .env.local
# Expected output: .gitignore:21:.env.local	.env.local
```

---

## 5. Controlled Test Mailbox Strategy

To rigorously validate ingestion, parsing, deduplication, and watermark handling without exposing private data, seed your dedicated test mailbox with controlled sample emails representing these 9 distinct scenarios:

### Sample 1: Vietcombank Credit (IN)
- **Subject**: `Bien dong so du tai khoan VCB ...`
- **Body snippet**:
  ```text
  So du TK 0011000123456 +5,000,000 VND luc 15-09-2026 10:30:00.
  So du: 15,000,000 VND.
  Ref: VCB.262580001. Luong thang 09.
  ```
- **Expected Parser Result**:
  - `bankCode`: `VCB`
  - `direction`: `IN`
  - `amount`: `5000000`
  - `occurredAt`: `2026-09-15 10:30:00`
  - `bankRefId`: `VCB.262580001`

### Sample 2: Vietcombank Debit (OUT)
- **Subject**: `Bien dong so du tai khoan VCB ...`
- **Body snippet**:
  ```text
  So du TK 0011000123456 -1,200,000 VND luc 16-09-2026 14:15:20.
  So du: 13,800,000 VND.
  Ref: VCB.262590002. Thanh toan hoa don dien nuoc.
  ```
- **Expected Parser Result**:
  - `bankCode`: `VCB`
  - `direction`: `OUT`
  - `amount`: `1200000`
  - `occurredAt`: `2026-09-16 14:15:20`
  - `bankRefId`: `VCB.262590002`

### Sample 3: Techcombank Transaction (TCB)
- **Subject**: `Thong bao bien dong so du Techcombank`
- **Body snippet**:
  ```text
  Giao dich: -350,000 VND luc 17/09/2026 09:05:00 tai Highlands Coffee.
  So du kha dung: 13,450,000 VND.
  So tham chieu: FT2626011234.
  ```
- **Expected Parser Result**:
  - `bankCode`: `TCB`
  - `direction`: `OUT`
  - `amount`: `350000`
  - `bankRefId`: `FT2626011234`

### Sample 4: Forwarded Duplicate Transaction
- Forward **Sample 1** a second time to the test mailbox, or send the exact same bank reference and event details with a fresh Gmail message ID.
- **Expected Result**: System deduplicates via `(bankCode, bankRefId)` or financial event fingerprint (`fingerprint`). `duplicateCount` increments; 0 duplicate entries created in ledger.

### Sample 5: Two Distinct Same-Amount Transactions
- Two distinct expenses of `-200,000 VND` at different times or with different bank reference IDs.
- **Expected Result**: Both transactions are imported safely as distinct ledger events.

### Sample 6: Transaction Without Bank Reference ID
- Bank notification email containing date, direction, and amount, but omitting reference ID.
- **Expected Result**: Ingestion uses fallback content fingerprinting (`fingerprint = sha256(bankCode:occurredAt:amount:direction:counterparty)`). Successfully imports.

### Sample 7: Forwarded Email Delayed Timestamp
- An email forwarded days after the financial event occurred.
- **Expected Result**: `occurredAt` captures the financial event timestamp from email body; `emailReceivedAt` captures the Gmail envelope date. Ledger respects `occurredAt`.

### Sample 8: Non-Bank Email Noise
- Normal non-bank emails (newsletters, receipts without supported bank patterns, marketing emails).
- **Expected Result**: Ingestion ignores non-matching emails (`fetchedCount` records scan, `importedCount` is 0).

---

## 6. End-to-End Acceptance Checklist (Step A through Step P)

Execute each step sequentially:

### [ ] STEP A — Start Private PostgreSQL 17
```bash
docker compose up -d postgres
docker compose ps
```
Verify container is healthy:
```bash
docker compose exec postgres pg_isready -U postgres -d personal_finance
# Expected: personal_finance:5432 - accepting connections
```

### [ ] STEP B — Run Preflight Verification
```bash
npm run preflight:real
```
- Verify output displays `configured` for all 9 items.
- Verify exit code is `0`.
- Verify zero secret values or keys are output to the terminal.

### [ ] STEP C — Apply Prisma Schema Safely
```bash
npx prisma db push
```
- Verify Prisma Client is generated and schema is synchronized with PostgreSQL.

### [ ] STEP D — Run Application Locally
```bash
npm run dev
# or test production build locally:
# npm run build && npm start
```

### [ ] STEP E — Open Web Cockpit
1. Navigate to: `http://localhost:3000`.
2. Verify the application loads cleanly with dark-mode aesthetic.

### [ ] STEP F — Verify Owner Unlock
1. Verify the **Owner Unlock Screen** prompts for the `OWNER_SECRET_KEY`.
2. Attempt entering an invalid secret; verify unlock is rejected with rate-limiting protection.
3. Enter the authentic `OWNER_SECRET_KEY` configured in `.env.local`.
4. Verify application unlocks and displays the Cockpit dashboard.

### [ ] STEP G — Connect Dedicated Test Gmail
1. Navigate to **Cài đặt (Settings)** tab.
2. Under **Tài khoản Gmail & Đồng bộ**, click **Kết nối Gmail**.
3. Verify redirect to Google OAuth consent screen (`accounts.google.com`).
4. Confirm requested scope is restricted to:
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `email`, `profile`, `openid`
5. Select your dedicated test Gmail account and grant consent.
6. Verify successful callback redirect to `http://localhost:3000/?tab=settings`.
7. Verify Gmail account card appears in Settings displaying avatar and email.
8. **Network Inspection**: Inspect browser DevTools Network tab:
   - Verify `refresh_token` is **NEVER** present in any HTTP response payload.
   - Verify encrypted token is stored server-side in PostgreSQL `GmailConnection.encryptedRefreshToken`.

### [ ] STEP H — Historical Import (Controlled Date Range)
1. In Settings, configure Historical Import date range matching your test email dates (e.g. `2026-09-01` to `2026-09-20`).
2. Click **Bắt đầu Đồng bộ Lịch sử**.
3. Verify:
   - Discovered candidate emails match test data.
   - Correct IN / OUT directions.
   - Exact integer amounts (e.g. `5000000`, `1200000`).
   - Correct bank code parsed (`VCB`, `TCB`).
   - `occurredAt` matches bank transaction time.
   - Non-bank noise emails are discarded.

### [ ] STEP I — Authoritative Dashboard Verification
1. Navigate to **Tổng quan (Dashboard)** tab.
2. Verify Total Income = `SUM(IN)`.
3. Verify Total Expense = `SUM(OUT)`.
4. Verify Net Balance = `SUM(IN) - SUM(OUT)`.
5. Verify balances calculate immediately without requiring manual categorization.

### [ ] STEP J — Cashflow & Classification Verification
1. Navigate to **Dòng tiền (Cashflow)** tab.
2. Verify newly imported transactions display status badge: `UNCLASSIFIED`.
3. Perform manual classification:
   - Assign an income transaction to a Category (e.g. `Lương`).
   - Assign an expense transaction to a Category (e.g. `Điện nước`).
   - Assign to a Fund (e.g. `Chi phí sinh hoạt`).
4. Verify status updates to `CLASSIFIED`.

### [ ] STEP K — Deduplication Repeat Test
1. Re-run Historical Import for the **exact same date range**.
2. Verify:
   - `importedCount`: `0`
   - `duplicateCount`: increments by number of previously imported messages.
   - Dashboard balances and transaction table remain strictly unchanged.

### [ ] STEP L — Quick Scan Incremental Verification
1. Send a new controlled bank notification email to the test mailbox.
2. Click **Quét nhanh (Quick Scan)**.
3. Verify:
   - Exactly 1 new transaction is imported.
   - `lastSyncAt` watermark advances only upon completion.
   - Run Quick Scan immediately again; verify `0` new transactions imported.

### [ ] STEP M — Multi-Account Verification (Optional Second Test Account)
1. If a second test account is available, connect it.
2. Verify independent account card and independent `lastSyncAt` watermark.
3. Test forwarded cross-account email; verify deduplication via `fingerprint`.

### [ ] STEP N — Clear Financial Data
1. Navigate to **Cài đặt** -> **Vùng Nguy hiểm (Danger Zone)**.
2. Click **Xóa dữ liệu tài chính (Clear Financial Data)**.
3. Verify:
   - Bank transactions, categories, funds, and snapshots are purged.
   - Gmail OAuth connection is **retained**.
4. Re-run Historical Import; verify transactions re-import cleanly from scratch.

### [ ] STEP O — Reconnect Flow
1. In Google Account Security settings (`myaccount.google.com/permissions`), revoke FinTrack's OAuth access.
2. In FinTrack, attempt a Quick Scan.
3. Verify the account status transitions to `reconnect_required`.
4. Click **Kết nối lại (Reconnect)**; verify OAuth consent completes and account status restores to active.

### [ ] STEP P — Factory Reset
1. In Settings -> Danger Zone, click **Factory Reset (Khôi phục Cài đặt Gốc)**.
2. Verify:
   - Server attempts Google OAuth token revocation (`https://oauth2.googleapis.com/revoke`).
   - All Gmail connections and encrypted tokens are purged from database.
   - All financial ledgers and snapshots are purged.
   - Owner session cookie is cleared; app returns to pristine Lock Screen.

---

## 7. Operational Database Commands

### Database Health Check
```bash
docker compose exec postgres pg_isready -U postgres -d personal_finance
```

### Safe Database Backup
Exports logical SQL dump without secrets:
```bash
docker compose exec -T postgres pg_dump -U postgres personal_finance > backup_$(date +%Y%m%d_%H%M%S).sql
```

### Safe Database Restore
```bash
docker compose exec -T postgres psql -U postgres personal_finance < backup_file.sql
```

### Database Stop & Start
```bash
# Stop database (preserves data in Docker volume)
docker compose stop postgres

# Start database
docker compose start postgres

# Tear down completely (WARNING: only with -v to wipe volume)
# docker compose down
```

### Safely Inspect DB without Exposing Passwords
```bash
docker compose exec -it postgres psql -U postgres -d personal_finance -c "\dt"
docker compose exec -it postgres psql -U postgres -d personal_finance -c "SELECT id, google_sub, email, last_sync_at, revoked_at FROM \"GmailConnection\";"
```
