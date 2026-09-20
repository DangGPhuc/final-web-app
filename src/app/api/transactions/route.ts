import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

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
      occurredAt: t.occurredAt.toISOString(),
      importedAt: t.importedAt.toISOString(),
      direction: t.direction as 'IN' | 'OUT',
      classificationState: t.classificationState as 'UNCLASSIFIED' | 'CLASSIFIED',
      category: t.category ? { ...t.category, createdAt: t.category.createdAt.toISOString() } : null,
      fund: t.fund ? { ...t.fund, createdAt: t.fund.createdAt.toISOString() } : null,
    }));

    return NextResponse.json({ success: true, transactions: formatted });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to load transactions',
      },
      { status: 500 }
    );
  }
}
