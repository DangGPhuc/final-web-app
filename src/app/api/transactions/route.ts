import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  Pragma: 'no-cache',
};

export async function GET(req: NextRequest) {
  try {
    const transactions = await prisma.bankTransaction.findMany({
      orderBy: { occurredAt: 'desc' },
      include: {
        category: true,
        fund: true,
      },
    });

    const formatted = transactions.map(t => ({
      ...t,
      amount: Number(t.amount),
      occurredAt: t.occurredAt.toISOString(),
      emailReceivedAt: t.emailReceivedAt ? t.emailReceivedAt.toISOString() : null,
      importedAt: t.importedAt.toISOString(),
      direction: t.direction as 'IN' | 'OUT',
      classificationState: t.classificationState as 'UNCLASSIFIED' | 'CLASSIFIED',
      category: t.category ? { ...t.category, createdAt: t.category.createdAt.toISOString() } : null,
      fund: t.fund
        ? {
            ...t.fund,
            monthlyAllocation: Number(t.fund.monthlyAllocation),
            createdAt: t.fund.createdAt.toISOString(),
          }
        : null,
    }));

    return NextResponse.json({ success: true, transactions: formatted }, { headers: NO_CACHE_HEADERS });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to load transactions',
      },
      { status: 500, headers: NO_CACHE_HEADERS }
    );
  }
}
