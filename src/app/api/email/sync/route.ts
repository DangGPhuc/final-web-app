import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { decryptToken } from '@/lib/security/crypto';
import {
  ingestFromGmail,
  getDemoBankEmails,
  type IngestionResult,
} from '@/lib/email/gmail-client';
import { parseBankNotification } from '@/lib/email/bank-parsers';
import type { SyncResultStats } from '@/types';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const {
      accountId, // optional: specific GmailConnection ID or 'ALL'
      fromDate, // optional ISO string
      toDate, // optional ISO string
      useDemoIfNoAccounts = true,
    } = body as {
      accountId?: string;
      fromDate?: string;
      toDate?: string;
      useDemoIfNoAccounts?: boolean;
    };

    const fromDateObj = fromDate ? new Date(fromDate) : undefined;
    const toDateObj = toDate ? new Date(toDate) : undefined;

    // 1. Fetch target Gmail connections
    let connections = await prisma.gmailConnection.findMany({
      where: {
        revokedAt: null,
        ...(accountId && accountId !== 'ALL' ? { id: accountId } : {}),
      },
    });

    let isDemoMode = false;
    let aggregateStats: SyncResultStats = {
      totalFetched: 0,
      totalNew: 0,
      totalDuplicates: 0,
      totalFailed: 0,
      dateRange: fromDate && toDate ? `${fromDate} → ${toDate}` : undefined,
    };

    // If no real Gmail accounts connected and demo mode enabled
    if (connections.length === 0 && useDemoIfNoAccounts) {
      isDemoMode = true;
      const demoEmails = getDemoBankEmails();

      // Filter by date range if specified
      const filteredEmails = demoEmails.filter(e => {
        const d = new Date(e.date).getTime();
        if (fromDateObj && d < fromDateObj.getTime()) return false;
        if (toDateObj && d > toDateObj.getTime() + 24 * 60 * 60 * 1000) return false;
        return true;
      });

      aggregateStats.totalFetched = filteredEmails.length;
      aggregateStats.accountEmail = 'demo-bank@gmail.com';

      for (const email of filteredEmails) {
        const parsed = parseBankNotification(email);
        if (!parsed) {
          aggregateStats.totalFailed++;
          continue;
        }

        // Authoritative deduplication check
        const exists = await prisma.bankTransaction.findUnique({
          where: { gmailMessageId: parsed.gmailMessageId },
        });

        if (exists) {
          aggregateStats.totalDuplicates++;
          continue;
        }

        await prisma.bankTransaction.create({
          data: {
            sourceEmail: 'demo-bank@gmail.com',
            gmailMessageId: parsed.gmailMessageId,
            bankCode: parsed.bankCode,
            bankName: parsed.bankName,
            accountHint: parsed.accountHint,
            direction: parsed.direction,
            amount: parsed.amount,
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
        message: 'Đã nhập biến động thành công từ nguồn demo an toàn.',
      });
    }

    if (connections.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Chưa có tài khoản Gmail nào được liên kết. Vui lòng bấm "+ Thêm tài khoản Gmail" trong Cài đặt.',
        },
        { status: 400 }
      );
    }

    // 2. Perform real ingestion for each connected account
    const accountsProcessed: string[] = [];

    for (const conn of connections) {
      const startedAt = new Date();
      let refreshToken = '';
      try {
        refreshToken = decryptToken(conn.encryptedRefreshToken);
      } catch (err) {
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
        });
      } catch (err) {
        console.error(`Ingestion error for ${conn.email}:`, err);
        continue;
      }

      let newCount = 0;
      let dupCount = 0;

      for (const event of ingestionResult.events) {
        // Authoritative deduplication check by UNIQUE(gmailMessageId)
        const exists = await prisma.bankTransaction.findUnique({
          where: { gmailMessageId: event.gmailMessageId },
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
            bankCode: event.bankCode,
            bankName: event.bankName,
            accountHint: event.accountHint,
            direction: event.direction,
            amount: event.amount,
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
    }

    aggregateStats.accountEmail = accountsProcessed.join(', ');

    return NextResponse.json({
      success: true,
      isDemoSource: isDemoMode,
      stats: aggregateStats,
      message: `Đã hoàn tất quét email: +${aggregateStats.totalNew} biến động mới.`,
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
