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
   - Never paste `POSTGRES_PASSWORD`, `DATABASE_URL`, `GOOGLE_CLIENT_SECRET`, `OWNER_SECRET_KEY`, or `TOKEN_ENCRYPTION_KEY` into AI chat prompts, logs, GitHub issues, or pull requests.
   - Never request or store user Google account passwords or banking login passwords. FinTrack operates exclusively via OAuth 2.0 tokens (`gmail.readonly`) and bank notification emails.
2. **Local Isolation & Compose Environment**:
   - The persistent PostgreSQL database must bind strictly to `127.0.0.1` (IPv4 loopback). Do not expose port 5432 to public or external networks.
   - Standardize all Docker Compose commands using `--env-file .env.local` to safely interpolate private variables without passing the entire file into the container environment.
3. **Dedicated Test Mailbox Requirement**:
   - **DO NOT** execute initial E2E tests against your primary personal or business Gmail mailbox.
   - Use a **dedicated secondary Gmail account** configured as a Google Cloud OAuth Test User, seeded with controlled forwarded bank notification emails.
4. **Authoritative Transaction Ledger**:
   - Balance is calculated strictly as `SUM(IN) - SUM(OUT)`. The schema stores normalized `BankTransaction` records. Manual category classification or fund allocation organizes cashflow but never modifies the raw transaction amount or ledger balance.

---

## 2. Separation of Responsibilities

| Activity | Performed By | Details / Constraints |
|---|---|---|
| Google Cloud Platform Setup & OAuth Client Creation | **USER (Manual)** | Must be executed directly in Google Cloud Console. Automation will never handle or prompt for Google credentials. |
| Generating Local Secrets (`openssl rand -hex ...`) | **USER (Local Terminal)** | Executed directly on user workstation; values stored exclusively in `.env.local`. |
| Populating `.env.local` with Real Credentials | **USER (Local Editor)** | Kept strictly private and gitignored. |
| Test Email Seeding (VCB, Techcombank samples) | **USER (Manual Email)** | Send controlled forwarded notification emails to the dedicated test Gmail account. |
| Database Provisioning (`docker compose --env-file .env.local ...`) | **AUTOMATED / ASSISTANT** | Local Docker Compose setup on `127.0.0.1:5432`. |
| Schema Synchronization (`npm run prisma:db:push:real`) | **AUTOMATED / CLI** | Synchronizes Prisma schema safely with persistent PostgreSQL via explicit .env.local runner. |
| Schema & Client Validation (`npm run prisma:validate:real`, `npm run prisma:generate:real`) | **AUTOMATED / CLI** | Validates schema and regenerates Prisma Client safely. |
| Verification Test Suite (`npm test`, `npm run typecheck`) | **AUTOMATED / ASSISTANT** | Ensures all regression and security gates pass cleanly. Integration tests require an explicit disposable database (`DATABASE_TEST_URL`) and fail closed against `personal_finance`. |

---

## 3. Google Cloud Console Setup (USER MANUAL ACTIONS)

Follow these exact steps in your web browser. Note that Google periodically refreshes its console navigation; use the current **Google Auth Platform** / **APIs & Services** sections:

### Step 3.1: Create / Select Google Cloud Project
1. Navigate to [Google Cloud Console](https://console.cloud.google.com/).
2. Log in with your developer Google account.
3. In the top navigation bar, click the project selector -> **New Project**.
4. Project Name: `FinTrack Cockpit Test` (or preferred name).
5. Click **Create** and ensure the project is active.

### Step 3.2: Enable Gmail API
1. In the left navigation, go to **APIs & Services** -> **Library** (or search "Gmail API").
2. Select **Gmail API** and click **Enable**.

### Step 3.3: Configure Google Auth Platform (Consent Screen & Audience)
Google Cloud Console organizes OAuth consent under **Google Auth Platform** (or **APIs & Services -> OAuth consent screen**):

1. **Branding / App Information**:
   - **App name**: `FinTrack Personal Finance Cockpit`
   - **User support email**: Select your developer email.
   - **Developer contact information**: Enter your email.
   - Click **Save and Continue**.
2. **Audience / Publishing Status**:
   - User Type: Select **External**.
   - **Publishing status**: Keep strictly in **Testing** mode. Do NOT click "Publish App".
   - **Test users**: Under Test Users, click **Add Users** and enter the email address of your **dedicated secondary test Gmail account** (e.g. `your-test-account@gmail.com`).
   - Click **Save and Continue**.
3. **Data Access / Scopes**:
   - Click **Add or Remove Scopes**.
   - Request strictly only what FinTrack uses:
     - `.../auth/userinfo.email` (`email`)
     - `.../auth/userinfo.profile` (`profile`)
     - `openid`
     - `https://www.googleapis.com/auth/gmail.readonly` (Read resources from Gmail)
   - Click **Update** -> **Save and Continue**.

> [!WARNING]
> **Testing Mode 7-Day Authorization Limitation**:
> In Google Cloud Testing mode, refresh tokens issued to External test users expire after **7 days**. During this Phase-5 E2E integration, needing to reconnect after 7 days is expected Google platform behavior and does not indicate an application defect. Long-running production use requires completing Google verification later. Do not switch the app to Production status during this phase.

> [!IMPORTANT]
> **Restricted Scope Verification Boundary**:
> `https://www.googleapis.com/auth/gmail.readonly` is categorized by Google as a **Restricted Scope**. Testing with designated test accounts in Testing mode is fully permitted for development and E2E verification. A future public production release with this scope requires Google OAuth App Verification and a Cloud Application Security Assessment (CASA). The private GitHub repository status does not exempt a production deployment from Google's verification process.

### Step 3.4: Create OAuth 2.0 Client Credentials (Clients)
1. In the left navigation, go to **Google Auth Platform -> Clients** (or **APIs & Services -> Credentials**).
2. Click **+ Create Credentials** -> **OAuth client ID**.
3. Application type: Select **Web application**.
4. Name: `FinTrack Web Cockpit (Local Dev)`.
5. **Authorized JavaScript origins**:
   - Click **+ Add URI** -> `http://localhost:3000`
6. **Authorized redirect URIs**:
   - Click **+ Add URI** -> `http://localhost:3000/api/google/callback`
7. Click **Create**.
8. Copy the **Client ID** and **Client Secret**.
   - *Note*: Google may take 1–5 minutes to propagate new OAuth client configuration changes.
   - Place these values strictly into your local `.env.local`. Never paste them into chat or commit them.

---

## 4. Local Secret Generation & `.env.local` Setup

On your local workstation terminal, generate cryptographically random keys using `openssl`:

```bash
# 1. Generate TOKEN_ENCRYPTION_KEY (64 hex characters / 32 bytes)
openssl rand -hex 32

# 2. Generate OWNER_SECRET_KEY (64 hex characters / 32 bytes)
openssl rand -hex 32

# 3. Generate POSTGRES_PASSWORD (48 hex characters / 24 bytes)
# Using hex characters ensures safe embedding in DATABASE_URL without URL-encoding issues.
openssl rand -hex 24
```

Create or update `.env.local` in the project root:

```env
# ── Local Persistent PostgreSQL 17 Configuration ───────────────
POSTGRES_USER=fintrack
POSTGRES_PASSWORD=<paste_48_hex_chars_from_openssl_rand_hex_24>
POSTGRES_DB=personal_finance
POSTGRES_PORT=5432

# DATABASE_URL must match the local POSTGRES_* settings above exactly
DATABASE_URL=postgresql://fintrack:<same_48_hex_chars_as_above>@127.0.0.1:5432/personal_finance

# ── Token Encryption (AES-256-GCM Master Key) ───────────────────
TOKEN_ENCRYPTION_KEY=<paste_64_hex_chars_from_openssl_rand_hex_32>

# ── Single-Owner Authentication Boundary ───────────────────────
OWNER_SECRET_KEY=<paste_64_hex_chars_from_openssl_rand_hex_32>

# ── Canonical Application Origin ───────────────────────────────
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

> [!IMPORTANT]
> **Phase-5 Environment Architecture**:
> - `.env.local` is the sole Phase-5 secret source for local operations.
> - **Docker Compose** receives private database variables via `--env-file .env.local`.
> - **Next.js** automatically loads `.env.local` as local application environment.
> - **Prisma CLI** operational commands execute through the explicit, fail-closed safe wrapper (`scripts/run-prisma-real-env.mjs`).
> - This architecture keeps all operational components aligned on the exact same private environment source without copying secrets into tracked `.env`.
> - **DO NOT** duplicate real secrets into `.env`.
> - **DO NOT** rename `.env.local` to `.env`.

Verify Docker Compose variable interpolation safely without printing secrets:
```bash
docker compose --env-file .env.local config --quiet
# Validates Compose syntax and required variable presence, returning exit code 0 on success.
```

> [!WARNING]
> **Do not render interpolated Compose configuration in recorded terminals**:
> Avoid running `docker compose config` without `--quiet` in shared or recorded terminals, as it renders the plain `POSTGRES_PASSWORD`. If needed for troubleshooting, never copy the rendered output into chat, tickets, or GitHub.

---

## 5. Controlled Test Mailbox & Forwarding Strategy

Because synthetic emails sent from personal Gmail accounts will not match Vietnamese bank-domain sender headers (`@vietcombank.com.vn`, `@techcombank.com.vn`), test emails must utilize the **Forwarded Bank Notification** clause implemented in `buildBankSearchQuery()`:
`(("Fwd:" OR "chuyển tiếp" OR "forwarded message") AND (vietcombank OR techcombank OR mbbank OR acb OR vpbank OR bidv) AND ("biến động" OR "số dư" OR "giao dịch"))`

Seed your dedicated test Gmail account with messages matching the exact formats below:

### Sample 1: Forwarded Vietcombank Credit (IN)
- **Subject**: `Fwd: Vietcombank - biến động số dư`
- **Body**:
  ```text
  VCB: TK ••••1234 | GD: +5,000,000 VND | 15/09/2026 10:30:00 | Mã GD: VCB262580001 | Luong thang 09
  ```
- **Expected Parser Result**:
  - `bankCode`: `VCB` (Vietcombank)
  - `direction`: `IN`
  - `amount`: `5000000` VND
  - `bankRefId`: `VCB262580001`
  - `occurredAt`: `2026-09-15 10:30:00 ICT` (`2026-09-15T03:30:00Z UTC`)

### Sample 2: Forwarded Vietcombank Debit (OUT)
- **Subject**: `Fwd: Vietcombank - biến động số dư`
- **Body**:
  ```text
  VCB: TK ••••1234 | GD: -1,200,000 VND | 16/09/2026 14:15:20 | Mã GD: VCB262590002 | Thanh toan hoa don
  ```
- **Expected Parser Result**:
  - `bankCode`: `VCB` (Vietcombank)
  - `direction`: `OUT`
  - `amount`: `1200000` VND
  - `bankRefId`: `VCB262590002`
  - `occurredAt`: `2026-09-16 14:15:20 ICT` (`2026-09-16T07:15:20Z UTC`)

### Sample 3: Forwarded Techcombank Debit (OUT)
- **Subject**: `Fwd: Techcombank - biến động số dư`
- **Body**:
  ```text
  Techcombank: So tien ghi no: 350,000 VND luc 17/09/2026 09:05:00. Ma GD: FT2626011234. Dien giai: Highlands Coffee.
  ```
- **Expected Parser Result**:
  - `bankCode`: `TCB` (Techcombank)
  - `direction`: `OUT`
  - `amount`: `350000` VND
  - `bankRefId`: `FT2626011234`
  - `merchantLabel`: `Highlands Coffee`
  - `occurredAt`: `2026-09-17 09:05:00 ICT` (`2026-09-17T02:05:00Z UTC`)

### Sample 4: Forwarded Duplicate Transaction
- Forward **Sample 1** a second time to the test mailbox (fresh Gmail message ID, identical content).
- **Expected Result**: Deduplicated via `(bankCode, bankRefId)` and financial `fingerprint`. `duplicateCount` increments; 0 duplicate ledger rows created.

### Sample 5: Non-Bank Noise Email
- Send a normal newsletter or email without bank keywords.
- **Expected Result**: Excluded from search query or discarded during parsing without creating transactions.

---

## 6. Two-Stage Candidate Query & Synchronization Semantics

Understanding ingestion stages is essential for valid test execution:

1. **Stage 1 — Candidate Gmail Search Query**:
   - Uses Gmail `after:<epoch> before:<epoch>` filters based on the **Gmail message receipt/internalDate timestamp**, buffered with safety cushions.
   - For **Historical Import**, the test emails must have arrived in Gmail inside or near the selected date window. Historical import does *not* search arbitrarily old emails if their Gmail envelope date is outside the candidate window.
2. **Stage 2 — Financial Inclusion**:
   - Ingested messages are parsed to extract the financial event timestamp (`occurredAt`).
   - For Historical Import, transactions are admitted to the ledger only if `occurredAt` falls within the target date range.
3. **Quick Scan Behavior**:
   - Quick Scan queries from `lastSyncAt` (previous successful scan watermark) to the current moment.
   - Newly received forwarded emails whose financial `occurredAt` is older *are* successfully ingested by Quick Scan because their Gmail arrival time is within the scan window.

> [!NOTE]
> **Gmail API Quotas**:
> Gmail API interactions are quota-controlled by Google. For current rate limits and quotas, consult the Google Cloud Console Quotas page. Real E2E testing generates minimal traffic well within default allowances.

---

## 7. End-to-End Acceptance Checklist (Step A through Step P)

### Non-Destructive Environment Readiness Sequence:
```bash
# 1. Verify .env.local is ignored by Git
git check-ignore -v .env.local

# 2. Run zero-leak environment preflight verification
npm run preflight:real

# 3. Validate Docker Compose interpolation without leaking secrets
docker compose --env-file .env.local config --quiet

# 4. Start private PostgreSQL container
docker compose --env-file .env.local up -d postgres
docker compose --env-file .env.local ps

# 5. Validate schema, push safely, and regenerate client
npm run prisma:validate:real
npm run prisma:db:push:real
npm run prisma:generate:real

# 6. Launch development server
npm run dev
```

### [ ] STEP A — Validate & Start Private PostgreSQL 17
```bash
docker compose --env-file .env.local config --quiet
docker compose --env-file .env.local up -d postgres
docker compose --env-file .env.local ps
```
Verify container is healthy:
```bash
docker compose --env-file .env.local exec postgres pg_isready -U fintrack -d personal_finance
# Expected: personal_finance:5432 - accepting connections
```

### [ ] STEP B — Run Preflight Verification
```bash
npm run preflight:real
```
- Verify output displays `configured` for all 13 items.
- Verify `DATABASE_URL` matches `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, and `POSTGRES_PORT`.
- Verify zero secret values or keys are output to the terminal.

### [ ] STEP C — Synchronize Prisma Schema Safely
```bash
npm run prisma:validate:real
npm run prisma:db:push:real
npm run prisma:generate:real
```
- Verify Prisma schema is valid and synchronized with PostgreSQL without destructive data loss.
- Verify Prisma Client is generated for local runtime.

### [ ] STEP D — Launch Application Locally
```bash
npm run dev
# or test production build locally:
# npm run build && npm start
```

### [ ] STEP E — Access Cockpit UI
1. Navigate to: `http://localhost:3000`.
2. Verify lock screen is presented.

### [ ] STEP F — Owner Secret Unlock
1. Enter invalid secret -> verify unlock rejected with rate-limiting defense.
2. Enter authentic `OWNER_SECRET_KEY` from `.env.local` -> verify app unlocks.

### [ ] STEP G — Connect Dedicated Test Gmail (OAuth)
1. Navigate to **Cài đặt (Settings)** tab.
2. Click **Kết nối Gmail**.
3. Verify redirect to Google consent screen requesting `gmail.readonly`.
4. Grant consent with your dedicated test Gmail account.
5. Verify callback redirect to `http://localhost:3000/?tab=settings`.
6. Verify account card appears. DevTools inspection confirms `refresh_token` is never sent to browser; encrypted token is saved in DB.

### [ ] STEP H — Historical Import (Controlled Range)
1. Select date range matching test emails (e.g. `2026-09-01` to `2026-09-20`).
2. Click **Bắt đầu Đồng bộ Lịch sử**.
3. Verify VCB Credit (`+5,000,000`), VCB Debit (`-1,200,000`), and TCB Debit (`-350,000`) are imported.
4. Verify non-bank emails are ignored.

### [ ] STEP I — Authoritative Dashboard Balance
1. Navigate to **Tổng quan (Dashboard)**.
2. Verify Net Balance equals `SUM(IN) - SUM(OUT)` = `5,000,000 - 1,550,000 = 3,450,000 VND`.

### [ ] STEP J — Cashflow & Classification Triage
1. Navigate to **Dòng tiền (Cashflow)**.
2. Verify transactions display `UNCLASSIFIED` status.
3. Classify transactions into categories and assign to funds; verify status updates to `CLASSIFIED`.

### [ ] STEP K — Repeat Historical Deduplication
1. Re-run Historical Import for the exact same date range.
2. Verify: 0 new transactions added; `duplicateCount` increments; ledger balance remains unchanged.

### [ ] STEP L — Quick Scan Incremental Verification
1. Send a new forwarded test email to the mailbox.
2. Click **Quét nhanh (Quick Scan)**.
3. Verify exactly 1 transaction imported; `lastSyncAt` watermark advances only upon successful completion.

### [ ] STEP M — Multi-Account Isolation (Optional Second Account)
1. Connect a second test Gmail account if available.
2. Verify independent watermark and account card.

### [ ] STEP N — Clear Financial Data
1. In Settings -> Danger Zone, click **Xóa dữ liệu tài chính**.
2. Verify transactions, categories, and funds are purged while Gmail connection is preserved.

### [ ] STEP O — Reconnect Flow
1. In Google Account permissions, revoke FinTrack's access.
2. Run Quick Scan -> verify card transitions to `reconnect_required`.
3. Click **Kết nối lại** -> verify reconnection succeeds.

### [ ] STEP P — Factory Reset
1. In Settings -> Danger Zone, click **Factory Reset**.
2. Verify upstream revocation attempted, database cleared, session cookie removed, and lock screen restored.

---

## 8. Operational Database Commands

### Safe Database Health Check
```bash
docker compose --env-file .env.local exec postgres pg_isready -U fintrack -d personal_finance
```

### Sensitive Database Backup
> [!CAUTION]
> **Database Backups Are Sensitive**:
> Database backups contain financial transaction histories, email addresses, OAuth connection metadata, and encrypted refresh-token ciphertext. Treat backups as strictly confidential.
> - Never commit `.sql` files to Git (enforced via `.gitignore`).
> - Never upload backups to public cloud buckets.
> - Restrict local file permissions.

```bash
mkdir -p backups
docker compose --env-file .env.local exec -T postgres pg_dump -U fintrack personal_finance > backups/backup_$(date +%Y%m%d_%H%M%S).sql
chmod 600 backups/*.sql
```

### Database Restore
```bash
docker compose --env-file .env.local exec -T postgres psql -U fintrack personal_finance < backups/backup_file.sql
```

### Safely Inspect DB without Exposing Passwords
Prisma models use camelCase field names in PostgreSQL:
```bash
docker compose --env-file .env.local exec -it postgres psql -U fintrack -d personal_finance -c "\dt"

docker compose --env-file .env.local exec -it postgres psql -U fintrack -d personal_finance -c "SELECT id, \"googleSub\", email, \"lastSyncAt\", \"revokedAt\" FROM \"GmailConnection\";"

docker compose --env-file .env.local exec -it postgres psql -U fintrack -d personal_finance -c "SELECT id, \"bankCode\", \"bankRefId\", direction, amount, \"occurredAt\", \"classificationState\" FROM \"BankTransaction\" LIMIT 10;"
```

### Database Stop & Start
```bash
# Stop database (volume data preserved)
docker compose --env-file .env.local stop postgres

# Start database
docker compose --env-file .env.local start postgres
```
