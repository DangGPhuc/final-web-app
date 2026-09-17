# FinTrack — review và backend foundation V2 (Security Hardened)

## Kết luận và phạm vi

Bản đầu vào: ZIP `final-web-app-backend-foundation-v2.zip`, branch `feature/backend-foundation-v2` (SHA baseline `746e5cd1812d1fe6a30704d741db53fc3992c512`).
Branch thực hiện hardening: `fix/backend-security-hardening-v2`.

Iteration này hoàn thành đợt hardening bảo mật toàn diện cho backend foundation trước khi tích hợp authentication người dùng thật và cutover frontend.

> [!IMPORTANT]
> **Ranh giới kiến trúc & Frontend**:
> Frontend hiện tại vẫn sử dụng exclusively client-side state (`AppContext`) và `localStorage`.
> Dữ liệu tài chính người dùng trên giao diện web **CHƯA** được lưu trữ vào PostgreSQL.
> Backend PostgreSQL được bảo vệ chặt chẽ tại `/api/v2/*` (`wallets`, `transfers`, `session/logout`), tắt mặc định.
> Lần lặp tiếp theo sẽ thực hiện authenticated frontend cutover. Tuyệt đối không trộn lẫn ngầm dữ liệu giữa localStorage và database.

---

## Các cải tiến bảo mật đã hoàn thành (Security Hardening Iteration)

| Hạng mục | Vấn đề trước đây | Giải pháp đã triển khai (Hardened) | Trạng thái |
|---|---|---|---|
| **RLS Trust Root** | RLS tin cậy `app.user_id` (có thể bị giả mạo nếu có SQL injection) | Chuyển hoàn toàn sang `fintrack.current_session_user_id()` tra cứu từ `app.session_hash` (high-entropy secret). `app.user_id` bị loại bỏ và có ZERO tác dụng phân quyền. | **IMPLEMENTED** |
| **Legacy Demo APIs** | `/api/*` và `/api/simulation/what-if` vẫn mở ở production | Tắt toàn bộ route `/api/*` ở `NODE_ENV=production` (trả về HTTP 404). `ENABLE_DEMO_API=true` bị vô hiệu hóa hoàn toàn ở production. | **IMPLEMENTED** |
| **Rate Limit Storage** | Bảng `rate_limits` phình to vô hạn theo từng phút (unbounded rows) | Thiết kế lại bảng với khóa chính `(user_id, scope)`. Reset bucket/hits tại chỗ; số dòng luôn cố định ở mức tối đa 1 dòng/user/scope. Bổ sung các scope nghiệp vụ: `global` (60/phút), `wallet:create` (10/phút), `transfer:create` (20/phút). | **IMPLEMENTED** |
| **Quota tài nguyên ví** | Người dùng có thể tạo không giới hạn ví | Giới hạn tối đa `MAX_WALLETS_PER_USER = 100`. Kiểm tra an toàn đồng thời bằng advisory transaction lock `${user}:wallet-create`; trả về mã lỗi chuẩn `WALLET_LIMIT_REACHED` (422). | **IMPLEMENTED** |
| **Logout & Revocation** | Chưa có cơ chế thu hồi session đã cấp | Thêm `POST /api/v2/session/logout`. Cấp quyền tối thiểu `UPDATE(revoked_at)` cho `fintrack_runtime` chỉ trên chính session hiện tại qua RLS `session_revoke`. Xóa cookie `__Host-fintrack_session` (`Max-Age=0`, `HttpOnly`, `Secure`, `SameSite=Lax`, không Domain). Đặt khóa hàng `FOR SHARE` trong mutation để xung đột an toàn với logout. | **IMPLEMENTED** |
| **Audit Traceability** | Bảng `audit_events` thiếu request ID | Bổ sung cột `request_id uuid` vào `fintrack.audit_events`, đồng bộ với header response `X-Request-Id` để phục vụ đối soát và hỗ trợ người dùng mà không lưu payload nhạy cảm. | **IMPLEMENTED** |
| **Migration Discipline** | Cần cập nhật schema có kiểm soát | Giữ nguyên `001_backend_foundation.sql`. Bổ sung `002_backend_security_hardening.sql`. Kiểm thử CI cả clean install và kịch bản nâng cấp 001 → 002. | **IMPLEMENTED** |
| **Idempotency Policy** | Bản ghi idempotency không hết hạn, chưa rõ hợp đồng | Bổ sung index `(user_id, created_at)`. Xác lập hợp đồng cam kết: Idempotency keys được đảm bảo 7 ngày. Quá hạn 7 ngày bản ghi được dọn dẹp bởi tác vụ vận hành out-of-band. Thêm hàm query monitoring theo user. | **IMPLEMENTED** |
| **Session Maintenance** | Dòng session hết hạn/bị thu hồi tích tụ vô hạn | Tạo kịch bản vận hành `scripts/session-maintenance.mjs` dọn dẹp các session đã hết hạn/thu hồi > 30 ngày (cửa sổ forensic audit). Yêu cầu operator credential, cấm chạy bằng `fintrack_runtime`. | **IMPLEMENTED** |
| **Production HSTS** | Thiếu HSTS header ở production | Cấu hình `Strict-Transport-Security: max-age=31536000` trong `next.config.mjs` khi `!isDev`. Không thêm `includeSubDomains`. | **IMPLEMENTED** |
| **Supply Chain Hardening** | Actions và container image dùng mutable tag | Ghim các GitHub Actions về full commit SHA 40 ký tự. Ghim image PostgreSQL 17 về official release digest `postgres:17.4-alpine@sha256:7062a2109c4b51f3c792c7ea01e83ed12ef9a980886e3b3d380a7d2e5f6ce3f5`. Cấu hình `.github/dependabot.yml`. Chạy cả dual audit (prod và dev). | **IMPLEMENTED** |
| **Static Security Analysis**| Chưa có workflow SAST tự động | Thiết lập GitHub CodeQL workflow `.github/workflows/codeql.yml` với quyền tối thiểu và ghim commit SHA. Hướng dẫn quét secret bằng GitHub Secret Scanning hoặc `gitleaks`. | **IMPLEMENTED** |
| **Backup / Restore Drill** | Hướng dẫn backup chỉ là lý thuyết trên giấy | Xây dựng kịch bản tự động `scripts/backup-restore-drill.sh` chạy trong CI: tạo dữ liệu, dump, restore vào DB sạch `fintrack_restore`, xác thực số dư, ledger, và trạng thái FORCE RLS. | **PARTIAL** (Logical drill xong; PITR production thuộc hạ tầng triển khai) |

---

## Chi tiết kỹ thuật & Hợp đồng bảo mật

### 1. Cơ chế RLS không tin cậy `app.user_id`

```sql
CREATE OR REPLACE FUNCTION fintrack.current_session_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = fintrack, pg_temp
AS $$
  SELECT user_id
  FROM fintrack.sessions
  WHERE token_hash = nullif(current_setting('app.session_hash', true), '')
    AND revoked_at IS NULL
    AND expires_at > now()
  LIMIT 1;
$$;
```

Các chính sách tenant trên các bảng nghiệp vụ:
`USING (user_id = fintrack.current_session_user_id()) WITH CHECK (user_id = fintrack.current_session_user_id())`

Khi người dùng gửi request, server chỉ thực hiện:
`SELECT set_config('app.session_hash', $1, true)`
Tuyệt đối không đặt `app.user_id`. Nếu attacker bằng bất kỳ cách nào thực thi `SET app.user_id = '<victim>'`, chính sách RLS vẫn không hề bị ảnh hưởng.

### 2. Hợp đồng Idempotency (7 ngày)

- **Retention**: Bản ghi idempotency được bảo lưu trong 7 ngày kể từ thời điểm tạo.
- **Replay semantics**: Trong vòng 7 ngày, một request gửi kèm cùng `Idempotency-Key` và payload trùng khớp SHA-256 fingerprint sẽ nhận lại đúng kết quả đã xử lý lần đầu mà không thực thi lại mutation. Nếu gửi cùng key nhưng khác payload, hệ thống trả về HTTP `409 IDEMPOTENCY_CONFLICT`.
- **Dọn dẹp**: Các bản ghi > 7 ngày được lưu trữ/xóa bởi tiến trình bảo trì hạ tầng, không xóa ngầm trong luồng HTTP của người dùng.

### 3. Rate-limiting Bounded Table

Khóa chính: `PRIMARY KEY (user_id, scope)`
Một câu lệnh `INSERT ... ON CONFLICT (user_id, scope) DO UPDATE`:
- Nếu bucket thay đổi (bước sang phút mới): `bucket = EXCLUDED.bucket, hits = 1`.
- Nếu cùng bucket: tăng `hits = hits + 1` nếu `hits < limit`.
- Không bao giờ sinh thêm dòng lịch sử mới. Dung lượng bảng tỉ lệ thuận trực tiếp với số lượng user hoạt động nhân với số scope cố định (tối đa 3 dòng/user).

---

## Hướng dẫn vận hành & Kiểm tra

### Chạy kiểm thử tự động
```bash
# Kiểm tra định kiểu
npm run typecheck

# Chạy toàn bộ test suite (mặc định PGlite)
npm test

# Chạy test suite bảo mật với PostgreSQL 17 thật
DATABASE_TEST_URL=postgres://postgres:ci-only-disposable-password@localhost:5432/fintrack_test npm run test:backend

# Chạy diễn tập Backup & Restore tự động
./scripts/backup-restore-drill.sh
```

### Chạy bảo trì Session hết hạn
```bash
DATABASE_MAINTENANCE_URL=postgresql://operator_user:PASSWORD@host:5432/fintrack node scripts/session-maintenance.mjs
```
*(Lưu ý: Không được chạy script này dưới role `fintrack_runtime`)*.
