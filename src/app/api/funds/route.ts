import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET() {
  try {
    const funds = await prisma.fund.findMany({
      where: { active: true },
      orderBy: { createdAt: 'asc' },
    });

    const formatted = funds.map(f => ({
      ...f,
      monthlyAllocation: Number(f.monthlyAllocation),
      createdAt: f.createdAt.toISOString(),
    }));

    return NextResponse.json(
      { success: true, funds: formatted },
      { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0', Pragma: 'no-cache' } }
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch funds',
      },
      {
        status: 500,
        headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0', Pragma: 'no-cache' },
      }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, monthlyAllocation } = body;

    const trimmedName = name?.trim();
    if (!trimmedName) {
      return NextResponse.json({ success: false, error: 'Tên quỹ không được để trống' }, { status: 400 });
    }

    const allocation = Number(monthlyAllocation);
    if (isNaN(allocation) || allocation < 0) {
      return NextResponse.json({ success: false, error: 'Hạn mức phân bổ không hợp lệ' }, { status: 400 });
    }

    const fund = await prisma.fund.create({
      data: {
        name: trimmedName,
        monthlyAllocation: BigInt(Math.round(allocation)),
        active: true,
      },
    });

    return NextResponse.json({
      success: true,
      fund: {
        ...fund,
        monthlyAllocation: Number(fund.monthlyAllocation),
        createdAt: fund.createdAt.toISOString(),
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create fund',
      },
      { status: 500 }
    );
  }
}
