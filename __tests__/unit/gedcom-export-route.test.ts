import { Readable } from 'stream';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { getUserFromRequest, exportGedcomService } = vi.hoisted(() => ({
    getUserFromRequest: vi.fn(),
    exportGedcomService: vi.fn(),
}));

vi.mock('@/lib/auth/get-user-from-request', () => ({ getUserFromRequest }));
vi.mock('@/lib/services/gedcom-export', () => ({ exportGedcomService }));
vi.mock('@/lib/rate-limit', () => ({
    rateLimit: vi.fn(() => ({ success: true, remaining: 99 })),
}));

import { GET } from '@/app/api/export/gedcom/route';

const preflight = {
    canExport: false,
    omittedTotal: 1,
    byReason: {
        pending: 0,
        missing: 0,
        failed: 0,
        backing_missing: 1,
        legacy_materialization_unknown: 0,
    },
};

describe('GET /api/export/gedcom hosted media preflight', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getUserFromRequest.mockResolvedValue({ id: 42 });
    });

    it('returns aggregate-only preflight JSON without downloading an artifact', async () => {
        exportGedcomService.mockResolvedValue({ kind: 'preflight', preflight });

        const response = await GET(new NextRequest(
            'http://localhost/api/export/gedcom?treeId=7&preflight=true&includeMedia=true',
        ));

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual(preflight);
        expect(exportGedcomService).toHaveBeenCalledWith({
            requestedTreeId: 7,
            requestedOwnerId: null,
            currentUserId: 42,
            includeMedia: true,
            preflightOnly: true,
            mediaPolicy: undefined,
        });
    });

    it('returns 409 when media omissions are present and no exact override is supplied', async () => {
        exportGedcomService.mockResolvedValue({ kind: 'blocked', preflight });

        const response = await GET(new NextRequest(
            'http://localhost/api/export/gedcom?includeMedia=true',
        ));

        expect(response.status).toBe(409);
        expect(await response.json()).toEqual({
            error: 'Media export blocked because unresolved media would be omitted',
            preflight,
        });
    });

    it('accepts only mediaPolicy=omit-unresolved for an explicit omission export', async () => {
        exportGedcomService.mockResolvedValue({
            kind: 'zip',
            stream: Readable.from([Buffer.from('zip')]),
            preflight,
        });

        const response = await GET(new NextRequest(
            'http://localhost/api/export/gedcom?includeMedia=true&mediaPolicy=omit-unresolved',
        ));

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain('application/zip');
        expect(Buffer.from(await response.arrayBuffer()).toString()).toBe('zip');
        expect(exportGedcomService).toHaveBeenCalledWith(expect.objectContaining({
            includeMedia: true,
            mediaPolicy: 'omit-unresolved',
            preflightOnly: false,
        }));
    });

    it('streams the zip and fails the download when the stream breaks part-way (#29)', async () => {
        const stream = new Readable({ read() {} });
        stream.push(Buffer.from('PK partial'));
        exportGedcomService.mockResolvedValue({ kind: 'zip', stream, preflight });

        const response = await GET(new NextRequest('http://localhost/api/export/gedcom?includeMedia=true'));
        expect(response.status).toBe(200);
        setTimeout(() => stream.destroy(new Error('ENOENT: photo gone')), 0);
        await expect(response.arrayBuffer()).rejects.toThrow();
    });

    it('does not treat a near-miss policy token as an override', async () => {
        exportGedcomService.mockResolvedValue({ kind: 'blocked', preflight });

        const response = await GET(new NextRequest(
            'http://localhost/api/export/gedcom?includeMedia=true&mediaPolicy=omit_unresolved',
        ));

        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({ preflight });
        expect(exportGedcomService).toHaveBeenCalledWith(expect.objectContaining({
            mediaPolicy: 'omit_unresolved',
        }));
    });
});
