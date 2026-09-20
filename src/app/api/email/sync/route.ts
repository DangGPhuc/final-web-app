import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { decryptToken } from '@/lib/security/crypto';
import { OWNER_COOKIE_NAME, verifyOwnerSessionToken } from '@/lib/security/owner-auth';
import {
  ingestFromGmail,
  getDemoBankEmails,
  type IngestionResult,
} from '@/lib/email/gmail-client';
import { parseBankNotification } from '@/lib/email/bank-parsers';
import type { SyncResultStats } from '@/types';

export async function POST(req: NextRequest) {
  // 1. Owner authorization check
  const sessionCookie = req.cookies.get(OWNER_COOKIE_NAME)?.value;
  const testBypass = req.headers.get('x-owner-test-bypass');
  const isTest = process.env.NODE_ENV === 'test' && testBypass === 'test-authorized-owner';

  if (!isTest && !verifyOwnerSessionToken(sessionCookie)) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized: Phiên chủ sở hữu không hợp lệ (Owner session required).' },
      { status: 401 }
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const {
      accountId, // optional: specific GmailConnection ID or 'ALL'
      fromDate, // optional ISO string
      toDate, // optional ISO string
      isDemoMode = false,
      pageToken,
    } = body as {
      accountId?: string;
      fromDate?: string;
      toDate?: string;
      isDemoMode?: boolean;
      pageToken?: string;
    };

    // 2. Validate date range parameters
    let fromDateObj: Date | undefined;
    let toDateObj: Date | undefined;

    if (fromDate) {
      fromDateObj = new Date(fromDate);
      if (isNaN(fromDateObj.getTime())) {
        return NextResponse.json(
          { success: false, error: 'Tham số ngày bắt đầu (fromDate) không hợp lệ.' },
          { status: 400 }
        );
      }
    }

    if (toDate) {
      toDateObj = new Date(toDate);
      if (isNaN(toDateObj.getTime())) {
        return NextResponse.json(
          { success: false, error: 'Tham số ngày kết thúc (toDate) không hợp lệ.' },
          { status: 400 }
        );
      }
    }

    if (fromDateObj && toDateObj && fromDateObj.getTime() > toDateObj.getTime()) {
      return NextResponse.json(
        {
          success: false,
          error: 'Khoảng thời gian không hợp lệ: Ngày bắt đầu phải nhỏ hơn hoặc bằng ngày kết thúc.',
        },
        { status: 400 }
      );
    }

    // 3. Fetch target Gmail connections
    const connections = await prisma.gmailConnection.findMany({
      where: {
        revokedAt: null,
        ...(accountId && accountId !== 'ALL' ? { id: accountId } : {}),
      },
    });

    const aggregateStats: SyncResultStats = {
      totalFetched: 0,
      totalNew: 0,
      totalDuplicates: 0,
      totalFailed: 0,
      dateRange: fromDate && toDate ? `${fromDate} → ${toDate}` : undefined,
      truncated: false,
    };

    // 4. Handle Demo Mode (Explicit action only — Never automatic surprise)
    if (isDemoMode) {
      if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEMO_DATA !== 'true') {
        return NextResponse.json(
          { success: false, error: 'Dữ liệu demo không khả dụng trong môi trường production.' },
          { status: 403 }
        );
      }

      const demoEmails = getDemoBankEmails();

      const filteredEmails = demoEmails.filter(e => {
        const d = new Date(e.date).getTime();
        if (fromDateObj && d < fromDateObj.getTime()) return false;
        if (toDateObj && d > toDateObj.getTime() + 24 * 60 * 60 * 1000) return false;
        return true;
      });

      aggregateStats.totalFetched = filteredEmails.length;
      aggregateStats.accountEmail = 'demo-bank@gmail.com (Dữ liệu thử nghiệm)';

      for (const email of filteredEmails) {
        const parsed = parseBankNotification(email);
        if (!parsed) {
          aggregateStats.totalFailed++;
          continue;
        }

        // Deduplication check
        const exists = await prisma.bankTransaction.findFirst({
          where: {
            OR: [
              { gmailMessageId: parsed.gmailMessageId },
              ...(parsed.bankRefId ? [{ bankRefId: parsed.bankRefId }] : []),
              { fingerprint: parsed.fingerprint },
            ],
          },
        });

        if (exists) {
          aggregateStats.totalDuplicates++;
          continue;
        }

        await prisma.bankTransaction.create({
          data: {
            sourceEmail: 'demo-bank@gmail.com',
            gmailMessageId: parsed.gmailMessageId,
            bankRefId: parsed.bankRefId,
            fingerprint: parsed.fingerprint,
            bankCode: parsed.bankCode,
            bankName: parsed.bankName,
            accountHint: parsed.accountHint,
            direction: parsed.direction,
            amount: BigInt(parsed.amount),
            currency: parsed.currency,
            occurredAt: parsed.occurredAt,
            counterparty: parsed.counterparty,
            merchantLabel: parsed.merchantLabel,
            summary: parsed.summary,
            classificationState: 'UNCLASSIFIED',
          },
        });

        aggregateStats.totalNew++;
      }

      return NextResponse.json({
        success: true,
        isDemoSource: true,
        stats: aggregateStats,
        message: 'Đã nhập biến động mẫu DEMO thành công.',
      });
    }

    // 5. Normal operation: if no Gmail accounts are linked, prompt user
    if (connections.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Chưa có tài khoản Gmail nào được liên kết. Vui lòng bấm "+ Thêm tài khoản Gmail" trong Cài đặt để bắt đầu quét.',
        },
        { status: 400 }
      );
    }

    // 6. Perform real ingestion for each connected account
    const accountsProcessed: string[] = [];

    for (const conn of connections) {
      const startedAt = new Date();
      let refreshToken = '';
      try {
        refreshToken = decryptToken(conn.encryptedRefreshToken);
      } catch {
        console.error(`Failed to decrypt token for account ${conn.email}`);
        continue;
      }

      // Default quick scan from lastSyncAt if no fromDate specified
      const effectiveFromDate = fromDateObj || (conn.lastSyncAt ? new Date(conn.lastSyncAt) : undefined);

      let ingestionResult: IngestionResult;
      try {
        ingestionResult = await ingestFromGmail(refreshToken, {
          fromDate: effectiveFromDate,
          toDate: toDateObj,
          pageToken,
        });
      } catch (err) {
        console.error(`Ingestion error for ${conn.email}:`, err);
        continue;
      }

      let newCount = 0;
      let dupCount = 0;

      for (const event of ingestionResult.events) {
        // Multi-account authoritative deduplication:
        // 1. Same Gmail message ID in this account
        // 2. Or same Bank Reference ID (forwarded email across primary & secondary Gmail)
        // 3. Or exact conservative normalized fingerprint
        const exists = await prisma.bankTransaction.findFirst({
          where: {
            OR: [
              { gmailConnectionId: conn.id, gmailMessageId: event.gmailMessageId },
              ...(event.bankRefId ? [{ bankRefId: event.bankRefId }] : []),
              { fingerprint: event.fingerprint },
            ],
          },
        });

        if (exists) {
          dupCount++;
          continue;
        }

        await prisma.bankTransaction.create({
          data: {
            gmailConnectionId: conn.id,
            sourceEmail: conn.email,
            gmailMessageId: event.gmailMessageId,
            gmailThreadId: event.gmailThreadId,
            bankRefId: event.bankRefId,
            fingerprint: event.fingerprint,
            bankCode: event.bankCode,
            bankName: event.bankName,
            accountHint: event.accountHint,
            direction: event.direction,
            amount: BigInt(event.amount),
            currency: event.currency,
            occurredAt: event.occurredAt,
            counterparty: event.counterparty,
            merchantLabel: event.merchantLabel,
            summary: event.summary,
            classificationState: 'UNCLASSIFIED',
          },
        });

        newCount++;
      }

      // Update sync run audit log
      await prisma.syncRun.create({
        data: {
          gmailConnectionId: conn.id,
          accountEmail: conn.email,
          fromDate: effectiveFromDate,
          toDate: toDateObj,
          startedAt,
          finishedAt: new Date(),
          fetchedCount: ingestionResult.totalFetched,
          importedCount: newCount,
          duplicateCount: dupCount,
          failedCount: ingestionResult.failedCount,
        },
      });

      // Update last sync time
      await prisma.gmailConnection.update({
        where: { id: conn.id },
        data: { lastSyncAt: new Date() },
      });

      accountsProcessed.push(conn.email);
      aggregateStats.totalFetched += ingestionResult.totalFetched;
      aggregateStats.totalNew += newCount;
      aggregateStats.totalDuplicates += dupCount;
      aggregateStats.totalFailed += ingestionResult.failedCount;

      if (ingestionResult.truncated) {
        aggregateStats.truncated = true;
        aggregateStats.nextPageToken = ingestionResult.nextPageToken;
      }
    }

    aggregateStats.accountEmail = accountsProcessed.join(', ');

    return NextResponse.json({
      success: true,
      isDemoSource: false,
      stats: aggregateStats,
      message: aggregateStats.truncated
        ? `Quét một phần: +${aggregateStats.totalNew} biến động mới (còn email tiếp theo chưa quét hết).`
        : `Đã hoàn tất quét email: +${aggregateStats.totalNew} biến động mới.`,
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
