import { NextResponse } from 'next/server';
import { INITIAL_WALLETS, INITIAL_TRANSACTIONS, INITIAL_GOALS } from '@/lib/mock-data';
import { calculateFinancialSummary, getCurrentYearMonth } from '@/lib/utils';

export async function GET() {
  const summary = calculateFinancialSummary(INITIAL_WALLETS, INITIAL_TRANSACTIONS, getCurrentYearMonth(), INITIAL_GOALS);
  return NextResponse.json({
    success: true,
    data: summary,
  });
}
