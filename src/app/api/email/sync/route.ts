import { NextRequest, NextResponse } from 'next/server';
import { GmailProvider } from '@/lib/email/gmail-provider';
import { parseEmailMessage, normalizeToTransaction } from '@/lib/email/normalizer';
import { deduplicateTransactions } from '@/lib/email/dedupe';
import type { Transaction, MerchantRule, EmailMessage } from '@/types';

// Fixture demo emails for demonstration/testing when Gmail credentials are not set
const DEMO_EMAILS: EmailMessage[] = [
  {
    id: 'msg_vcb_001',
    from: 'vietcombank@vcb.com.vn',
    subject: 'VCB: TK 1234| GD: +25,000,000 VND | 05/09/2026 | Cong ty CP Cong nghe chuyen luong Thang 9',
    snippet: 'VCB: TK 1234| GD: +25,000,000 VND | 05/09/2026 | Cong ty CP Cong nghe chuyen luong Thang 9',
    receivedAt: '2026-09-05T09:30:00.000Z',
  },
  {
    id: 'msg_vcb_002',
    from: 'vietcombank@vcb.com.vn',
    subject: 'VCB: TK 1234| GD: -120,000 VND | 06/09/2026 | Thanh toan Cafe Highland Nguyen Du',
    snippet: 'VCB: TK 1234| GD: -120,000 VND | 06/09/2026 | Thanh toan Cafe Highland Nguyen Du',
    receivedAt: '2026-09-06T14:15:00.000Z',
  },
  {
    id: 'msg_vcb_003',
    from: 'vietcombank@vcb.com.vn',
    subject: 'VCB: TK 1234| GD: -350,000 VND | 08/09/2026 | Thanh toan Grab Car di lam',
    snippet: 'VCB: TK 1234| GD: -350,000 VND | 08/09/2026 | Thanh toan Grab Car di lam',
    receivedAt: '2026-09-08T08:00:00.000Z',
  },
  {
    id: 'msg_tcb_004',
    from: 'alert@techcombank.com.vn',
    subject: 'Thông báo biến động số dư tài khoản',
    snippet: 'So tien ghi no: 1,850,000 VND luc 10/09/2026. Dien giai: Mua sam Shopee don hang 98231',
    receivedAt: '2026-09-10T19:20:00.000Z',
  },
  {
    id: 'msg_unknown_005',
    from: 'billing@unrecognized-sender.org',
    subject: 'Xác nhận dịch vụ trực tuyến',
    snippet: 'Giao dịch thanh toan 500,000 VND vao ngay 12/09/2026',
    receivedAt: '2026-09-12T11:00:00.000Z',
  },
];

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const {
      since,
      existingTransactions = [],
      merchantRules = [],
      trustedSenders = ['vietcombank@vcb.com.vn', 'alert@techcombank.com.vn'],
      autoPostMinConfidence = 0.8,
      useDemoIfUnconfigured = true,
    } = body as {
      since?: string;
      existingTransactions?: Transaction[];
      merchantRules?: MerchantRule[];
      trustedSenders?: string[];
      autoPostMinConfidence?: number;
      useDemoIfUnconfigured?: boolean;
    };

    const provider = new GmailProvider();
    const isConnected = await provider.isConnected();

    let messages: EmailMessage[] = [];
    let isDemoSource = false;

    if (isConnected) {
      messages = await provider.fetchMessages(since);
    } else if (useDemoIfUnconfigured) {
      // Use demo bank notifications for offline testing & demo
      messages = DEMO_EMAILS;
      isDemoSource = true;
    } else {
      return NextResponse.json(
        {
          success: false,
          error: 'Gmail chưa kết nối. Vui lòng cấu hình OAuth trong Settings hoặc bật chế độ demo.',
        },
        { status: 400 }
      );
    }

    const candidateTransactions: Transaction[] = [];
    let totalSkipped = 0;
    let totalNeedsReview = 0;
    let totalPosted = 0;

    for (const msg of messages) {
      const parsed = parseEmailMessage(msg);
      if (!parsed) {
        totalSkipped++;
        continue;
      }

      const tx = normalizeToTransaction(
        parsed,
        msg,
        merchantRules,
        trustedSenders,
        autoPostMinConfidence
      );

      if (tx.status === 'NEEDS_REVIEW') {
        totalNeedsReview++;
      } else {
        totalPosted++;
      }

      candidateTransactions.push(tx);
    }

    // Deduplicate against existing transactions
    const newTransactions = deduplicateTransactions(
      existingTransactions,
      candidateTransactions
    );

    return NextResponse.json({
      success: true,
      isDemoSource,
      syncedAt: new Date().toISOString(),
      transactions: newTransactions,
      stats: {
        totalFetched: messages.length,
        totalParsed: candidateTransactions.length,
        totalNew: newTransactions.length,
        totalSkipped,
        totalNeedsReview,
        totalPosted,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Lỗi đồng bộ email',
      },
      { status: 500 }
    );
  }
}
