import { describe, it, expect, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as UPLOAD_MEDIA } from '@/app/api/media/upload/route';
import { POST as CREATE_PERSON } from '@/app/api/people/route';
import { GET as LIST_MEDIA } from '@/app/api/media/route';
import { createRequest, parseResponse } from '../../setup/test-helpers';
import { cleanupTestData, hasTestDatabase } from '../../setup/db-helpers';

vi.mock('fs/promises', () => ({
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(Buffer.from('fake-image-data')),
    unlink: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    readdir: vi.fn().mockResolvedValue([]),
}));

vi.mock('sharp', () => {
    const mockSharp = vi.fn(() => ({
        rotate: vi.fn().mockReturnThis(),
        resize: vi.fn().mockReturnThis(),
        jpeg: vi.fn().mockReturnThis(),
        metadata: vi.fn().mockResolvedValue({ width: 1024, height: 1024 }),
        toBuffer: vi.fn().mockResolvedValue(Buffer.from('fake-compressed-jpeg')),
    }));
    return { default: mockSharp };
});

const describeIf = hasTestDatabase() ? describe : describe.skip;

/**
 * Per-person primary exclusivity **through the upload route** (#95 item 3).
 *
 * `media-primary.test.ts` covers exclusivity at the query layer and through
 * `PUT /api/media/[id]`. The upload path is separate wiring: it deliberately
 * writes `IsPrimary: 0` and then calls `setPrimaryForPerson`, precisely so the
 * "clear the previous primary first" step is not skipped. Nothing exercised
 * that call site, so regressing it to a bare `IsPrimary: 1` — leaving a person
 * with two primary photos — would have failed no test.
 */
describeIf('POST /api/media/upload — per-person primary exclusivity', () => {
    afterEach(async () => { await cleanupTestData(); });

    async function person(firstName: string): Promise<number> {
        const res = await CREATE_PERSON(createRequest('http://localhost:3000/api/people', {
            method: 'POST', body: { FirstName: firstName, LastName: 'Upload' },
        }));
        return (await parseResponse<{ person: { Id: number } }>(res)).person.Id;
    }

    async function upload(fields: Record<string, string>): Promise<number> {
        const formData = new FormData();
        formData.append('file', new File([Buffer.from('fake-image-data') as BlobPart], 'portrait.jpg', { type: 'image/jpeg' }));
        for (const [k, v] of Object.entries(fields)) formData.append(k, v);
        const res = await UPLOAD_MEDIA(new NextRequest('http://localhost:3000/api/media/upload', {
            method: 'POST', body: formData,
        }));
        expect(res.status).toBeLessThan(300);
        return (await parseResponse<{ media: { Id: number } }>(res)).media.Id;
    }

    /** Ids of every photo the gallery currently reports as this person's primary. */
    async function primaries(personId: number): Promise<number[]> {
        const res = await LIST_MEDIA(createRequest(`http://localhost:3000/api/media?personId=${personId}&includeTagged=true`));
        const { media } = await parseResponse<{ media: { Id: number; IsPersonPrimary: boolean }[] }>(res);
        return media.filter(m => m.IsPersonPrimary).map(m => m.Id);
    }

    it('uploading a second primary for a person demotes the first', async () => {
        const ada = await person('Ada');

        const first = await upload({ personId: String(ada), isPrimary: 'true' });
        expect(await primaries(ada)).toEqual([first]);

        const second = await upload({ personId: String(ada), isPrimary: 'true' });

        const after = await primaries(ada);
        expect(after).toEqual([second]);
        expect(after).not.toContain(first);
        expect(after).toHaveLength(1);
    });

    it('an upload without isPrimary does not disturb the existing primary', async () => {
        const grace = await person('Grace');

        const chosen = await upload({ personId: String(grace), isPrimary: 'true' });
        await upload({ personId: String(grace) });

        expect(await primaries(grace)).toEqual([chosen]);
    });

    it('keeps one person primary independent of another person upload', async () => {
        const ada = await person('Ada');
        const grace = await person('Grace');

        const adaPhoto = await upload({ personId: String(ada), isPrimary: 'true' });
        const gracePhoto = await upload({ personId: String(grace), isPrimary: 'true' });

        expect(await primaries(ada)).toEqual([adaPhoto]);
        expect(await primaries(grace)).toEqual([gracePhoto]);
    });
});
