import { NextResponse } from 'next/server';
import { INITIAL_GOALS } from '@/lib/mock-data';
import { checkLegacyDemoRouteDisabled } from '@/lib/api-guard';

const DEMO_HEADERS = { 'X-Demo-Only': 'true', 'X-Persistence': 'none' };

export async function GET() {
  const disabled = checkLegacyDemoRouteDisabled();
  if (disabled) return disabled;
  return NextResponse.json({ success: true, data: INITIAL_GOALS, _demo: true }, { headers: DEMO_HEADERS });
}
