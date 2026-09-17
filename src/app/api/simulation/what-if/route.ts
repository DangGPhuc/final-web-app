/**
 * POST /api/simulation/what-if — DEMO ONLY
 *
 * This is a read-only simulation endpoint using static mock data.
 * It does NOT access user data or a database.
 *
 * All numeric inputs are validated and capped before use.
 */
import { NextResponse } from 'next/server';
import { INITIAL_TRANSACTIONS, INITIAL_WALLETS, INITIAL_PLANNER } from '@/lib/mock-data';

const DEMO_HEADERS = { 'X-Demo-Only': 'true', 'X-Persistence': 'none' };

export async function POST(req: Request) {
  const contentLength = req.headers.get('content-length');
  if (contentLength && parseInt(contentLength) > 10_000) {
    return NextResponse.json(
      { success: false, error: 'Payload too large' },
      { status: 413, headers: DEMO_HEADERS }
    );
  }

  let rawBody: unknown = {};
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON body' },
      { status: 400, headers: DEMO_HEADERS }
    );
  }

  if (typeof rawBody !== 'object' || rawBody === null || Array.isArray(rawBody)) {
    return NextResponse.json(
      { success: false, error: 'Body must be a JSON object' },
      { status: 400, headers: DEMO_HEADERS }
    );
  }

  const body = rawBody as Record<string, unknown>;

  // ── Validated + bounded numeric inputs ──────────────────────────────────
  const reducePercent = clampFinite(body.reducePercent, 0, 100, 20);
  const extraInvest = clampFinite(body.extraInvest, 0, 1_000_000_000, 1_500_000);
  const targetCategoryId = typeof body.targetCategoryId === 'string' ? body.targetCategoryId.slice(0, 100) : 'cat-food';
  const annualInterestRate = clampFinite(body.annualInterestRate, 0, 100, 6.5);
  const months = Math.min(Math.max(1, Math.round(clampFinite(body.months, 1, 120, 12))), 120);

  const targetExpenses = INITIAL_TRANSACTIONS
    .filter((t) => t.type === 'EXPENSE' && (t.categoryId === targetCategoryId || !targetCategoryId))
    .reduce((s, t) => s + t.amount, 0);

  const baselineCategoryMonthly = targetExpenses > 0 ? targetExpenses : 4_500_000;
  const monthlyIncome = INITIAL_PLANNER.monthlyIncome || 32_000_000;
  const totalCurrentAssets = INITIAL_WALLETS.reduce(
    (s, w) => s + (w.type === 'CREDIT' ? -w.balance : w.balance), 0
  );

  const baseMonthlySavings = Math.max(0, monthlyIncome - 14_500_000);
  const monthlyRate = annualInterestRate / 100 / 12;
  const savedFromReduction = baselineCategoryMonthly * (reducePercent / 100);
  const newMonthlyCashSavings = Math.max(0, baseMonthlySavings + savedFromReduction - extraInvest);

  const projections = [];
  let cumulativeBaseline = totalCurrentAssets;
  let cumulativeWhatIf = totalCurrentAssets;
  let totalInvestValue = 0;

  for (let m = 0; m <= months; m++) {
    if (m === 0) {
      projections.push({ month: 0, label: 'Hiện tại', baseline: totalCurrentAssets, whatIf: totalCurrentAssets, gain: 0 });
      continue;
    }
    cumulativeBaseline += baseMonthlySavings;
    if (extraInvest > 0) {
      totalInvestValue = (totalInvestValue + extraInvest) * (1 + monthlyRate);
    }
    cumulativeWhatIf = totalCurrentAssets + m * newMonthlyCashSavings + totalInvestValue;
    projections.push({
      month: m,
      label: `Tháng ${m}`,
      baseline: Math.round(cumulativeBaseline),
      whatIf: Math.round(cumulativeWhatIf),
      gain: Math.round(Math.max(0, cumulativeWhatIf - cumulativeBaseline)),
    });
  }

  return NextResponse.json(
    {
      success: true,
      _demo: true,
      data: {
        baselineCategoryMonthly,
        totalCurrentAssets,
        projections,
        finalGain: projections[projections.length - 1].gain,
        benchmark: {
          isMockSimulation: true,
          note: 'Chỉ số minh họa kịch bản tối ưu hóa full-stack trong tương lai',
        },
      },
    },
    { headers: DEMO_HEADERS }
  );
}

function clampFinite(val: unknown, min: number, max: number, defaultVal: number): number {
  if (typeof val !== 'number' || !Number.isFinite(val)) return defaultVal;
  return Math.min(Math.max(val, min), max);
}
