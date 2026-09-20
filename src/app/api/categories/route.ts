import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET() {
  try {
    const categories = await prisma.category.findMany({
      orderBy: { name: 'asc' },
    });

    const formatted = categories.map(c => ({
      ...c,
      createdAt: c.createdAt.toISOString(),
    }));

    return NextResponse.json({ success: true, categories: formatted });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch categories',
      },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, direction } = body;

    const trimmedName = name?.trim();
    if (!trimmedName) {
      return NextResponse.json({ success: false, error: 'Category name is required' }, { status: 400 });
    }

    // Upsert so case-insensitive or exact matching doesn't error
    let category = await prisma.category.findFirst({
      where: { name: { equals: trimmedName, mode: 'insensitive' } },
    });

    if (!category) {
      category = await prisma.category.create({
        data: {
          name: trimmedName,
          direction: direction || 'BOTH',
        },
      });
    }

    return NextResponse.json({
      success: true,
      category: {
        ...category,
        createdAt: category.createdAt.toISOString(),
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create category',
      },
      { status: 500 }
    );
  }
}
