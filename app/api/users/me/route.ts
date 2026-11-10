import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';

/**
 * GET /api/users/me - Get current authenticated user
 */
export async function GET() {
  try {
    const user = await getUserFromRequest();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    return NextResponse.json({ user });
  } catch (error) {
    console.error('Get current user error:', error);
    return NextResponse.json(
      { error: 'Failed to get user' },
      { status: 500 }
    );
  }
}
