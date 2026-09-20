import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { categoryId, fundId, classificationState } = body;

    const updated = await prisma.bankTransaction.update({
      where: { id },
      data: {
        ...(categoryId !== undefined ? { categoryId: categoryId || null } : {}),
        ...(fundId !== undefined ? { fundId: fundId || null } : {}),
        classificationState: classificationState || 'CLASSIFIED',
      },
      include: {
        category: true,
        fund: true,
      },
    });

    return NextResponse.json({
      success: true,
      transaction: {
        ...updated,
        occurredAt: updated.occurredAt.toISOString(),
        importedAt: updated.importedAt.toISOString(),
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update transaction',
      },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await prisma.bankTransaction.delete({
      where: { id },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete transaction',
      },
      { status: 500 }
    );
  }
}
