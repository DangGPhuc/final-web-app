import { NextResponse } from 'next/server';
import { INITIAL_WALLETS, INITIAL_TRANSACTIONS, INITIAL_GOALS } from '@/lib/mock-data';
import { calculateFinancialSummary, getCurrentYearMonth } from '@/lib/utils';
import { checkLegacyDemoRouteDisabled } from '@/lib/api-guard';

const DEMO_HEADERS = { 'X-Demo-Only': 'true', 'X-Persistence': 'none' };

export async function GET() {
  const disabled = checkLegacyDemoRouteDisabled();
  if (disabled) return disabled;
  const summary = calculateFinancialSummary(INITIAL_WALLETS, INITIAL_TRANSACTIONS, getCurrentYearMonth(), INITIAL_GOALS);
  return NextResponse.json({ success: true, data: summary, _demo: true }, { headers: DEMO_HEADERS });
}
