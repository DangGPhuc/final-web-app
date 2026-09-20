import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { decryptToken } from '@/lib/security/crypto';
import { OWNER_COOKIE_NAME, verifyOwnerSessionToken } from '@/lib/security/owner-auth';
import {
  ingestFromGmail,
  getDemoBankEmails,
  GmailTokenRevokedError,
  GmailConfigError,
  GmailTransientError,
  type IngestionResult,
} from '@/lib/email/gmail-client';
import { parseBankNotification } from '@/lib/email/bank-parsers';
import { getVietnamDateRangeBoundaries, parseAndValidateIsoDate } from '@/lib/date';
import type { SyncResultStats, AccountSyncResult } from '@/types';

const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  Pragma: 'no-cache',
};

export async function POST(req: NextRequest) {
  // 1. Owner authorization check
  const sessionCookie = req.cookies.get(OWNER_COOKIE_NAME)?.value;
  const testBypass = req.headers.get('x-owner-test-bypass');
  const isTest = process.env.NODE_ENV === 'test' && testBypass === 'test-authorized-owner';

  if (!isTest && !(await verifyOwnerSessionToken(sessionCookie))) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized: Phiên chủ sở hữu không hợp lệ (Owner session required).' },
      { status: 401, headers: NO_CACHE_HEADERS }
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const {
      mode, // optional: 'QUICK' | 'HISTORICAL'
      accountId, // optional: specific GmailConnection ID or 'ALL'
      fromDate, // optional ISO string (YYYY-MM-DD)
      toDate, // optional ISO string (YYYY-MM-DD)
      isDemoMode = false,
      pageToken,
      accountContinuationTokens,
      quickScanBounds,
    } = body as {
      mode?: 'QUICK' | 'HISTORICAL';
      accountId?: string;
      fromDate?: string;
      toDate?: string;
      isDemoMode?: boolean;
      pageToken?: string;
      accountContinuationTokens?: Record<string, string>;
      quickScanBounds?: Record<string, { lowerBoundEpoch: number; quickScanUpperBoundEpoch: number }>;
    };

    const effectiveMode: 'QUICK' | 'HISTORICAL' =
      mode || (fromDate || toDate ? 'HISTORICAL' : 'QUICK');

    // 2. Validate date range parameters for Historical Mode
    let fromDateObj: Date | undefined;
    let toDateObj: Date | undefined;
    let rangeStartMs: number | undefined;
    let rangeEndMs: number | undefined;

    if (effectiveMode === 'HISTORICAL') {
      if (fromDate) {
        try {
          parseAndValidateIsoDate(fromDate);
          fromDateObj = new Date(fromDate);
        } catch (err) {
          return NextResponse.json(
            { success: false, error: err instanceof Error ? err.message : 'Tham số ngày bắt đầu (fromDate) không hợp lệ.' },
            { status: 400, headers: NO_CACHE_HEADERS }
          );
        }
      }

      if (toDate) {
        try {
          parseAndValidateIsoDate(toDate);
          toDateObj = new Date(toDate);
        } catch (err) {
          return NextResponse.json(
            { success: false, error: err instanceof Error ? err.message : 'Tham số ngày kết thúc (toDate) không hợp lệ.' },
            { status: 400, headers: NO_CACHE_HEADERS }
          );
        }
      }

      if (fromDateObj && toDateObj && fromDateObj.getTime() > toDateObj.getTime()) {
        return NextResponse.json(
          {
            success: false,
            error: 'Khoảng thời gian không hợp lệ: Ngày bắt đầu phải nhỏ hơn hoặc bằng ngày kết thúc.',
          },
          { status: 400, headers: NO_CACHE_HEADERS }
        );
      }

      const boundaries = getVietnamDateRangeBoundaries(fromDate, toDate);
      rangeStartMs = boundaries.rangeStartMs;
      rangeEndMs = boundaries.rangeEndMs;
    }

    // 3. Fetch target Gmail connections
    const connections = await prisma.gmailConnection.findMany({
      where: {
        revokedAt: null,
        ...(accountId && accountId !== 'ALL' ? { id: accountId } : {}),
      },
    });

    const isAllAccounts = !accountId || accountId === 'ALL';
    const hasAccountTokens =
      Boolean(accountContinuationTokens && Object.keys(accountContinuationTokens).length > 0);
    const isContinuationMode = isAllAccounts
      ? hasAccountTokens
      : Boolean(pageToken || (hasAccountTokens && accountContinuationTokens?.[accountId!]));

    // Determine target connections to process
    let targetConnections = connections;
    if (isAllAccounts && isContinuationMode) {
      // In ALL-accounts continuation mode:
      // Process ONLY accounts that currently have an active continuation token!
      // Completed accounts are NOT restarted!
      const activeAccountIds = Object.keys(accountContinuationTokens || {});
      targetConnections = connections.filter(conn => activeAccountIds.includes(conn.id));
    }

    const aggregateStats: SyncResultStats = {
      mode: effectiveMode,
      totalFetched: 0,
      totalNew: 0,
      totalDuplicates: 0,
      totalFailed: 0,
      dateRange: effectiveMode === 'HISTORICAL' && fromDate && toDate ? `${fromDate} → ${toDate}` : undefined,
      truncated: false,
      accountResults: [],
      accountContinuationTokens: {},
      quickScanBounds: {},
    };

    // 4. Handle Demo Mode (Explicit action only — Never automatic surprise)
    if (isDemoMode) {
      if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEMO_DATA !== 'true') {
        return NextResponse.json(
          { success: false, error: 'Dữ liệu demo không khả dụng trong môi trường production.' },
          { status: 403, headers: NO_CACHE_HEADERS }
        );
      }

      const demoEmails = getDemoBankEmails();
      const filteredEmails = demoEmails.filter(e => {
        const parsed = parseBankNotification(e);
        if (!parsed) return false;
        if (effectiveMode === 'HISTORICAL') {
          const d = parsed.occurredAt.getTime();
          if (rangeStartMs !== undefined && d < rangeStartMs) return false;
          if (rangeEndMs !== undefined && d >= rangeEndMs) return false;
        }
        return true;
      });

      aggregateStats.totalFetched = filteredEmails.length;
      aggregateStats.accountEmail = 'demo-bank@gmail.com (Dữ liệu thử nghiệm)';

      let demoNew = 0;
      let demoDup = 0;
      let demoFailed = 0;

      for (const email of filteredEmails) {
        const parsed = parseBankNotification(email);
        if (!parsed) {
          demoFailed++;
          continue;
        }

        // Deduplication check
        const exists = await prisma.bankTransaction.findFirst({
          where: {
            OR: [
              { gmailMessageId: parsed.gmailMessageId },
              ...(parsed.bankRefId ? [{ bankCode: parsed.bankCode, bankRefId: parsed.bankRefId }] : []),
              { fingerprint: parsed.fingerprint },
            ],
          },
        });

        if (exists) {
          demoDup++;
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
            emailReceivedAt: parsed.emailReceivedAt,
            counterparty: parsed.counterparty,
            merchantLabel: parsed.merchantLabel,
            summary: parsed.summary,
            classificationState: 'UNCLASSIFIED',
          },
        });

        demoNew++;
      }

      aggregateStats.totalNew = demoNew;
      aggregateStats.totalDuplicates = demoDup;
      aggregateStats.totalFailed = demoFailed;

      return NextResponse.json(
        {
          success: true,
          isDemoSource: true,
          stats: aggregateStats,
          message: 'Đã nhập biến động mẫu DEMO thành công.',
        },
        { headers: NO_CACHE_HEADERS }
      );
    }

    // 5. Normal operation: if no Gmail accounts are linked, prompt user
    if (connections.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Chưa có tài khoản Gmail nào được liên kết hoặc tất cả tài khoản cần xác thực lại. Vui lòng thêm/kết nối lại tài khoản Gmail.',
        },
        { status: 400, headers: NO_CACHE_HEADERS }
      );
    }

    // 6. Perform real ingestion for each connected account
    const accountsProcessed: string[] = [];
    let successfulAccounts = 0;

    for (const conn of targetConnections) {
      const startedAt = new Date();
      let refreshToken = '';
      try {
        refreshToken = decryptToken(conn.encryptedRefreshToken);
      } catch {
        aggregateStats.accountResults?.push({
          accountId: conn.id,
          email: conn.email,
          fetchedCount: 0,
          newCount: 0,
          duplicateCount: 0,
          failedCount: 0,
          status: 'error',
          errorMessage: 'Lỗi giải mã token xác thực.',
        });
        continue;
      }

      let specificPageToken: string | undefined = undefined;
      if (isAllAccounts) {
        // In ALL-accounts mode, use ONLY accountContinuationTokens[conn.id]!
        // Never fallback to global pageToken or another account's token!
        specificPageToken = accountContinuationTokens?.[conn.id];
      } else {
        // In single-account mode, use specific token or pageToken
        specificPageToken = accountContinuationTokens?.[conn.id] || pageToken;
      }

      // Quick Scan bounded snapshot calculations
      let connLowerBoundEpoch: number | undefined;
      let connQuickScanUpperBoundEpoch: number | undefined;

      if (effectiveMode === 'QUICK') {
        if (
          quickScanBounds?.[conn.id] &&
          Number.isFinite(quickScanBounds[conn.id].lowerBoundEpoch) &&
          Number.isFinite(quickScanBounds[conn.id].quickScanUpperBoundEpoch)
        ) {
          // Carry existing stable bounds across continuation pages
          connLowerBoundEpoch = quickScanBounds[conn.id].lowerBoundEpoch;
          connQuickScanUpperBoundEpoch = quickScanBounds[conn.id].quickScanUpperBoundEpoch;
        } else {
          // Initial Quick Scan: capture current server instant as fixed upper watermark
          const serverInstant = new Date();
          connQuickScanUpperBoundEpoch = Math.floor(serverInstant.getTime() / 1000);
          // Lower bound: last completed Quick Scan watermark, or connectedAt fallback
          const lowerBoundDate = conn.lastSyncAt || conn.connectedAt;
          connLowerBoundEpoch = Math.floor(lowerBoundDate.getTime() / 1000);
        }
      }

      let ingestionResult: IngestionResult;
      try {
        if (effectiveMode === 'QUICK') {
          ingestionResult = await ingestFromGmail(refreshToken, {
            mode: 'QUICK',
            lowerBoundEpoch: connLowerBoundEpoch,
            upperBoundEpoch: connQuickScanUpperBoundEpoch,
            pageToken: specificPageToken,
          });
        } else {
          ingestionResult = await ingestFromGmail(refreshToken, {
            mode: 'HISTORICAL',
            fromDate,
            toDate,
            pageToken: specificPageToken,
          });
        }
      } catch (err) {
        if (err instanceof GmailTokenRevokedError) {
          // Mark connection as revoked / reconnect required in DB
          await prisma.gmailConnection.update({
            where: { id: conn.id },
            data: { revokedAt: new Date() },
          });
          aggregateStats.accountResults?.push({
            accountId: conn.id,
            email: conn.email,
            fetchedCount: 0,
            newCount: 0,
            duplicateCount: 0,
            failedCount: 0,
            status: 'reconnect_required',
            errorMessage: 'Token đã hết hạn hoặc bị thu hồi (Yêu cầu kết nối lại).',
          });
        } else if (err instanceof GmailConfigError) {
          aggregateStats.accountResults?.push({
            accountId: conn.id,
            email: conn.email,
            fetchedCount: 0,
            newCount: 0,
            duplicateCount: 0,
            failedCount: 0,
            status: 'error',
            errorMessage: 'Lỗi cấu hình quyền Gmail API (Kiểm tra Google Cloud Console).',
          });
        } else if (err instanceof GmailTransientError) {
          aggregateStats.accountResults?.push({
            accountId: conn.id,
            email: conn.email,
            fetchedCount: 0,
            newCount: 0,
            duplicateCount: 0,
            failedCount: 0,
            status: 'error',
            errorMessage: 'Máy chủ Google tạm thời không phản hồi. Vui lòng thử lại sau.',
          });
        } else {
          aggregateStats.accountResults?.push({
            accountId: conn.id,
            email: conn.email,
            fetchedCount: 0,
            newCount: 0,
            duplicateCount: 0,
            failedCount: 0,
            status: 'error',
            errorMessage: 'Lỗi kết nối Gmail',
          });
        }
        continue;
      }

      successfulAccounts++;
      let newCount = 0;
      let dupCount = 0;

      for (const event of ingestionResult.events) {
        // In HISTORICAL mode: strictly enforce transaction-date range on actual occurredAt
        if (effectiveMode === 'HISTORICAL') {
          const eventTimeMs = event.occurredAt.getTime();
          if (rangeStartMs !== undefined && eventTimeMs < rangeStartMs) {
            continue;
          }
          if (rangeEndMs !== undefined && eventTimeMs >= rangeEndMs) {
            continue;
          }
        }
        // In QUICK mode: newly arrived candidates are NOT excluded merely because occurredAt is older
        // (e.g. a forwarded notification received today for yesterday's transaction is admitted).

        // Multi-account authoritative deduplication priority rules:
        // Rule A: Same Gmail account + same Gmail message ID -> Authoritative duplicate
        const sameAccountMsg = await prisma.bankTransaction.findFirst({
          where: {
            gmailConnectionId: conn.id,
            gmailMessageId: event.gmailMessageId,
          },
        });

        if (sameAccountMsg) {
          dupCount++;
          continue;
        }

        // Rule B: Same Bank Code + trustworthy Bank Transaction Reference ID -> Authoritative duplicate
        if (event.bankRefId) {
          const sameBankRef = await prisma.bankTransaction.findFirst({
            where: {
              bankCode: event.bankCode,
              bankRefId: event.bankRefId,
            },
          });

          if (sameBankRef) {
            dupCount++;
            continue;
          }
        }

        // Rule C: Conservative cross-account forwarding deduplication:
        const crossAccountForwarded = await prisma.bankTransaction.findFirst({
          where: {
            gmailConnectionId: { not: conn.id },
            bankCode: event.bankCode,
            direction: event.direction,
            amount: BigInt(event.amount),
            fingerprint: event.fingerprint,
          },
        });

        if (crossAccountForwarded) {
          // If both have bank reference IDs and they contradict, preserve both!
          if (
            event.bankRefId &&
            crossAccountForwarded.bankRefId &&
            event.bankRefId !== crossAccountForwarded.bankRefId
          ) {
            // Keep both legitimate transactions!
          } else {
            dupCount++;
            continue;
          }
        }

        // Distinct legitimate transaction: create record
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
            emailReceivedAt: event.emailReceivedAt,
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
          fromDate:
            effectiveMode === 'QUICK'
              ? new Date(connLowerBoundEpoch! * 1000)
              : fromDateObj,
          toDate:
            effectiveMode === 'QUICK'
              ? new Date(connQuickScanUpperBoundEpoch! * 1000)
              : toDateObj,
          startedAt,
          finishedAt: new Date(),
          fetchedCount: ingestionResult.totalFetched,
          importedCount: newCount,
          duplicateCount: dupCount,
          failedCount: ingestionResult.failedCount,
        },
      });

      // WATERMARK COMMIT INVARIANT:
      // lastSyncAt represents ONLY the upper watermark of the last FULLY COMPLETED Quick Scan.
      // 1. Historical imports MUST NOT advance lastSyncAt.
      // 2. Truncated Quick Scans MUST NOT advance lastSyncAt.
      // 3. Only when mode is QUICK and truncated is false (all pages completed), advance lastSyncAt to quickScanUpperBound.
      if (effectiveMode === 'QUICK' && !ingestionResult.truncated && connQuickScanUpperBoundEpoch) {
        await prisma.gmailConnection.update({
          where: { id: conn.id },
          data: { lastSyncAt: new Date(connQuickScanUpperBoundEpoch * 1000) },
        });
      }

      accountsProcessed.push(conn.email);
      aggregateStats.totalFetched += ingestionResult.totalFetched;
      aggregateStats.totalNew += newCount;
      aggregateStats.totalDuplicates += dupCount;
      aggregateStats.totalFailed += ingestionResult.failedCount;

      const accountBounds =
        effectiveMode === 'QUICK' && connLowerBoundEpoch && connQuickScanUpperBoundEpoch
          ? {
              lowerBoundEpoch: connLowerBoundEpoch,
              quickScanUpperBoundEpoch: connQuickScanUpperBoundEpoch,
            }
          : undefined;

      if (accountBounds && aggregateStats.quickScanBounds) {
        aggregateStats.quickScanBounds[conn.id] = accountBounds;
      }

      if (ingestionResult.truncated && ingestionResult.nextPageToken) {
        aggregateStats.truncated = true;
        if (!aggregateStats.nextPageToken) {
          aggregateStats.nextPageToken = ingestionResult.nextPageToken;
        }
        if (aggregateStats.accountContinuationTokens) {
          aggregateStats.accountContinuationTokens[conn.id] = ingestionResult.nextPageToken;
        }
      }

      aggregateStats.accountResults?.push({
        accountId: conn.id,
        email: conn.email,
        fetchedCount: ingestionResult.totalFetched,
        newCount,
        duplicateCount: dupCount,
        failedCount: ingestionResult.failedCount,
        status: 'ok',
        truncated: ingestionResult.truncated,
        nextPageToken: ingestionResult.nextPageToken,
        quickScanBounds: accountBounds,
      });
    }

    if (successfulAccounts === 0 && targetConnections.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Tất cả các tài khoản Gmail liên kết đều không thể đồng bộ hoặc cần xác thực lại.',
          stats: aggregateStats,
        },
        { status: 400, headers: NO_CACHE_HEADERS }
      );
    }

    aggregateStats.accountEmail = accountsProcessed.join(', ');

    return NextResponse.json(
      {
        success: true,
        isDemoSource: false,
        stats: aggregateStats,
        message: aggregateStats.truncated
          ? `Đã nhập một phần lịch sử: +${aggregateStats.totalNew} biến động mới. Vẫn còn email cần quét.`
          : `Đã hoàn tất quét email: +${aggregateStats.totalNew} biến động mới.`,
      },
      { headers: NO_CACHE_HEADERS }
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Lỗi đồng bộ email',
      },
      { status: 500, headers: NO_CACHE_HEADERS }
    );
  }
}
