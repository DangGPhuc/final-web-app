# FinTrack Pro - Web App Quản Lý Chi Tiêu & Mô Phỏng Tài Chính Thông Minh

> **Security Hardening (Iteration v2)**: Xem chi tiết kỹ thuật tại [FOUNDATION_REVIEW_VI.md](docs/backend/FOUNDATION_REVIEW_VI.md) và [Security Baseline](docs/security/security-baseline.md).
> **Trạng thái lưu trữ**: UI hiện vẫn dùng client-side `localStorage`. Backend PostgreSQL mới tại `/api/v2/*` đã được hardening (session-derived RLS, quota ví, bounded rate-limiting, session revocation), tắt mặc định. Các route `/api/*` demo cũ bị tắt hoàn toàn ở production. Frontend cutover sang PostgreSQL sẽ được thực hiện ở iteration tiếp theo.

Dự án Web App Quản lý Chi tiêu toàn diện kèm tính năng đột phá **What-If Financial Simulator** (Mô phỏng tài chính phản ứng thời gian thực & Benchmark tối ưu hiệu năng).

---

## 🌟 1. Lineup Tính năng Cốt lõi (Features)

### 🔮 Tính Năng Đột Phá: Mô Phỏng Tài Chính "What-If" (What-If Simulator)
- **Kéo - Thả - Cập nhật tức thời (60 FPS Reactive)**:
  - **Thanh trượt 1: Cắt giảm chi tiêu danh mục** (0% - 50%): Tùy chọn cắt giảm Ăn uống, Mua sắm, Giải trí... và xem số tiền tiết kiệm được ngay.
  - **Thanh trượt 2: Đầu tư / Gửi tiết kiệm thêm** (0 - 5.000.000 ₫/tháng).
  - **Tùy chọn lãi suất kỳ vọng** (5.5% - 11%/năm) & **Khung thời gian dự phóng** (6, 12, 24, 36 tháng).
- **Biểu đồ kép so sánh 2 kịch bản**:
  - *Đường Baseline (nét đứt)*: Quỹ đạo tài sản nếu giữ nguyên cách chi tiêu hiện tại.
  - *Đường What-If (nét liền có phủ gradient)*: Quỹ đạo tài sản bứt phá sau khi tối ưu và sinh lời nhờ lãi kép.
  - Thẻ hiển thị **Số tiền gia tăng thêm (Delta Extra Gain)** nổi bật (ví dụ: `+28.780.000 ₫`).
- **Mô Phỏng Đo Đạc Hiệu Năng Frontend (Client-side Performance Simulation)**:
  - Nút bấm **"Chạy Benchmark Client"** đo trực tiếp độ trễ tính toán mô phỏng What-If trên trình duyệt.
  - So sánh trực quan mang tính minh họa: kịch bản giả định chưa tối ưu vs đo đạc thực tế vòng lặp client JS, kèm định hướng kiến trúc tối ưu (Compound Index & Cache) cho giai đoạn phát triển full-stack cơ sở dữ liệu sau này.

### 💳 Quản lý Tài khoản & Ví (Accounts & Wallets)
- **Hỗ trợ 4 loại nguồn tiền**: Tiền mặt (Cash), Tài khoản ngân hàng (Bank Accounts), Thẻ tín dụng (Credit Cards - hạn mức, dư nợ), Sổ tiết kiệm (Savings - lãi suất, kỳ hạn).
- **Tổng hợp tự động**: Số dư khả dụng & Tổng tài sản ròng (Net Worth).
- **Chuyển khoản nội bộ (Internal Transfer)**: Chuyển tiền giữa các ví, tính phí giao dịch và tự động cập nhật số dư.

### 📝 Ghi nhận Giao dịch (Transaction Recording) & Nút Nhập Nhanh (Quick Add)
- **Đầy đủ 3 hình thức**: Khoản chi (Expense), Khoản thu (Income), Chuyển khoản nội bộ (Transfer).
- **Nút Nhập nhanh (Quick Add)**: Mở tức thì ở mọi màn hình qua nút bấm hoặc thanh điều hướng. Có sẵn các nút tăng giảm tiền nhanh (`+50k`, `+100k`, `+500k`, `+1M`, `+2M`, `+5M`).
- **Đính kèm ảnh chụp hóa đơn (Receipt Image)**: Hỗ trợ upload ảnh chụp chứng từ, xem thumbnail, phóng to xem chi tiết trong modal và tải ảnh về máy.
- **Toàn vẹn dữ liệu**: Khi chỉnh sửa hoặc xóa giao dịch, hệ thống tự động hoàn trả (rollback) số dư ví chính xác 100%.

### 🎯 Thiết lập Ngân sách (Budgeting) & Tạo Budget từ Thu nhập
- **Hạn mức theo từng danh mục**: Cài đặt ngân sách chi tiêu tháng cho Ăn uống, Mua sắm, Di chuyển, Hóa đơn...
- **Hệ thống cảnh báo 2 cấp độ**:
  - 🟡 **Cảnh báo chạm mốc 80%**: Banner vàng kèm gợi ý số tiền tối đa nên chi tiêu mỗi ngày.
  - 🔴 **Cảnh báo vượt 100%**: Banner đỏ cảnh báo khẩn cấp khi danh mục bị chi vượt ngưỡng.
- **Thêm thu nhập cá nhân → Tạo Budget khả dụng để tiêu**:
  - Phân bổ theo quy tắc **50/30/20** (50% Thiết yếu, 30% Mong muốn, 20% Tích lũy).
  - Tự động trừ chi phí cố định (Hóa đơn) và mục tiêu tích lũy để tính ra **Ngân sách chi tiêu khả dụng thực tế**.

### ⏰ Chi phí Định kỳ & Mục tiêu Tích lũy (Recurring Bills & Savings Goals)
- **Hóa đơn định kỳ (Recurring Bills)**: Tiền nhà, điện EVN, nước, internet FPT, netflix... Đếm ngược ngày và nút **"Thanh toán ngay"** tự động trừ ví.
- **Hũ tiết kiệm & Mục tiêu tích lũy (Savings Goals)**: Đặt mục tiêu mua xe, mua laptop, quỹ khẩn cấp... Thao tác nạp/rút tiền kèm pháo hoa mừng (Confetti celebration) khi đạt 100%!

### 📊 Báo cáo & Phân tích Chuyên sâu (Reports & Analytics)
- **Biểu đồ tròn (Donut)**: Cơ cấu tỷ trọng % chi tiêu theo danh mục.
- **Biểu đồ cột (Bar)**: So sánh Thu nhập vs Chi tiêu qua các tháng.
- **Biểu đồ vùng (Area)**: Xu hướng dòng tiền và tăng trưởng tài sản tích lũy.
- **Xuất báo cáo đa định dạng**: CSV UTF-8, Excel (.xlsx) nhiều sheet và In / Xuất PDF chuyên nghiệp.

---

## 💻 2. Lineup Công nghệ (Tech Stack)

- **Frontend**: **Next.js 15** (React 19, App Router, TypeScript) + **Tailwind CSS v4**
- **Data Visualization**: **Recharts** (Interactive Area, Bar, Pie charts)
- **Reactive State & Debounce**: Tối ưu 60 FPS khi kéo thanh trượt mô phỏng
- **Iconography**: **Lucide React**
- **Spreadsheet Engine**: **ExcelJS (xlsx)**
- **Animations**: **canvas-confetti**
- **Demo API (không persist vào DB)**: `/api/wallets`, `/api/transactions`, `/api/budgets`, `/api/bills`, `/api/goals`, `/api/simulation/what-if`, `/api/summary`

---

## 🚀 3. Hướng dẫn Chạy Ứng dụng

1. Mở Terminal và điều hướng vào thư mục đã clone:
```bash
cd "final prj webapp"
```

2. Cài đặt thư viện và khởi chạy:
```bash
npm install
npm run dev
# hoặc chạy production:
npm start
```
3. Mở trình duyệt tại: **`http://localhost:3000`**
