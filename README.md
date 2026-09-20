# Personal Finance Cockpit

Trung tâm chỉ huy tài chính cá nhân dành riêng cho **DUY NHẤT MỘT NGƯỜI DÙNG (Single-Owner Cockpit)**.
Dự án được xây dựng phục vụ báo cáo / đồ án tốt nghiệp với cơ chế tự động đọc email ngân hàng qua **Google OAuth đa tài khoản**, lưu trữ bền vững với **PostgreSQL & Prisma**, mã hóa xác thực **AES-256-GCM**, và quy trình phân loại tài chính thủ công minh bạch.

---

## 1. Triết lý Thiết kế (Single-Owner Architecture)

Ứng dụng này **không phải là phần mềm SaaS** và không dành cho người dùng bên ngoài hay khách hàng đại trà:
- **Không đăng ký / Không tạo tài khoản khách hàng**: Không có hệ thống authentication hay tài khoản người dùng nội bộ.
- **Không multi-tenant / Không role / Không CRM / Không subscription**: Hoàn toàn loại bỏ mọi khái niệm quản trị khách hàng.
- **Lưu trữ chuyên biệt**: Cơ sở dữ liệu PostgreSQL cục bộ chỉ phục vụ lưu trữ số dư, biến động ngân hàng và các quỹ ngân sách của chủ sở hữu.
- **Bảo mật Google OAuth**: Trình duyệt **tuyệt đối không bao giờ nhận được refresh token**. Toàn bộ refresh token được mã hóa bằng thuật toán `AES-256-GCM` trước khi lưu vào database.
- **Mô hình riêng tư (Privacy Model)**:
  - *Phương án A*: Người dùng kết nối trực tiếp tài khoản Gmail nhận thông báo biến động số dư.
  - *Phương án B*: Người dùng tạo một tài khoản Gmail phụ và thiết lập Gmail chính chuyển tiếp (forward) các email ngân hàng sang tài khoản phụ, sau đó kết nối tài khoản phụ vào ứng dụng qua OAuth.

---

## 2. Kiến trúc Hệ thống (Architecture Overview)

```
[ BANK NOTIFICATION EMAILS (VCB, TCB, MB, ACB, VPB, BIDV...) ]
                              ↓
        [ GOOGLE OAUTH 2.0 (gmail.readonly, offline) ]
                              ↓
    [ REAL PAGINATED INGESTION (nextPageToken, MIME decode) ]
                              ↓
      [ FACTUAL FINANCIAL PARSER (Direction, Amount, Time) ]
                              ↓
  [ AUTHORITATIVE SERVER DEDUPLICATION: UNIQUE(gmailMessageId) ]
                              ↓
     [ BANK TRANSACTIONS (PostgreSQL + Prisma Persistence) ]
  (Tác động ngay lập tức vào Authoritative Balance = IN - OUT)
                              ↓
       [ "BIẾN ĐỘNG CẦN PHÂN LOẠI" (Manual Classification) ]
       ├── User-defined Categories (Lưu vĩnh viễn, tùy chọn "Khác...")
       └── Budget Funds (Hạn mức quỹ chi tiêu độc lập với số dư)
                              ↓
   [ DATA MANAGEMENT: Xóa dữ liệu tài chính / Re-import theo ngày ]
```

---

## 3. Cấu hình Dành Cho Nhà Phát Triển (Developer OAuth Setup)

> [!IMPORTANT]
> Phạm vi truy cập `https://www.googleapis.com/auth/gmail.readonly` là một **Restricted Scope** của Google. Đối với đồ án tốt nghiệp, Google Cloud Project được thiết lập ở chế độ **Testing Mode**.

### 3.1. Thiết lập trên Google Cloud Console
1. Truy cập [Google Cloud Console](https://console.cloud.google.com/) và tạo một dự án mới.
2. Vào **APIs & Services** → **Library**, tìm kiếm và kích hoạt **Gmail API**.
3. Vào **OAuth consent screen**:
   - Chọn User Type: **External**.
   - Điền App name (VD: *Personal Finance Cockpit*), User support email và Developer contact.
   - Thêm các Scopes:
     - `openid`
     - `.../auth/userinfo.email`
     - `.../auth/userinfo.profile`
     - `https://www.googleapis.com/auth/gmail.readonly`
   - Tại mục **Test users**: Thêm các địa chỉ Gmail sẽ dùng để thử nghiệm và demo (bắt buộc trong Testing Mode).
4. Vào **Credentials** → **Create Credentials** → **OAuth client ID**:
   - Application type: **Web application**.
   - Name: *Personal Finance Web Client*.
   - Authorized redirect URIs:
     ```
     http://localhost:3000/api/google/callback
     ```
5. Nhận `Client ID` và `Client Secret`.

### 3.2. Cấu hình Biến Môi Trường (`.env.local` / `.env`)
Tạo file `.env.local` tại thư mục gốc của dự án:

```bash
# PostgreSQL Connection URL
DATABASE_URL="postgresql://kali:kali@localhost:5432/personal_finance"

# Google OAuth Credentials (Server-only)
GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="your-client-secret"
GOOGLE_REDIRECT_URI="http://localhost:3000/api/google/callback"

# Master key for AES-256-GCM encryption (64 hex characters = 32 bytes)
# Sinh ngẫu nhiên: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
TOKEN_ENCRYPTION_KEY="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
```

---

## 4. Cài Đặt & Khởi Chạy (Installation & Run)

### 4.1. Khởi động PostgreSQL & Tạo Database
```bash
# Đảm bảo PostgreSQL đang chạy
pg_isready

# Tạo database (nếu chưa có)
psql -U postgres -c "CREATE DATABASE personal_finance;"
```

### 4.2. Cài đặt Dependencies & Đồng bộ Schema
```bash
npm install
npx prisma db push
```

### 4.3. Chạy Dev Server
```bash
npm run dev
```
Truy cập ứng dụng tại: `http://localhost:3000`

---

## 5. Quy Trình Nghiệm Thu & Demo (Acceptance Flow)

Dưới đây là kịch bản demo mẫu phục vụ buổi bảo vệ đồ án:

1. **Khởi đầu**: Mở ứng dụng → vào tab **Cài đặt**. Danh sách Gmail ban đầu hoàn toàn trống.
2. **Liên kết Gmail**:
   - Bấm **"+ Thêm tài khoản Gmail"**.
   - Màn hình Google OAuth hiển thị → Chọn tài khoản Gmail thử nghiệm và cấp quyền đọc Gmail readonly.
   - Ứng dụng tự động điều hướng trở lại tab Cài đặt: Thẻ Gmail xuất hiện với Google Avatar, Tên và Email.
3. **Nhập Lịch Sử (Historical Import)**:
   - Tại mục **Nhập dữ liệu email**, chọn khoảng thời gian (VD: `01/09/2026` → `20/09/2026`).
   - Bấm **"Nhập lịch sử"**.
   - Hệ thống quét phân trang, giải mã MIME và trích xuất biến động.
   - Thẻ kết quả hiển thị: Số email đã đọc, biến động mới, trùng lặp và không đọc được.
4. **Kiểm tra Tổng quan (Dashboard)**:
   - Tổng số dư tài chính (Authoritative Balance) cập nhật tức thì theo `IN - OUT`.
   - Mục **"Biến động cần phân loại"** ưu tiên hiển thị các giao dịch chưa phân loại, đi kèm gợi ý đối tác/thương nhân (VD: *Highlands Coffee*, *Grab*, *Shopee*).
5. **Phân Loại Thủ Công & Danh Mục Tự Định Nghĩa**:
   - Bấm nút **[Phân loại]** tại giao dịch Highlands Coffee (-120.000 ₫).
   - Chọn **"+ Khác... (Tạo danh mục mới)"** → Nhập `Cafe` → Chọn Quỹ (nếu có) → Bấm **Lưu phân loại**.
   - Giao dịch chuyển sang trạng thái đã phân loại; danh mục `Cafe` được lưu vĩnh viễn và tự động xuất hiện trong bộ lọc Dòng tiền.
   - Việc phân loại **hoàn toàn không làm thay đổi số dư**.
6. **Tạo Quỹ Ngân Sách (Funds)**:
   - Vào tab **Quỹ** → Bấm **"Tạo quỹ"**.
   - Nhập tên `Quỹ ăn uống`, hạn mức `3.000.000 ₫` → Lưu.
   - Thẻ quỹ xuất hiện ngay lập tức với thanh tiến độ; refresh lại trình duyệt quỹ vẫn tồn tại bền vững.
7. **Xóa Dữ Liệu Tài Chính & Nạp Lại (Reset / Re-import)**:
   - Vào **Cài đặt** → Bấm **"Xóa dữ liệu tài chính"** → Xác nhận.
   - Toàn bộ giao dịch, quỹ, danh mục bị xóa khỏi database.
   - **Tài khoản Gmail vẫn giữ nguyên liên kết**.
   - Bấm lại **"Nhập lịch sử"** cùng khoảng ngày → Toàn bộ biến động ngân hàng được tái tạo chuẩn xác mà không cần đăng nhập lại Google.

---

## 6. Kiểm Thử Hệ Thống (Testing & Verification)

Chạy toàn bộ 41 unit & integration tests:
```bash
npm test
```
Kiểm tra type và build sản phẩm:
```bash
npm run typecheck
npm run build
```

---

## 7. Ranh Giới An Toàn & Bảo Mật (Security Boundary)

- **Không đưa lên mạng công cộng**: Ứng dụng là cockpit cá nhân không có lớp phân quyền nhiều người dùng. Một phiên bản triển khai thực tế có kết nối Gmail **tuyệt đối không được mở public** nếu không có reverse proxy xác thực chủ sở hữu (Basic Auth, Tailscale, Cloudflare Access).
- **Chế độ Demo An Toàn**: Khi demo tại lớp học mà không muốn để lộ email ngân hàng thật, người dùng có thể sử dụng tính năng demo fixture an toàn có sẵn trong hệ thống.
