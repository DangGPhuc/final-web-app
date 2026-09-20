import type {
  BankTransaction,
  Fund,
  MonthlySnapshot,
  PaperTradeScenario,
} from '@/types';
import { getCurrentYearMonth } from './finance/calculations';

function getOffsetMonth(offset: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + offset);
  return getCurrentYearMonth(d);
}

const currentMonth = getCurrentYearMonth();
const lastMonth = getOffsetMonth(-1);
const twoMonthsAgo = getOffsetMonth(-2);

export const DEMO_FUNDS: Fund[] = [
  {
    id: 'fund-living',
    name: 'Quỹ sinh hoạt & Nhà cửa',
    monthlyAllocation: 8000000,
    createdAt: new Date().toISOString(),
    active: true,
  },
  {
    id: 'fund-dining',
    name: 'Quỹ ăn uống',
    monthlyAllocation: 4500000,
    createdAt: new Date().toISOString(),
    active: true,
  },
  {
    id: 'fund-transport',
    name: 'Quỹ di chuyển',
    monthlyAllocation: 1500000,
    createdAt: new Date().toISOString(),
    active: true,
  },
];

export const DEMO_TRANSACTIONS: BankTransaction[] = [
  {
    id: 'tx-001',
    sourceEmail: 'vietcombank@vcb.com.vn',
    gmailMessageId: 'msg_vcb_001',
    bankCode: 'VCB',
    bankName: 'Vietcombank',
    accountHint: '••••1234',
    direction: 'IN',
    amount: 35000000,
    currency: 'VND',
    occurredAt: `${currentMonth}-05T09:30:00Z`,
    counterparty: 'CÔNG TY TNHH TECH CORP',
    summary: 'Chuyển khoản lương tháng',
    classificationState: 'UNCLASSIFIED',
    importedAt: new Date().toISOString(),
  },
  {
    id: 'tx-002',
    sourceEmail: 'alert@techcombank.com.vn',
    gmailMessageId: 'msg_tcb_002',
    bankCode: 'TCB',
    bankName: 'Techcombank',
    accountHint: '••••8821',
    direction: 'OUT',
    amount: 120000,
    currency: 'VND',
    occurredAt: `${currentMonth}-06T14:15:00Z`,
    counterparty: 'HIGHLANDS COFFEE',
    merchantLabel: 'Highlands Coffee',
    summary: 'Thanh toán Highlands Coffee',
    classificationState: 'UNCLASSIFIED',
    importedAt: new Date().toISOString(),
  },
];

export const DEMO_MONTHLY_SNAPSHOTS: MonthlySnapshot[] = [
  {
    month: twoMonthsAgo,
    totalIncome: 35000000,
    totalExpense: 21500000,
    netSavings: 13500000,
    fundResults: [
      {
        fundId: 'fund-living',
        fundName: 'Quỹ sinh hoạt & Nhà cửa',
        allocated: 8000000,
        spent: 7800000,
        remaining: 200000,
      },
      {
        fundId: 'fund-dining',
        fundName: 'Quỹ ăn uống',
        allocated: 4500000,
        spent: 4200000,
        remaining: 300000,
      },
    ],
    closedAt: new Date().toISOString(),
  },
  {
    month: lastMonth,
    totalIncome: 37000000,
    totalExpense: 23000000,
    netSavings: 14000000,
    fundResults: [
      {
        fundId: 'fund-living',
        fundName: 'Quỹ sinh hoạt & Nhà cửa',
        allocated: 8000000,
        spent: 8100000,
        remaining: -100000,
      },
      {
        fundId: 'fund-dining',
        fundName: 'Quỹ ăn uống',
        allocated: 4500000,
        spent: 4400000,
        remaining: 100000,
      },
    ],
    closedAt: new Date().toISOString(),
  },
];

export const DEMO_PAPER_TRADES: PaperTradeScenario[] = [
  {
    id: 'trade-001',
    instrument: 'BTC',
    direction: 'LONG',
    entryPrice: 62500,
    currentPrice: 65200,
    margin: 1000,
    leverage: 10,
    stopLoss: 60000,
    takeProfit: 70000,
    feePercent: 0.05,
    createdAt: new Date().toISOString(),
    status: 'PROFIT',
  },
  {
    id: 'trade-002',
    instrument: 'XAU',
    direction: 'LONG',
    entryPrice: 2500,
    currentPrice: 2535,
    margin: 500,
    leverage: 20,
    stopLoss: 2450,
    takeProfit: 2600,
    feePercent: 0.04,
    createdAt: new Date().toISOString(),
    status: 'PROFIT',
  },
];
