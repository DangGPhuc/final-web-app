export const DEFAULT_CATEGORIES = [
  'Lương',
  'Thưởng',
  'Thu nhập khác',
  'Ăn uống',
  'Di chuyển',
  'Mua sắm',
  'Hóa đơn',
  'Nhà cửa',
  'Giải trí',
  'Sức khỏe',
  'Giáo dục',
  'Đầu tư',
  'Khác',
] as const;

export type CategoryName = (typeof DEFAULT_CATEGORIES)[number];

export const POPULAR_TAGS = [
  'Ăn trưa',
  'Cafe',
  'Grab/Be',
  'Xăng xe',
  'Siêu thị',
  'Online',
  'Hóa đơn',
  'Khẩn cấp',
] as const;

export const SUPPORTED_BANKS = [
  { code: 'VCB', name: 'Vietcombank', parserSupported: true },
  { code: 'TCB', name: 'Techcombank', parserSupported: true },
  { code: 'MBB', name: 'MB Bank', parserSupported: false },
  { code: 'ACB', name: 'ACB', parserSupported: false },
  { code: 'VPB', name: 'VPBank', parserSupported: false },
  { code: 'BIDV', name: 'BIDV', parserSupported: false },
] as const;
