# Personal Finance Cockpit

Trung tâm chỉ huy tài chính cá nhân toàn diện, thiết kế dành riêng cho **DUY NHẤT MỘT NGƯỜI DÙNG (Single-User)**.

---

## 1. Triết lý Sản phẩm (Single-User Philosophy)

Ứng dụng này **không phải là phần mềm SaaS** và không dành cho người dùng bên ngoài hay khách hàng:
- **Không đăng ký / Không đăng nhập ứng dụng**: Không có hệ thống authentication/account nội bộ cho web app.
- **Không database đám mây cho người dùng**: Không sử dụng PostgreSQL, Supabase, hay SQL database lưu dữ liệu tài chính của khách hàng.
- **Không multi-tenant / Không role / Không CRM / Không subscription**: Hoàn toàn loại bỏ mọi khái niệm quản trị khách hàng.
- **Bảo mật & Cục bộ**: Toàn bộ dữ liệu tài chính được lưu trữ an toàn trong trình duyệt thông qua cơ chế `StorageAdapter` (LocalStorage Adapter v3).
- **Email Provider Authorization**: Kết nối Gmail chỉ đóng vai trò ủy quyền đọc thông báo biến động số dư ngân hàng qua OAuth (chỉ quyền `gmail.readonly`), không phải là hệ thống đăng nhập tài khoản. Toàn bộ Access/Refresh Token được giữ trên server, tuyệt đối không gửi xuống trình duyệt.

---

## 2. Kiến trúc Hệ thống (Architecture)

Hệ thống hoạt động theo pipeline xử lý dữ liệu tài chính khép kín:

```
[ BANK NOTIFICATION EMAILS ]
             ↓
[ SERVER GMAIL INGESTION (/api/email/sync) ]
             ↓
[ MODULAR PARSER ENGINE ] (Vietcombank, Generic)
             ↓
[ DEDUPLICATION & SAFETY REVIEW FLOW ]
             ↓
[ AUTHORITATIVE TRANSACTION LEDGER ]
             ↓
[ FUNDS ALLOCATION (Hạn mức quỹ không đổi số dư) ]
             ↓
[ MONTHLY SNAPSHOTS (Chốt sổ tháng) ]
             ↓
[ SAVINGS FORECAST (Dự phóng tuyến tính minh bạch) ]

---------------------------------------------------------
[ ISOLATED PAPER TRADING SIMULATOR (/api/market) ]
(BTC / XAU mô phỏng giao dịch phái sinh không liên quan tiền thật)
```

---

## 3. Các Phân hệ Cốt lõi

### 3.1. Tổng quan (Dashboard)
- **Tổng số dư tài chính (Authoritative Balance)**: `Số dư ban đầu + Tổng tiền vào (POSTED IN) - Tổng tiền ra (POSTED OUT)`. Không chia nhỏ thành nhiều ví tiền ảo phức tạp.
- Thống kê tháng hiện tại: Tiền vào, Tiền ra, Dòng tiền thuần (Net).
- Trạng thái đồng bộ email ngân hàng và cảnh báo nhẹ nhàng khi có giao dịch cần xem lại (`NEEDS_REVIEW`).
- Biến động gần đây (5–8 giao dịch mới nhất).

### 3.2. Dòng tiền (Cashflow)
- Hợp nhất quản lý giao dịch và báo cáo dòng tiền vào một màn hình duy nhất.
- Bộ lọc tháng, loại luồng (IN/OUT), Quỹ, Danh mục, Từ khóa tìm kiếm.
- Biểu đồ Bar Chart theo dõi nhịp độ thu chi từng ngày trong tháng.
- Thao tác chỉnh sửa giao dịch, gán quỹ, gán danh mục và thiết lập quy tắc tự động ghi nhớ đối tác.
- Giao dịch email có thể duyệt (`POSTED`) hoặc đánh dấu bỏ qua (`IGNORED`) để không bị nhập lại ở các lần đồng bộ sau.

### 3.3. Quỹ (Funds Model - Thay thế Budget cũ)
- **Cơ chế hoạt động**: Khi có tiền vào, người dùng phân bổ hạn mức chi tiêu vào từng quỹ (Ăn uống, Sinh hoạt, Di chuyển, Học tập, Dự phòng...).
- **Quy tắc kế toán**: Việc phân bổ quỹ **KHÔNG** làm thay đổi tổng số dư tài chính.
- Khi có giao dịch chi tiêu (`OUT`) được gán vào Quỹ:
  - `spent` của quỹ tăng lên tương ứng.
  - `remaining = monthlyAllocation - spent`.
  - `usagePercent = (spent / monthlyAllocation) * 100`.
  - Nếu `remaining < 0`: `overAmount = |remaining|`, trạng thái chuyển thành `OVER`.
- Sửa hạn mức quỹ giữ nguyên lịch sử giao dịch và số tiền đã tiêu.
- Chu kỳ quỹ hoạt động theo tháng (`Monthly Fund Cycle`). Chốt sổ cuối tháng tạo ra `MonthlySnapshot` với `netSavings = totalIncome - totalExpense`.

### 3.4. Dự báo tích lũy (Savings Forecast)
- Dự báo toán học tuyến tính minh bạch dựa trên số tháng đã chốt sổ:
  - 1 tháng chốt sổ: `averageMonthlySavings = savings(tháng 1)`.
  - 2 tháng chốt sổ: `averageMonthlySavings = (tháng 1 + tháng 2) / 2`.
  - N tháng chốt sổ: `averageMonthlySavings = Σ(tháng 1..N) / N`.
  - Công thức: `Tích lũy[N] = Tích lũy hiện tại + (Tiết kiệm TB/tháng × N)`.
- Lựa chọn kỳ hạn dự phóng: 3, 6, 12, 24 tháng.
- Biểu đồ phân biệt rõ ràng: Đường nét liền (Dữ liệu thực tế) và Đường nét đứt (Dự phóng tương lai).
- Nếu dữ liệu trung bình mang giá trị âm, biểu đồ thể hiện đúng chiều hướng suy giảm vốn (không sử dụng `Math.max(0)` để che giấu).

### 3.5. Demo Trading (Paper Trading Simulator)
- **Cảnh báo miễn trừ trách nhiệm**: Đây là công cụ mô phỏng giao dịch giả lập, **hoàn toàn không đặt lệnh thật** và không kết nối API key giao dịch.
- Tích hợp dữ liệu thị trường công khai cho **Bitcoin (BTC/USD)** qua CoinGecko API và **Vàng (XAU/USD)**, tự động fallback sang dữ liệu mô phỏng nếu không có mạng.
- Hỗ trợ vị thế LONG / SHORT, Margin (vốn), Đòn bẩy (Leverage 1x - 50x), Stop-Loss, Take-Profit.
- Tính toán PnL lý thuyết, ROI trên vốn ký quỹ, quy mô vị thế (`margin × leverage`), và đường giá thanh lý ước tính (`estimatedLiquidationPrice`).
- Hoàn toàn độc lập, không ảnh hưởng đến số dư hay dữ liệu thu chi thực tế.

### 3.6. Cài đặt (Settings)
- Quản lý cấu hình Email Ingestion (OAuth Gmail), danh sách email người gửi tin cậy (`trustedSenders`), ngưỡng tự tin tối thiểu (`autoPostMinConfidence`).
- Quản lý quy tắc từ khóa thương nhân/đối tác (`MerchantRule`) để tự động phân loại danh mục và gán quỹ.
- Cài đặt số dư ban đầu (`openingBalance`), đơn vị tiền tệ VND.
- Quản lý dữ liệu: Nạp dữ liệu mẫu thử nghiệm (Seed Demo) hoặc Xóa sạch dữ liệu cục bộ.

---

## 4. Email Ingestion Flow & Deduplication

1. Ngân hàng gửi email thông báo biến động số dư.
2. Ứng dụng gọi `POST /api/email/sync` từ server.
3. Server sử dụng `GmailProvider` để tải các email mới nhất.
4. `parseEmailMessage()` chạy qua danh sách parsers:
   - `VietcombankParser`: Parse email cú pháp `VCB: TK ...| GD: +/-... VND`.
   - `GenericParser`: Parse định dạng ghi nợ / ghi có tiếng Việt tổng quát.
5. `normalizeToTransaction()` phân tích độ tin cậy và nguồn gửi:
   - Người gửi nằm trong `trustedSenders` VÀ độ tự tin parser ≥ `autoPostMinConfidence` → Trạng thái `POSTED` (ghi trực tiếp vào số dư).
   - Ngược lại → Trạng thái `NEEDS_REVIEW` (đưa vào hàng đợi cần người dùng xác nhận).
6. **Deduplication**: Kiểm tra `sourceMessageId` của Gmail đối chiếu với các giao dịch đã tồn tại. Dù thực hiện đồng bộ bao nhiêu lần cùng 1 email, hệ thống đảm bảo duy nhất 1 giao dịch được tạo.

---

## 5. Cấu hình Gmail & Biến Môi trường (Environment Setup)

Để kết nối với tài khoản Gmail cá nhân thật:

1. Truy cập [Google Cloud Console](https://console.cloud.google.com/), tạo một Project mới.
2. Kích hoạt **Gmail API**.
3. Tạo **OAuth 2.0 Client IDs** (loại Web Application).
4. Cấp quyền truy cập (Scope) tối thiểu:
   `https://www.googleapis.com/auth/gmail.readonly`
5. Lấy Refresh Token và lưu vào file `.env.local`:

```bash
# .env.local (Không bao giờ commit file này)
GMAIL_CLIENT_ID=your_client_id.apps.googleusercontent.com
GMAIL_CLIENT_SECRET=your_client_secret
GMAIL_REFRESH_TOKEN=your_refresh_token
GMAIL_USER_EMAIL=your_email@gmail.com
```

> **Lưu ý**: Nếu chưa cấu hình biến môi trường Gmail, hệ thống sẽ tự động chuyển sang chế độ Demo Ingestion an toàn với các email mẫu Vietcombank, Techcombank.

---

## 6. Thiết kế Giao diện (Visual System)

Theo chuẩn tài liệu thiết kế tối giản:
- Chủ đề: **Chỉ Dark Mode (Dark Only)**.
- Màu nền Obsidian: `#0f1011` (nền sâu hơn: `#090a0b`).
- Bề mặt card: `#17181a`, viền `#232427`, elevated `#2e2e2e`, hover `#3f4041`.
- Chữ: Tiêu đề `#f5f5f7`, nội dung `#9f9fa0`, dữ liệu kỹ thuật font monospace uppercase.
- Bo góc: Card 20px, Buttons/Inputs 8px, Pills 9999px.
- CTA chính: Nền trắng chữ đen (`#ffffff` / `#000000`).
- Không đổ bóng thẻ, độ sâu tạo bởi tương phản bề mặt (Surface levels).

---

## 7. Cấu trúc Thư mục Dự án

```
src/
├── app/
│   ├── api/
│   │   ├── email/
│   │   │   ├── status/route.ts      # Kiểm tra trạng thái Gmail
│   │   │   └── sync/route.ts        # Đọc email, parse & dedupe
│   │   └── market/route.ts          # API giá công khai BTC & Vàng
│   ├── globals.css                  # Design tokens, surfaces & typography
│   ├── layout.tsx                   # Google fonts (Playfair, Inter, Roboto Mono)
│   └── page.tsx                     # Entry point & Tab switcher
├── components/
│   ├── Navigation.tsx               # Top/Bottom navigation bar
│   ├── dashboard/DashboardView.tsx  # Tổng quan số dư & biến động gần đây
│   ├── cashflow/CashflowView.tsx    # Dòng tiền, biểu đồ ngày & danh sách giao dịch
│   ├── funds/FundsView.tsx          # Quản lý quỹ, chu kỳ tháng & chốt sổ
│   ├── forecast/ForecastView.tsx    # Dự báo tích lũy dựa trên dữ liệu chốt sổ
│   ├── trading/TradingView.tsx      # Mô phỏng vị thế phái sinh (Paper Trading)
│   ├── settings/SettingsView.tsx    # Cài đặt email, parser rules & dữ liệu
│   └── shared/
│       ├── QuickAddModal.tsx        # Modal ghi chép giao dịch thủ công
│       └── Toast.tsx                # Thông báo hệ thống
├── context/
│   └── AppContext.tsx               # State management cho Single User
├── lib/
│   ├── constants.ts                 # Danh mục & danh sách ngân hàng
│   ├── mock-data.ts                 # Fixtures mẫu theo tháng động
│   ├── utils.ts                     # Hàm format tiền tệ, ngày tháng
│   ├── finance/
│   │   └── calculations.ts          # Pure business calculation functions
│   ├── storage/
│   │   ├── storage.ts               # StorageAdapter interface
│   │   ├── local-storage-adapter.ts # LocalStorage & MemoryStorage implementations
│   │   └── persistence.ts           # Schema v3 loading, saving & migration
│   ├── email/
│   │   ├── provider.ts              # EmailProvider interface
│   │   ├── gmail-provider.ts        # Server-side Gmail API client
│   │   ├── dedupe.ts                # Thuật toán chống trùng lặp giao dịch
│   │   ├── normalizer.ts            # Chuyển đổi parsed email -> Transaction
│   │   └── parsers/
│   │       ├── parser.ts            # EmailParser interface
│   │       └── generic-parser.ts    # Vietcombank & Generic parsers
│   └── market/
│       ├── provider.ts              # MarketDataProvider interface
│       ├── bitcoin-provider.ts      # CoinGecko API provider
│       └── gold-provider.ts         # Gold/XAU data provider
└── types/
    └── index.ts                     # Toàn bộ TypeScript domain interfaces
```

---

## 8. Phát triển & Kiểm thử (Development & Testing)

```bash
# 1. Cài đặt thư viện phụ thuộc
npm install

# 2. Kiểm tra type TypeScript
npm run typecheck

# 3. Chạy unit tests
npm test

# 4. Chạy dev server
npm run dev

# 5. Build production bundle
npm run build
```
