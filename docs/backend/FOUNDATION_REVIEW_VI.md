# FinTrack — review và backend foundation V2 (Deployment & Security Closure)

## Kết luận và phạm vi

Bản đầu vào: Branch `fix/backend-security-hardening-v2` (SHA baseline `6b549bb706e48f9288b1b5739feaa8ee3d31098f`).
Branch thực hiện closure: `fix/backend-deployment-closure-v2`.

Iteration này hoàn thành đợt đóng toàn diện các vấn đề triển khai và vòng đời bảo mật (Backend Deployment & Security Closure) trước khi thực hiện OAuth/Identity provider, chuyển đổi frontend sang PostgreSQL, API tài chính toàn diện và private object storage.

> [!IMPORTANT]
> **Ranh giới kiến trúc & Frontend**:
> Frontend hiện tại vẫn sử dụng exclusively client-side state (`AppContext`) và `localStorage`.
> Dữ liệu tài chính người dùng trên giao diện web **CHƯA** được lưu trữ vào PostgreSQL.
> Backend PostgreSQL được bảo vệ chặt chẽ tại `/api/v2/*` (`wallets`, `transfers`, `session/logout`), tắt mặc định.
> Lần lặp tiếp theo sẽ thực hiện authenticated frontend cutover. Tuyệt đối không trộn lẫn ngầm dữ liệu giữa localStorage và database.

---

## Bảng tổng hợp các cải tiến triển khai & bảo mật (Deployment & Security Closure)

| Hạng mục | Vấn đề trước đây | Giải pháp đã triển khai (Closure) | Trạng thái |
|---|---|---|---|
| **Database Role Model** | `fintrack_runtime` có thuộc tính `NOLOGIN`, mâu thuẫn với `DATABASE_URL` thực tế | Tách bạch 2 role: `fintrack_app_login` (`LOGIN`, `NOINHERIT`, `NOSUPERUSER`, không có quyền trực tiếp trên bảng) dùng cho `DATABASE_URL`. Sau `BEGIN`, pool thực hiện `SET LOCAL ROLE fintrack_runtime` để thực thi RLS. Truy vấn trực tiếp từ login role bị từ chối fail-closed. | **IMPLEMENTED** |
| **Success-Only Logout Cookie** | Cookie bị xóa (`Max-Age=0`) ngay cả khi request lỗi (401, 403 INVALID_ORIGIN, 429, DB error) | Tách biệt `commonHeaders`, `successHeaders`, và `errorHeaders` trong `src/server/http.ts`. `Set-Cookie` xóa session chỉ được gắn khi `revokeCurrentSession()` commit thành công. HTTP status trả về 200. | **IMPLEMENTED** |
| **Stacked Rate Limiting** | Mỗi request chỉ tiêu thụ một scope đơn lẻ (global không bao trùm các route nhạy cảm) | Mọi request API đã xác thực bắt buộc tiêu thụ scope `global` (60/phút). Các thao tác nhạy cảm tiêu thụ thêm scope nghiệp vụ riêng (`wallet:create`, `transfer:create`). Vượt bất kỳ hạn mức nào đều bị chặn HTTP 429. | **IMPLEMENTED** |
| **Daily Transfer Quota** | `transfer:create` (20/phút) vẫn cho phép hàng chục ngàn transaction/ngày từ 1 user | Bổ sung hạn ngạch ngày `MAX_TRANSFERS_PER_USER_PER_DAY` (mặc định 1000/ngày theo UTC). Khóa concurrency-safe bằng advisory transaction lock `${user}:transfer-daily:${utcDate}`; trả về `TRANSFER_DAILY_LIMIT_REACHED` (422). | **IMPLEMENTED** |
| **Idempotency Retention** | Cam kết 7 ngày nhưng không có công cụ dọn dẹp thực tế | Xây dựng script vận hành `scripts/backend-maintenance.mjs` dọn dẹp bản ghi idempotency quá 8 ngày (bảo vệ cam kết 7 ngày khỏi race condition tại biên) và session hết hạn quá 30 ngày. | **IMPLEMENTED** |
| **Maintenance Credential Safety** | Script dọn dẹp fallback về `DATABASE_URL` của ứng dụng | Xóa bỏ hoàn toàn fallback. Yêu cầu bắt buộc `DATABASE_MAINTENANCE_URL` (hoặc `DATABASE_ADMIN_URL`). Từ chối chạy dưới các role ứng dụng (`fintrack_app_login`, `fintrack_runtime`). Không log `token_hash`. | **IMPLEMENTED** |
| **Audit Traceability** | `request_id` có thể null; repository mutation nhận `requestId?: string` | Chuyển `requestId: string` thành tham số bắt buộc trong repository; validate định dạng UUID hợp lệ trước khi ghi audit trail. | **IMPLEMENTED** |
| **Migration Integrity** | Không có cơ chế kỹ thuật ngăn chặn sửa đổi file migration cũ | Xây dựng `scripts/migrate.mjs` lưu trữ và xác thực SHA-256 checksum trong bảng `fintrack.schema_migrations`. Tự động từ chối (fail-closed) nếu phát hiện migration đã áp dụng bị sửa đổi. | **IMPLEMENTED** |
| **Real PostgreSQL Upgrade Test** | Kiểm thử nâng cấp migration trước đây dùng PGlite | Xây dựng test case kiểm thử trực tiếp trên PostgreSQL 17 thật: áp dụng tuần tự 001 → seed data → 002 → 003, xác thực schema invariants, balances, roles, RLS, và audit request IDs. | **IMPLEMENTED** |
| **Backup & Restore Drill** | Diễn tập trên cùng cluster che giấu việc thiếu global roles | Ghi chú rõ đây là **Database-Level Logical Restore**, không phải Fresh-Cluster DR (vì `pg_dump` không chứa `pg_roles`). Bổ sung kiểm tra ENABLE + FORCE RLS trên cả 6 bảng bảo mật, kiểm thử tenant isolation sau phục hồi. | **IMPLEMENTED** |
| **Secret Scanning Gate** | CodeQL không quét secret; chưa có CI gate thực tế | Thiết lập workflow Gitleaks `.github/workflows/secret-scan.yml` với action được ghim commit SHA 40 ký tự. | **IMPLEMENTED** |
| **Logging vs Alerting** | Tài liệu chưa phân định giữa log và cảnh báo vận hành | Cập nhật tài liệu: Structured Logging đã IMPLEMENTED; Centralized Alerting/Thresholds là PARTIAL / PLANNED. | **IMPLEMENTED** |

---

## Chi tiết kiến trúc Role Deployment Model

```
Production DATABASE_URL
  └── postgresql://fintrack_app_login:PASSWORD@host/fintrack
        │
        ├── 1. Connects as session_user = 'fintrack_app_login' (NO direct table grants)
        │
        ├── 2. BEGIN transaction
        │
        ├── 3. SET LOCAL ROLE fintrack_runtime
        │        ├── current_user becomes 'fintrack_runtime' (RLS role)
        │        └── Sets app.session_hash
        │
        ├── 4. Business queries execute under fintrack_runtime with strict RLS
        │
        └── 5. COMMIT
```

### Rủi ro tồn dư đã tài liệu hóa (Residual Risk Disclosure)
Nếu xảy ra lỗ hổng SQL injection dưới quyền `fintrack_runtime`, cơ chế RLS ngăn chặn hoàn toàn việc đọc/ghi dữ liệu của tenant khác (cross-tenant confidentiality & integrity). Tuy nhiên, các bản ghi thuộc chính tenant của attacker vẫn có thể bị chỉnh sửa trong phạm vi quyền hạn được cấp cho `fintrack_runtime`. RLS không thay thế việc tham số hóa truy vấn an toàn (parameterized queries).

---

## Hướng dẫn vận hành & Kiểm tra

### Chạy kiểm thử tự động
```bash
# Kiểm tra định kiểu
npm run typecheck

# Chạy toàn bộ test suite (bao gồm route integration & PGlite fallback)
npm test

# Chạy test suite bảo mật với PostgreSQL 17 thật (toàn bộ test O -> AD)
DATABASE_TEST_URL=postgres://postgres:ci-only-disposable-password@localhost:5432/fintrack_test npm run test:backend

# Chạy diễn tập Backup & Restore tự động
bash ./scripts/backup-restore-drill.sh
```

### Chạy Migration Runner (với Checksum Verification)
```bash
DATABASE_ADMIN_URL=postgres://postgres:ci-only-disposable-password@localhost:5432/fintrack_test node scripts/migrate.mjs
```

### Chạy bảo trì Session & Idempotency
```bash
DATABASE_MAINTENANCE_URL=postgres://postgres:ci-only-disposable-password@localhost:5432/fintrack_test node scripts/backend-maintenance.mjs
```
*(Tuyệt đối từ chối chạy dưới role `fintrack_app_login` hoặc `fintrack_runtime`)*.

---

## Bảng trạng thái triển khai chuẩn xác (Truthful Statuses)

| Hạng mục | Trạng thái | Ghi chú minh chứng |
|---|---|---|
| **Database-level logical restore** | **IMPLEMENTED** | Diễn tập tự động qua `scripts/backup-restore-drill.sh` với `umask 077`, `mktemp`, kiểm tra 6 bảng bảo mật có `ENABLE + FORCE RLS`, cách ly tenant, bảo toàn lịch sử `schema_migrations`, và xác minh qua runner `migrate.mjs`. |
| **Fresh-cluster disaster recovery** | **PARTIAL / PLANNED** | Phục hồi logical DB đã kiểm chứng. Khởi tạo roles trên cluster mới đòi hỏi bootstrap có kiểm soát phiên bản trước khi restore. |
| **Authentication** | **PARTIAL / PLANNED** | Xác thực session, băm an toàn, thu hồi session phía server đã hoàn thành. OAuth / passwordless login dự kiến ở iteration kế tiếp. |
| **Centralized monitoring + alerting** | **PARTIAL / PLANNED** | Structured security logging với `request_id` hoàn chỉnh qua `src/server/logger.ts`. Alerting và ngưỡng cảnh báo tập trung (Prometheus/Slack) là PLANNED. |
| **Frontend PostgreSQL cutover** | **PLANNED** | Frontend hiện dùng client state / `localStorage`. Cutover sang backend DB dự kiến ở iteration kế tiếp. |
| **Private object storage** | **PLANNED** | Lưu trữ hóa đơn private dự kiến sau khi hoàn tất auth. |
| **Managed encrypted backup** | **PLANNED** | Diễn tập logical dump đã kiểm chứng. Sao lưu mã hóa KMS quản lý trên hạ tầng cloud là PLANNED. |
| **Point-in-Time Recovery (PITR)** | **PLANNED** | Sao lưu liên tục WAL và PITR trên multi-cluster là PLANNED cho hạ tầng cloud. Disaster recovery toàn diện chưa được công bố. |

> [!IMPORTANT]
> **Quyền sở hữu bảng**: Các role runtime ứng dụng (`fintrack_runtime`, `fintrack_app_login`) **KHÔNG** sở hữu bất kỳ bảng nào trong database. Bảng được tạo và sở hữu hoàn toàn bởi role operator / migration. `transaction()` kiểm tra và xác nhận 0 table ownership cho login role lúc kết nối.

