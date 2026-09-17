/**
 * POST /api/transactions — DEMO ONLY
 *
 * This is a read-only mock endpoint. The POST handler does NOT persist data.
 * All state management is handled client-side via AppContext + localStorage.
 *
 * In production (future): this endpoint would be replaced by a proper
 * authenticated API backed by PostgreSQL.
 *
 * OWASP API3:2023 — Broken Object Property Level Authorization: rejected by
 * explicit field allowlist rather than reflecting arbitrary input.
 */
import { NextResponse } from 'next/server';
import { INITIAL_TRANSACTIONS } from '@/lib/mock-data';
import { isDateInLocalYearMonth } from '@/lib/utils';

const DEMO_HEADERS = { 'X-Demo-Only': 'true', 'X-Persistence': 'none' };

const VALID_TX_TYPES = ['EXPENSE', 'INCOME', 'TRANSFER'] as const;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type');
  const month = searchParams.get('month');

  // Validate query params
  if (type && !VALID_TX_TYPES.includes(type as (typeof VALID_TX_TYPES)[number])) {
    return NextResponse.json(
      { success: false, error: 'Invalid type parameter' },
      { status: 400, headers: DEMO_HEADERS }
    );
  }
  if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return NextResponse.json(
      { success: false, error: 'Invalid month format (expected YYYY-MM)' },
      { status: 400, headers: DEMO_HEADERS }
    );
  }

  let list = [...INITIAL_TRANSACTIONS];
  if (type) list = list.filter((t) => t.type === type);
  if (month) list = list.filter((t) => isDateInLocalYearMonth(t.date, month));

  return NextResponse.json(
    { success: true, total: list.length, data: list, _demo: true },
    { headers: DEMO_HEADERS }
  );
}

export async function POST(req: Request) {
  // Reject oversized bodies
  const contentLength = req.headers.get('content-length');
  if (contentLength && parseInt(contentLength) > 50_000) {
    return NextResponse.json(
      { success: false, error: 'Payload too large' },
      { status: 413, headers: DEMO_HEADERS }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON body' },
      { status: 400, headers: DEMO_HEADERS }
    );
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return NextResponse.json(
      { success: false, error: 'Body must be a JSON object' },
      { status: 400, headers: DEMO_HEADERS }
    );
  }

  const b = body as Record<string, unknown>;

  // Explicit field validation — do NOT echo arbitrary input
  if (!b.type || !VALID_TX_TYPES.includes(b.type as (typeof VALID_TX_TYPES)[number])) {
    return NextResponse.json(
      { success: false, error: 'Field "type" must be EXPENSE, INCOME, or TRANSFER' },
      { status: 422, headers: DEMO_HEADERS }
    );
  }
  if (typeof b.amount !== 'number' || !Number.isFinite(b.amount) || b.amount <= 0) {
    return NextResponse.json(
      { success: false, error: 'Field "amount" must be a finite positive number' },
      { status: 422, headers: DEMO_HEADERS }
    );
  }
  if (typeof b.walletId !== 'string' || !b.walletId.trim()) {
    return NextResponse.json(
      { success: false, error: 'Field "walletId" is required' },
      { status: 422, headers: DEMO_HEADERS }
    );
  }

  // Return explicit allowlisted fields only — never reflect unknown input
  return NextResponse.json(
    {
      success: true,
      _demo: true,
      _note: 'This endpoint does not persist data. Use client-side AppContext.',
      data: {
        id: `tx-demo-${Date.now()}`,
        type: b.type,
        amount: b.amount,
        walletId: b.walletId,
        createdAt: new Date().toISOString(),
      },
    },
    { status: 201, headers: DEMO_HEADERS }
  );
}
