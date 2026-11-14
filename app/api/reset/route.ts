import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { rateLimit } from '@/lib/rate-limit';
import { resetService } from '@/lib/services/gedcom';
import { handleApiError } from '@/lib/api/handle-error';

export async function DELETE(request: NextRequest) {
    try {
        const user = await getUserFromRequest();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Rate limit: 2 resets per hour
        const { success } = rateLimit(`${user.id}:reset`, 2, 60 * 60 * 1000);
        if (!success) {
            return NextResponse.json({ error: 'Too many reset requests. Please try again later.' }, { status: 429 });
        }

        const confirmHeader = request.headers.get('X-Confirm-Reset');
        if (confirmHeader !== 'CONFIRM_DELETE_ALL_DATA') {
            return NextResponse.json(
                { error: 'Missing or invalid X-Confirm-Reset header. Send X-Confirm-Reset: CONFIRM_DELETE_ALL_DATA to confirm.' },
                { status: 400 }
            );
        }

        const result = await resetService({ currentUserId: user.id });
        return NextResponse.json(result);
    } catch (error) {
        // A JSON 500 with an error id, not Next's bare one (#51, L-9).
        return handleApiError(error, 'Failed to erase data');
    }
}
