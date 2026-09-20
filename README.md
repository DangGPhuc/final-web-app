# Personal Finance Cockpit

Trung tâm chỉ huy tài chính cá nhân dành riêng cho **DUY NHẤT MỘT CHỦ SỞ HỮU (Single-Owner Cockpit)**.
Dự án phục vụ đồ án tốt nghiệp với cơ chế tự động đọc email ngân hàng qua **Google OAuth 2.0 đa tài khoản**, lưu trữ bền vững với **PostgreSQL 17 & Prisma**, mã hóa xác thực **AES-256-GCM**, mô hình phân loại tài chính minh bạch, và giao diện tối giản Obsidian cao cấp.

---

## 1. Triết lý Thiết kế (Single-Owner Architecture)

Ứng dụng này **không phải là phần mềm SaaS** và không phục vụ khách hàng đại trà:
- **Không đăng ký / Không tạo tài khoản khách hàng**: Không có bảng users khách hàng, không password reset, không CRM, không đa người thuê (multi-tenant).
- **Màn hình Mở khóa Cockpit (Owner Unlock Screen)**: Ứng dụng khởi động ở trạng thái khóa với màn hình đen Obsidian tối giản. Chủ sở hữu nhập `Owner Access Key` để thiết lập phiên làm việc được ký bằng HMAC-SHA256 lưu trong cookie HTTP-only (`cockpit_owner_session`).
- **Khóa Cockpit**: Chủ sở hữu có thể chủ động khóa lại Cockpit bất kỳ lúc nào từ Settings, xóa sạch session cookie khỏi trình duyệt.
- **Bảo mật Google OAuth**: Trình duyệt **tuyệt đối không bao giờ nhận được refresh token**. Toàn bộ refresh token được mã hóa authenticated `AES-256-GCM` trước khi lưu vào PostgreSQL.
- **Mô hình riêng tư (Privacy Model)**:
  - *Phương án A*: Kết nối trực tiếp tài khoản Gmail nhận thông báo ngân hàng.
  - *Phương án B*: Thiết lập Gmail chính tự động chuyển tiếp (forward) email biến động sang một Gmail phụ, rồi kết nối Gmail phụ vào Personal Finance Cockpit.

---

## 2. Kiến trúc Luồng Dữ liệu (Data Flow Overview)

```
[ BANK NOTIFICATION EMAILS (VCB, TCB, MB, ACB, VPB, BIDV...) ]
                               ↓
         [ GOOGLE OAUTH 2.0 (gmail.readonly, offline) ]
                               ↓
  [ PAGINATED CANDIDATE SCAN (BANK_NOTIFICATION_REGISTRY + Epoch Seconds) ]
                               ↓
    [ FACTUAL FINANCIAL PARSER (Direction, Amount, Time Asia/Ho_Chi_Minh) ]
                               ↓
      [ SEPARATION: occurredAt (Event Time) vs emailReceivedAt (Gmail Time) ]
                               ↓
        [ ENFORCE TRANSACTION DATE RANGE (occurredAt in [from..to]) ]
                               ↓
   [ AUTHORITATIVE MULTI-ACCOUNT DEDUPLICATION & FORWARDING HEURISTIC ]
   ├── Rule A: @@unique([gmailConnectionId, gmailMessageId])
   ├── Rule B: @@index([bankCode, bankRefId])
   └── Rule C: Conservative cross-account forwarding heuristic
                               ↓
      [ BANK TRANSACTIONS (PostgreSQL + Prisma Persistence: BigInt VND) ]
   (Tác động ngay lập tức vào Authoritative Balance = IN - OUT)
                               ↓
        [ "BIẾN ĐỘNG CẦN PHÂN LOẠI" (Manual Classification) ]
        ├── User-defined Categories (Lưu vĩnh viễn trong DB)
        └── Budget Funds (Hạn mức quỹ chi tiêu độc lập với số dư)
                               ↓
     [ DATA RESET / RE-IMPORT: Xóa dữ liệu tài chính vs Factory Reset ]
```

---

## 3. Các Tính Năng Kỹ Thuật Nổi Bật (Key Features)

### 3.1. Phân biệt Thời gian Giao dịch thực tế (`occurredAt`) và Thời gian Nhận Mail (`emailReceivedAt`)
- `occurredAt`: Bóc tách trực tiếp ngày giờ giao dịch ghi trong thông báo ngân hàng (chuẩn múi giờ `Asia/Ho_Chi_Minh` / UTC+7). Dùng để ghi sổ cái, phân tích dòng tiền và nhóm theo tháng. Một email nhận trễ hay được forward 1 ngày sau vẫn giữ đúng ngày giao dịch gốc.
- `emailReceivedAt`: Ghi nhận thời điểm nhận thư của Gmail (`internalDate` ưu tiên hơn RFC Header `Date`). Dùng cho mục đích kiểm toán/debug.

### 3.2. Cơ chế Chống Trùng Lặp Thận trọng (Conservative Deduplication)
- **Authoritative Identity**:
  1. Khóa duy nhất tổng hợp `@@unique([gmailConnectionId, gmailMessageId])` ngăn nhập trùng lặp cùng 1 email trên 1 kết nối Gmail.
  2. Định danh `(bankCode, bankRefId)` với chỉ mục chuyên biệt nhận diện chính xác các mã giao dịch ngân hàng (Mã GD, Số GD, FT...).
- **Conservative Cross-Account Heuristic**:
  - Chỉ áp dụng heuristic vân tay tài chính (`fingerprint`) giữa các tài khoản Gmail **khác nhau** khi chuyển tiếp email.
  - Các giao dịch độc lập cùng số tiền xảy ra trong cùng một phút (ví dụ: thanh toán 2 cốc Highland cách nhau vài chục giây) được **giữ nguyên toàn vẹn**.

### 3.3. Phân trang An toàn & Giao diện Tiếp tục Nhập (Continuation UX)
- Quét email có safety cap để bảo vệ bộ nhớ và tốc độ phản hồi.
- Khi lịch sử có nhiều email, hiển thị banner:
  *"Đã nhập một phần lịch sử. Vẫn còn email cần quét."* cùng nút **[ Tiếp tục nhập ]**.
- Token phân trang (`accountContinuationTokens`) được lưu độc lập theo từng tài khoản, không chia sẻ hay tái sử dụng nhầm lẫn giữa các Gmail connections.
- Trạng thái tiếp tục nhập được gắn chặt với bộ lọc ban đầu (tài khoản, từ ngày, đến ngày); thay đổi bộ lọc sẽ tự động hủy token phân trang cũ.

### 3.4. Phân loại Lỗi & Trạng thái Reconnect
- Phát hiện chính xác `invalid_grant` / token bị thu hồi: đánh dấu `reconnect_required` (`revokedAt = new Date()`) và hiển thị badge cảnh báo yêu cầu kết nối lại trên giao diện.
- Không thu hồi tài khoản nhầm khi gặp lỗi quyền hạn (API permission) hay lỗi mạng tạm thời (transient errors).

### 3.5. Quản lý Dữ liệu An toàn (Data Management)
- **Xóa dữ liệu tài chính (Clear Financial Data)**: Xóa toàn bộ biến động giao dịch, quỹ và lịch sử đồng bộ, nhưng **giữ nguyên các kết nối Gmail đã liên kết**.
- **Khôi phục cài đặt gốc (Factory Reset)**: Thu hồi và hủy token OAuth trên Google, xóa hoàn toàn kết nối Gmail, danh mục, quỹ và đưa hệ thống về trạng thái ban đầu.

---

## 4. Cấu hình Dành Cho Nhà Phát Triển (Developer Setup)

### 4.1. Thiết lập Google Cloud Console
1. Truy cập [Google Cloud Console](https://console.cloud.google.com/) và tạo dự án.
2. Bật **Gmail API** trong thư viện APIs.
3. Thiết lập **OAuth consent screen** (Testing Mode) với các scopes:
   - `openid`
   - `.../auth/userinfo.email`
   - `.../auth/userinfo.profile`
   - `https://www.googleapis.com/auth/gmail.readonly`
4. Thêm địa chỉ Gmail dùng thử nghiệm vào mục **Test users**.
5. Tạo OAuth Client ID (Web application) với Authorized redirect URI:
   ```
   http://localhost:3000/api/google/callback
   ```

### 4.2. Cấu hình Biến Môi Trường (`.env.local`)
Sao chép `.env.example` thành `.env.local` và điền các giá trị:

```bash
# 1. Database (PostgreSQL + Prisma)
DATABASE_URL="postgresql://user:password@localhost:5432/personal_finance"

# 2. Mã hóa Token AES-256-GCM (64 hex characters = 32 bytes)
# Sinh ngẫu nhiên: openssl rand -hex 32
TOKEN_ENCRYPTION_KEY="<generate with openssl rand -hex 32>"

# 3. Bảo vệ Chủ sở hữu Cockpit (Tối thiểu 32 ký tự / 64 hex characters)
# Sinh ngẫu nhiên: openssl rand -hex 32
OWNER_SECRET_KEY="<generate with openssl rand -hex 32>"

# Canonical application origin (bắt buộc cho kiểm tra CSRF Origin)
APP_ORIGIN="http://localhost:3000"

# 4. Google OAuth Credentials
GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="your-client-secret"
GOOGLE_REDIRECT_URI="http://localhost:3000/api/google/callback"

# 5. Cờ môi trường kiểm thử (mặc định false)
ALLOW_DEMO_DATA=false
ALLOW_MOCK_OAUTH=false
```

---

## 5. Cài đặt & Vận hành (Installation & Run)

### 5.1. Khởi tạo Database PostgreSQL
```bash
# Đảm bảo PostgreSQL 17 đang chạy
pg_isready

# Đẩy schema Prisma vào database
npx prisma db push
```

### 5.2. Chạy Kiểm thử (Test Suite)
```bash
# Chạy toàn bộ 85+ bài kiểm thử Vitest trên PostgreSQL 17
npm test

# Kiểm tra tính hợp lệ của TypeScript
npm run typecheck
```

### 5.3. Build & Khởi chạy Production
```bash
# Build ứng dụng Next.js tối ưu hóa
npm run build

# Khởi chạy server
npm start
```

Truy cập `http://localhost:3000`, nhập `OWNER_SECRET_KEY` đã cấu hình để mở khóa Cockpit.
