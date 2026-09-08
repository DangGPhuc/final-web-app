import { NextResponse } from 'next/server';
import { INITIAL_GOALS } from '@/lib/mock-data';

export async function GET() {
  return NextResponse.json({
    success: true,
    data: INITIAL_GOALS,
  });
}
