# Data Storage Architecture — FinTrack Pro v2

> **Status**: Planned architecture for production deployment.
> Current state: client-side localStorage only. No backend exists yet.
> Do NOT claim any infrastructure is implemented unless source code proves it.

---

## A. Primary Structured Data — PostgreSQL

PostgreSQL is the **intended production source of truth** for all structured application data.

### Intended tables

| Domain | Tables |
|---|---|
| Identity | `users`, `user_profiles` |
| Wallets | `wallets` |
| Transactions | `transactions`, `transaction_tags` |
| Categories | `categories` (user-specific overrides + system defaults) |
| Budgets | `budgets` |
| Bills | `recurring_bills`, `bill_occurrences` |
| Goals | `savings_goals`, `goal_movements` |
| Simulation | `simulation_scenarios` |
| Support | `support_tickets` |
| Audit | `audit_events`, `security_events_metadata` |

### Production requirements

- **TLS** for all connections
- **Encrypted storage at rest** (managed-PostgreSQL provider default)
- **Encrypted backups**
- **No public database port** — database must not be reachable from the public internet
- **Least-privilege DB role** — application runtime user has only SELECT, INSERT, UPDATE, DELETE; NOT DDL, NOT superuser
- **Separate migration role** — schema migrations run with a distinct, elevated role that is NOT used by the application runtime
- **Parameterized queries / ORM** — no string concatenation into SQL
- **Automated volume/database backup** (see Backup & Recovery)
- **Capacity monitoring** with alerting
- **Connection pooling** (PgBouncer or provider equivalent)

### Every user-owned table must include

```sql
user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE
```

Every query from the application layer must enforce:

```sql
WHERE id = $1 AND user_id = $authenticated_user_id
```

**Row Level Security (RLS)** on Supabase/PostgreSQL is the defense-in-depth layer.
RLS must not be bypassed via service-role key from client code.

---

## B. Block Storage

Block storage is the **underlying storage volume** for the PostgreSQL database files.

### Design decisions

- Block storage is **NOT exposed directly to application users**.
- Application code never interacts with block storage APIs.
- **Prefer provider-managed PostgreSQL** (e.g., Supabase, AWS RDS, Neon, Render Postgres) — the block volume is managed transparently by the provider.

### Requirements (if self-managing)

- Encryption at rest
- Encrypted volume snapshots
- Restricted network access (no public attach point)
- Automated snapshot schedule
- Capacity monitoring and alerting

---

## C. NFS / Shared Filesystem Storage

**NFS is NOT required for the current FinTrack Pro v2 architecture.**

The application is designed as a single-server deployment (or stateless serverless functions). No shared filesystem is needed.

**Only introduce NFS if:**
- A future self-hosted deployment has a **concrete, proven requirement** for shared filesystem access across multiple application servers, AND
- No better alternative (S3-compatible object storage, database) is available.

**NEVER store on NFS:**
- Database primary data files
- Session tokens or cookies
- Application secrets or environment variables

---

## D. Object Storage (Future)

Object storage is intended for **user-generated binary content**:

| Use case | Notes |
|---|---|
| Receipt images | Attached to transactions |
| User-generated exports | Large backup artifacts |
| Large import artifacts | If needed in future |

### Production requirements

| Requirement | Rationale |
|---|---|
| **Private buckets** — no public access by default | Prevents unauthorized access to financial receipts |
| **Random server-generated object keys** | Prevents enumeration attacks |
| **Per-user ownership metadata** | Enforces authorization checks |
| **Signed / time-limited download URLs** | Objects never directly exposed |
| **Object size limits** | Prevents abuse / storage exhaustion |
| **MIME allowlist** (JPEG, PNG, WEBP only) | Prevents executable content upload |
| **Magic-byte / file-signature validation** | Server-side only; browser MIME is untrustworthy |
| **Optional malware scanning pipeline** | Especially important if receipts can be shared |
| **Lifecycle policies** | Auto-delete orphaned objects |
| **Versioning** where appropriate | Recovery from accidental deletion |
| **Encryption at rest** | Financial data is sensitive |

**SVG is excluded** from the MIME allowlist because SVG files can contain active content (scripts, external references) that introduces XSS risk even when served as `image/svg+xml`.

**Object keys must NEVER be derived from user input** (filename, description, email, etc.).

---

## E. Backup & Recovery

### Recovery targets (student / demo deployment)

| Target | Value |
|---|---|
| RPO (Recovery Point Objective) | ≤ 24 hours |
| RTO (Recovery Time Objective) | ≤ 4 hours |

For stronger production requirements, **Point-in-Time Recovery (PITR)** via managed PostgreSQL can reduce RPO to minutes.

### Required backup strategy

**PostgreSQL:**
- Automated daily full backup
- Provider PITR enabled where available
- Encrypted snapshots
- Retention: minimum 7 days (30 days recommended for production)
- Backup credentials: separate from application runtime credentials, least privilege, NOT embedded in source code

**Object Storage:**
- Versioning enabled
- Lifecycle retention policy
- Accidental-delete protection (if available from provider)
- Backups stored in a separate account / bucket from primary

### Backup security

- All backups encrypted in transit and at rest
- Backup access credentials are **separate from application runtime credentials**
- Backup credentials have **read-only or restore-only** privilege
- Restoration is **tested periodically** — an untested backup is not a verified backup

### Local snapshot (current phase)

During the current client-side phase, user data is stored in browser localStorage.
- On corrupt/invalid snapshot: a recovery copy is saved under `fintrack_recovery_corrupt_<timestamp>`
- The original corrupt data is **never automatically overwritten** by the application
- The user must explicitly confirm reset/import to replace corrupt state

---

## F. Current Phase — localStorage

Until the PostgreSQL backend is implemented:

| Item | Value |
|---|---|
| Storage key | `quan_ly_chi_tieu_data_v2` |
| Schema version | `SCHEMA_VERSION = 1` (in `src/lib/storage-schema.ts`) |
| Max import payload | 5 MB |
| Recovery key pattern | `fintrack_recovery_corrupt_<timestamp>` |
| Save guard | RECOVERY_REQUIRED status blocks auto-save until user confirms |
