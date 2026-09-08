import { NextResponse } from 'next/server';
import { INITIAL_WALLETS, INITIAL_TRANSACTIONS } from '@/lib/mock-data';
import { calculateFinancialSummary } from '@/lib/utils';

export async function GET() {
  const summary = calculateFinancialSummary(INITIAL_WALLETS, INITIAL_TRANSACTIONS, '2026-09');
  return NextResponse.json({
    success: true,
    data: summary,
  });
}
