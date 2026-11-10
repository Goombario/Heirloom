import { NextResponse } from 'next/server';
import { ValidationError } from '@/lib/validation';
import { AccessError, FileTooLargeError, MediaTagConflictError, MediaUploadIntentConflictError, MembershipConflictError, NotFoundError, PrimaryMediaConflictError, StorageLimitError } from '@/lib/data/errors';

/**
 * Standard API route error → HTTP response mapping, shared so routes don't each
 * hand-roll the same ladder:
 *   - `FileTooLargeError`         → 413 with its `limitBytes`
 *   - `ValidationError`           → 400
 *   - `AccessError` (or a legacy `"Access denied"` message) → 403
 *   - `NotFoundError`             → 404
 *   - `MembershipConflictError`   → 409 with its `code`
 *   - `StorageLimitError`         → 507
 *   - anything else               → 500 (logged with `fallback` as the label)
 *
 * `fallback` is both the 500 body message and the console.error label.
 */
export function handleApiError(error: unknown, fallback = 'Internal server error'): NextResponse {
    if (error instanceof FileTooLargeError) {
        return NextResponse.json({
            error: error.message,
            code: error.code,
            ...(error.limitBytes === undefined ? {} : { limitBytes: error.limitBytes }),
        }, { status: 413 });
    }
    if (error instanceof ValidationError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof AccessError) {
        return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof NotFoundError) {
        return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof PrimaryMediaConflictError) {
        return NextResponse.json(
            { error: error.message, code: error.code, retryable: error.retryable },
            { status: 409 },
        );
    }
    if (error instanceof MediaTagConflictError) {
        return NextResponse.json(
            { error: error.message, code: error.code, retryable: error.retryable },
            { status: 409 },
        );
    }
    if (error instanceof MediaUploadIntentConflictError) {
        return NextResponse.json(
            { error: error.message, code: error.code, retryable: error.retryable },
            { status: 409 },
        );
    }
    if (error instanceof MembershipConflictError) {
        return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
    }
    if (error instanceof StorageLimitError) {
        return NextResponse.json({
            error: error.message,
            code: error.code,
            retryable: error.retryable,
            ...(error.usedBytes === undefined ? {} : { usedBytes: error.usedBytes }),
            ...(error.limitBytes === undefined ? {} : { limitBytes: error.limitBytes }),
            ...(error.remainingBytes === undefined ? {} : { remainingBytes: error.remainingBytes }),
        }, { status: 507 });
    }
    if (error instanceof Error && error.message.includes('Access denied')) {
        return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error(fallback, error);
    return NextResponse.json({ error: fallback }, { status: 500 });
}
