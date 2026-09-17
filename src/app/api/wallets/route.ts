/**
 * POST /api/wallets — DEMO ONLY
 *
 * This is a read-only mock endpoint. The POST handler does NOT persist data.
 * All state management is handled client-side via AppContext + localStorage.
 */
import { NextResponse } from 'next/server';
import { INITIAL_WALLETS } from '@/lib/mock-data';

const DEMO_HEADERS = { 'X-Demo-Only': 'true', 'X-Persistence': 'none' };
const VALID_WALLET_TYPES = ['CASH', 'BANK', 'CREDIT', 'SAVINGS'] as const;

export async function GET() {
  return NextResponse.json(
    { success: true, data: INITIAL_WALLETS, _demo: true },
    { headers: DEMO_HEADERS }
  );
}

export async function POST(req: Request) {
  const contentLength = req.headers.get('content-length');
  if (contentLength && parseInt(contentLength) > 10_000) {
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

  if (typeof b.name !== 'string' || !b.name.trim() || b.name.length > 100) {
    return NextResponse.json(
      { success: false, error: 'Field "name" is required (max 100 chars)' },
      { status: 422, headers: DEMO_HEADERS }
    );
  }
  if (!b.type || !VALID_WALLET_TYPES.includes(b.type as (typeof VALID_WALLET_TYPES)[number])) {
    return NextResponse.json(
      { success: false, error: 'Field "type" must be CASH, BANK, CREDIT, or SAVINGS' },
      { status: 422, headers: DEMO_HEADERS }
    );
  }
  if (typeof b.balance !== 'number' || !Number.isFinite(b.balance) || b.balance < 0) {
    return NextResponse.json(
      { success: false, error: 'Field "balance" must be a finite non-negative number' },
      { status: 422, headers: DEMO_HEADERS }
    );
  }

  return NextResponse.json(
    {
      success: true,
      _demo: true,
      _note: 'This endpoint does not persist data. Use client-side AppContext.',
      data: {
        id: `wal-demo-${Date.now()}`,
        name: b.name,
        type: b.type,
        balance: b.balance,
        createdAt: new Date().toISOString(),
      },
    },
    { status: 201, headers: DEMO_HEADERS }
  );
}
