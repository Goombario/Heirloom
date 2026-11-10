import { NextResponse } from 'next/server';
import { isDesktopMode } from '@/lib/auth/get-user-from-request';

export async function GET() {
  return NextResponse.json({
    isDesktop: isDesktopMode(),
  });
}
