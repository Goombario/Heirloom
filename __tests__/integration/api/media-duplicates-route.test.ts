import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/media/duplicates/route';
import { parseResponse } from '../../setup/test-helpers';
import { hasTestDatabase } from '../../setup/db-helpers';
import { MAX_DUPLICATE_HASHES } from '@/lib/services/media-duplicates';

const describeIf = hasTestDatabase() ? describe : describe.skip;
const VALID = 'a'.repeat(64);

function post(body: unknown) {
    return POST(new NextRequest('http://localhost:3000/api/media/duplicates', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
    }));
}

describeIf('POST /api/media/duplicates', () => {
    it('rejects a non-array hashes field', async () => {
        expect((await post({ hashes: 'nope' })).status).toBe(400);
    });

    it('rejects a missing hashes field', async () => {
        expect((await post({})).status).toBe(400);
    });

    it('rejects a malformed hash', async () => {
        expect((await post({ hashes: ['not-a-hash'] })).status).toBe(400);
    });

    // The pattern is lowercase hex on purpose: hashBytes only ever emits
    // lowercase, so accepting uppercase would let two spellings of one hash
    // reach the query and silently miss each other.
    it('rejects an uppercase hash', async () => {
        expect((await post({ hashes: ['A'.repeat(64)] })).status).toBe(400);
    });

    it('rejects a hash of the wrong length', async () => {
        expect((await post({ hashes: ['a'.repeat(63)] })).status).toBe(400);
    });

    it('rejects a non-string entry', async () => {
        expect((await post({ hashes: [12345] })).status).toBe(400);
    });

    it(`rejects more than ${MAX_DUPLICATE_HASHES} hashes`, async () => {
        const tooMany = Array.from({ length: MAX_DUPLICATE_HASHES + 1 }, () => VALID);
        expect((await post({ hashes: tooMany })).status).toBe(400);
    });

    it(`accepts exactly ${MAX_DUPLICATE_HASHES} hashes`, async () => {
        const atLimit = Array.from({ length: MAX_DUPLICATE_HASHES }, () => VALID);
        expect((await post({ hashes: atLimit })).status).toBe(200);
    });

    it('returns an empty match list for an empty array', async () => {
        const res = await post({ hashes: [] });
        expect(res.status).toBe(200);
        const data = await parseResponse<{ matches: unknown[] }>(res);
        expect(data.matches).toEqual([]);
    });

    it('wraps results as { matches }', async () => {
        const res = await post({ hashes: [VALID] });
        expect(res.status).toBe(200);
        const data = await parseResponse<{ matches: unknown[] }>(res);
        expect(Array.isArray(data.matches)).toBe(true);
    });

    it('treats a non-JSON body as a validation error, not a crash', async () => {
        const res = await POST(new NextRequest('http://localhost:3000/api/media/duplicates', {
            method: 'POST',
            body: 'not json at all',
            headers: { 'Content-Type': 'application/json' },
        }));
        expect(res.status).toBe(400);
    });
});
