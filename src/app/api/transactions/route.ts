import { NextResponse } from 'next/server';
import { INITIAL_TRANSACTIONS } from '@/lib/mock-data';
import { isDateInLocalYearMonth } from '@/lib/utils';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type');
  const month = searchParams.get('month');

  let list = [...INITIAL_TRANSACTIONS];
  if (type) list = list.filter((t) => t.type === type);
  if (month) list = list.filter((t) => isDateInLocalYearMonth(t.date, month));

  return NextResponse.json({
    success: true,
    total: list.length,
    data: list,
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    return NextResponse.json({
      success: true,
      data: {
        ...body,
        id: `tx-${Date.now()}`,
        createdAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: 'Invalid payload' }, { status: 400 });
  }
}
