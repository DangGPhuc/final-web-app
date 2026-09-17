# FinTrack — review và backend foundation V2

## Kết luận và phạm vi

Bản đầu vào: ZIP `final-web-app(20260917-171256).zip`, HEAD `b9674c8`, branch
`fix/security-persistence-closure-v2`. Branch làm việc mới: `feature/backend-foundation-v2`,
bắt đầu từ chính HEAD của ZIP để giữ đầy đủ integrity work. Chưa merge `dev/fintrack-v2`,
chưa push GitHub. 69 test baseline chạy qua không đồng nghĩa toàn bộ hơn 10.000 dòng khác
biệt với dev đã được review sạch.

Đã thêm một lát cắt backend hoạt động ở mức API: tạo/liệt kê ví VND và chuyển tiền giữa
ví tài sản. Các phần còn lại của UI vẫn dùng localStorage. Không mở rộng tính năng
localStorage trong lần này. Backend tắt mặc định; không tự động chuyển dữ liệu người dùng.

**Chưa sẵn sàng production hoặc tiếp nhận dữ liệu tài chính thật.**

## Phát hiện và xử lý

| Mức ưu tiên | Bằng chứng ở bản đầu vào | Xử lý |
|---|---|---|
| P0 trước khi mở backend | Không có xác thực, DB, ownership ở API demo | API `/api/v2` riêng, session phía server, ownership trong query và RLS |
| P0 toàn vẹn | localStorage không cung cấp transaction liên request/server | PostgreSQL transaction, khóa ví theo thứ tự cố định, kiểm tra số dư trong khóa |
| P0 cách ly | ID ví từ request không phải bằng chứng quyền sở hữu | user lấy từ session, không từ body/header; composite FK `(user_id, wallet_id)` |
| P1 tài nguyên | `readBoundedJsonBody` gọi `req.text()` rồi mới kiểm tra kích thước | Đếm byte trong stream, cancel quá giới hạn, deadline 5 giây, UTF-8 strict |
| P1 retry | Chưa có idempotency bền vững | Key UUID theo user, hash payload đã chuẩn hóa + operation, advisory lock trong transaction |
| P1 số tiền | JS number không phù hợp làm ranh giới tiền tệ backend | Chuỗi số nguyên VND trong JSON, bigint trong domain và PostgreSQL, giới hạn 9×10^15 |
| P1 vận hành | README mô tả API như backend đã hoàn chỉnh | Bổ sung trạng thái thực tế và runbook này |
| P1 supply chain | Audit phát hiện PostCSS/uuid gián tiếp | Override có phạm vi; xem kết quả kiểm tra cuối ở VALIDATION.md |

## Những gì thực sự có trong code

- `db/migrations/001_backend_foundation.sql`: users, sessions, wallets, transfers,
  idempotency, audit_events, rate_limits. Tenant tables bật ENABLE + FORCE RLS.
- `fintrack_runtime`: không superuser, không BYPASSRLS, không sở hữu bảng; quyền
  balance update theo cột; không được sửa/xóa audit, tạo session, TRUNCATE hay DDL.
- `src/server/session.ts`: cookie `__Host-fintrack_session`, 32 byte ngẫu nhiên
  base64url; DB chỉ giữ SHA-256, kiểm tra hết hạn/revoked mỗi request. Không tin
  `x-user-id`, `userId`, hay role do client gửi.
- POST yêu cầu Origin khớp chính xác `APP_ORIGIN`, Fetch Metadata same-origin nếu có,
  và JSON. Không suy Origin hợp lệ từ Host/X-Forwarded-Host do client kiểm soát.
- `src/server/database.ts`: pool 5 connection/process; transaction-scoped context,
  rollback + release; kiểm tra runtime role; TLS verify ở production, timeout query/lock.
- BOLA: cả hai ví phải thuộc session user; ví không tồn tại hoặc không thuộc user cùng trả 404.
- Chuyển tiền: khóa hai hàng theo UUID trước khi tính số dư; balances, transfer, audit,
  idempotency cùng commit/rollback. Phí bị trừ ở ví nguồn và lưu riêng trong transfer.
- Rate limit PostgreSQL: 60 request xác thực/user/phút, chia sẻ giữa instance, commit
  riêng để lỗi business không hoàn lại quota. Đây là fixed window, không phải chống DDoS.
- No-store cho cả success/error, response có request ID. Log lỗi bất ngờ không chứa SQL,
  token, URL DB, note hay số dư. Audit mutation chỉ chứa actor/action/resource/timestamp.
- GET ví có cursor UUID và tối đa 100 item. Không query toàn bộ lịch sử.

RLS ở đây là phòng vệ bổ sung: server giữ quyền thiết lập `app.user_id` sau xác thực.
Không cấp DB credential cho browser hoặc người dùng cuối. RLS không bảo vệ khỏi một
server đã bị chiếm quyền hay SQL injection cho phép tự đặt context.

## Chạy và kiểm tra

Node 22+, PostgreSQL 17+. Dùng database trống để thử lần đầu.

```bash
npm ci
npm run typecheck
npm test
npm run build
npm audit --omit=dev
```

Test mặc định dùng PGlite (PostgreSQL WASM) thực thi migration/RLS thật, không mock SQL.
Test concurrency nhiều connection chỉ chạy khi có `DATABASE_TEST_URL` trỏ database
**trống dùng một lần**. Migration sẽ tạo schema và role: không dùng URL production.
Workflow `.github/workflows/backend-security.yml` cung cấp PostgreSQL 17 cho test này.

```bash
DATABASE_TEST_URL=postgresql://postgres:TEST_PASSWORD@localhost:5432/fintrack_test npm test
```

Chạy migration bằng admin/migration credential tách biệt:

```bash
psql "$DATABASE_MIGRATION_URL" -v ON_ERROR_STOP=1 -f db/migrations/001_backend_foundation.sql
```

Đây là migration bootstrap một lần, chưa có migration runner/checksum. Role là cấp
cluster: nếu role đã tồn tại, không tự drop/ghi đè; operator cần xem lại việc triển khai.
Admin cấp LOGIN + mật khẩu riêng cho `fintrack_runtime` bằng giao diện quản trị hoặc
psql `\password`, không đưa mật khẩu vào repo. App `DATABASE_URL` phải đăng nhập đúng
role này, không dùng admin URL. Đặt:

```dotenv
ENABLE_BACKEND_API=true
ENABLE_DEMO_API=false
APP_ORIGIN=https://fintrack.example
```

`DATABASE_URL` không chứa các tham số sslmode/sslcert/sslkey/sslrootcert: code tự cấu hình
TLS verify. Có thể cấp PEM CA qua `DATABASE_CA`. Local DB được phép không TLS chỉ khi
NODE_ENV khác production; production build + next start vẫn yêu cầu DB TLS.

### Session thử local, không phải luồng đăng nhập

Chưa tích hợp OIDC/provider, đăng nhập, refresh, logout hay UI login. Backend không phát
session từ user ID do HTTP request gửi lên. Script dưới đây chỉ là fixture operator
cho localhost, dùng admin DB riêng, session hết hạn 1 giờ:

```bash
ALLOW_DEV_SESSION=true DATABASE_MIGRATION_URL=postgresql://postgres:LOCAL_PASSWORD@localhost:5432/fintrack \
  node scripts/dev-session.mjs /tmp/fintrack-dev-cookie
```

File token được tạo độc quyền với mode 0600, không in token ra stdout; không commit/chia sẻ.
Khi nối identity provider, adapter tin cậy phải rotate token sau login, đặt cookie
`Secure; HttpOnly; SameSite=Lax; Path=/`, không Domain, hết hạn không vượt DB expiry;
revoke ở logout/xóa tài khoản và thiết lập idle/absolute timeout. API hiện chỉ xác minh
session đã phát, chưa tự thực hiện các bước này. Không dùng script local làm auth production.

### Contract API

Tất cả amount/balance là **string VND nguyên**, không dùng dấu phân cách hay float.
POST phải có cookie, Origin, `Content-Type: application/json`, `Idempotency-Key: <UUID>`.

| Endpoint | Body / query | Kết quả |
|---|---|---|
| GET `/api/v2/wallets` | `?after=<last UUID>` tùy chọn | `wallets`, `nextCursor` |
| POST `/api/v2/wallets` | `{"name":"Bank","type":"BANK","openingBalance":"1000000"}` | Ví mới, 201 |
| POST `/api/v2/transfers` | `{"fromWalletId":"<UUID>","toWalletId":"<UUID>","amount":"100000","fee":"1000"}` | Transfer, 201 |

Replay cùng key/operation/payload trả response cũ; cùng key nhưng khác payload trả 409.
Không TTL/xóa idempotency tự động vì có thể làm retry cũ thực thi lại. Hạn mức lưu trữ và
chính sách archive cần được chốt trước production. Mutation response không dùng cache.

Ví CREDIT, thu/chi, edit/delete/reversal, goals, bills, budgets, receipt và import chưa được
hỗ trợ trong API mới. Không gửi dữ liệu localStorage trực tiếp vào schema này. Các endpoint
`/api/*` cũ vẫn là demo; không dùng chúng để xác minh dữ liệu PostgreSQL.

## Các cổng bắt buộc trước production

1. **Identity + UI**: chọn provider; login/logout/revocation/session rotation, account recovery,
   MFA nếu phù hợp; nối UI qua repository HTTP; bỏ fallback âm thầm sang localStorage.
2. **Mở rộng domain**: credit debt, income/expense, bill occurrences, goals, reversals;
   đưa invariant của domain hiện có vào server transaction. Không áp dụng logic ví tài sản
   cho thẻ CREDIT. Kiểm thử migration snapshot legacy và đối soát số dư.
3. **Private receipts**: bucket private; metadata FK cùng owner; key ngẫu nhiên server;
   limit byte + decode ảnh/magic bytes + giới hạn pixel; JPEG/PNG/WebP; reject SVG;
   short-lived signed download sau ownership check; quarantine/scan, orphan cleanup,
   idempotent delete bằng outbox. Chưa có bucket, upload hoặc signed URL trong bản này.
4. **Security vận hành**: rate limit tại edge trước auth và limit body ở proxy; production
   secret store, connection budget tổng instance; telemetry auth failure/denial có redact;
   nonce CSP nếu triển khai, HTTPS/HSTS. Không coi headers là auth.
5. **Audit và xóa dữ liệu**: chỉ audit mutation thành công được triển khai. Chốt retention,
   log quyền truy cập/failed auth; endpoint xóa account cần re-auth, revoke trước, DB transaction
   + outbox cho object storage, retry và chứng minh completion. Cascade schema chưa phải
   workflow xóa tài khoản hoàn chỉnh; retention audit cần được điều chỉnh với yêu cầu xóa.
6. **Backup/PITR**: bật qua managed PostgreSQL, mã hóa, retention và quyền backup riêng;
   restore sang môi trường cô lập, kiểm tra row counts, tổng số dư, RLS, receipts và thời gian
   khôi phục; không mở login trước khi invalidate sessions đã restore. Ghi RPO/RTO đo được.
   Chưa có backup hay restore drill thực tế trong bản này. NFS không dùng.
7. **Merge gate**: review diff của V2 integrity, CI xanh trên PostgreSQL thật, kiểm tra
   quyền/schema bằng credential production tương đương. Sau đó merge integrity về dev
   và rebase/cherry-pick commit foundation lên dev, không tự động chứng nhận “review sạch”.

## Tài liệu đối chiếu

- PostgreSQL RLS: https://www.postgresql.org/docs/current/ddl-rowsecurity.html
- OWASP CSRF: https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html

FORCE RLS không ngăn superuser/BYPASSRLS; do đó có cả kiểm tra runtime role và test privileges.
SameSite chỉ là phòng vệ bổ sung; mutation dùng Origin kiểm tra server-side.
