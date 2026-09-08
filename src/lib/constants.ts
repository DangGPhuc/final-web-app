import { Category } from '@/types';

export const DEFAULT_CATEGORIES: Category[] = [
  // Khoản chi
  { id: 'cat-food', name: 'Ăn uống', type: 'EXPENSE', icon: 'Utensils', color: '#f97316' },
  { id: 'cat-transport', name: 'Di chuyển & Xe', type: 'EXPENSE', icon: 'Car', color: '#0ea5e9' },
  { id: 'cat-shopping', name: 'Mua sắm', type: 'EXPENSE', icon: 'ShoppingBag', color: '#ec4899' },
  { id: 'cat-bills', name: 'Hóa đơn & Tiện ích', type: 'EXPENSE', icon: 'Receipt', color: '#eab308' },
  { id: 'cat-housing', name: 'Nhà cửa & Thuê nhà', type: 'EXPENSE', icon: 'Home', color: '#8b5cf6' },
  { id: 'cat-entertainment', name: 'Giải trí & Du lịch', type: 'EXPENSE', icon: 'Gamepad2', color: '#10b981' },
  { id: 'cat-health', name: 'Sức khỏe & Y tế', type: 'EXPENSE', icon: 'HeartPulse', color: '#ef4444' },
  { id: 'cat-education', name: 'Giáo dục & Khóa học', type: 'EXPENSE', icon: 'GraduationCap', color: '#06b6d4' },
  { id: 'cat-invest-exp', name: 'Đầu tư & Tích lũy', type: 'EXPENSE', icon: 'TrendingUp', color: '#6366f1' },
  { id: 'cat-other-exp', name: 'Chi phí khác', type: 'EXPENSE', icon: 'MoreHorizontal', color: '#64748b' },

  // Khoản thu
  { id: 'cat-salary', name: 'Lương chính', type: 'INCOME', icon: 'Briefcase', color: '#10b981' },
  { id: 'cat-bonus', name: 'Thưởng & Làm thêm', type: 'INCOME', icon: 'Gift', color: '#f59e0b' },
  { id: 'cat-invest-inc', name: 'Lợi nhuận đầu tư', type: 'INCOME', icon: 'Coins', color: '#3b82f6' },
  { id: 'cat-business', name: 'Kinh doanh & Bán hàng', type: 'INCOME', icon: 'Store', color: '#8b5cf6' },
  { id: 'cat-other-inc', name: 'Thu nhập khác', type: 'INCOME', icon: 'PlusCircle', color: '#14b8a6' },
];

export const POPULAR_TAGS = [
  'Ăn trưa', 'Cafe', 'Tiệc tùng', 'Gia đình', 'Công tác', 
  'Grab/Be', 'Xăng xe', 'Siêu thị', 'Online', 'Du lịch', 
  'Sức khỏe', 'Khẩn cấp', 'Đầu tư'
];

export const VIETNAMESE_BANKS = [
  { code: 'VCB', name: 'Vietcombank', color: '#007A33' },
  { code: 'TCB', name: 'Techcombank', color: '#ED1C24' },
  { code: 'MBB', name: 'MB Bank', color: '#0047BA' },
  { code: 'ACB', name: 'ACB Bank', color: '#005CA9' },
  { code: 'VPB', name: 'VPBank', color: '#00A651' },
  { code: 'BIDV', name: 'BIDV', color: '#006738' },
  { code: 'VIB', name: 'VIB', color: '#00539B' },
  { code: 'TPB', name: 'TPBank', color: '#802682' },
  { code: 'MOMO', name: 'Ví MoMo', color: '#A50064' },
  { code: 'ZALOPAY', name: 'ZaloPay', color: '#0068FF' },
];
