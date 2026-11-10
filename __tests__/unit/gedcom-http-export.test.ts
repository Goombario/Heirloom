import { describe, expect, it, vi, beforeEach } from 'vitest';
import { HttpGedcomClient } from '@/lib/data/http/gedcom';

describe('HttpGedcomClient hosted export methods', () => {
    beforeEach(() => vi.restoreAllMocks());

    it('requests aggregate-only export preflight for the active tree', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
            canExport: true,
            omittedTotal: 0,
            byReason: {
                pending: 0,
                missing: 0,
                failed: 0,
                backing_missing: 0,
                legacy_materialization_unknown: 0,
            },
        }), { status: 200, headers: { 'content-type': 'application/json' } })));

        const result = await new HttpGedcomClient().preflightExport(7);

        expect(result.canExport).toBe(true);
        expect(fetch).toHaveBeenCalledWith('/api/export/gedcom?preflight=true&includeMedia=true&treeId=7');
    });

    it('downloads the hosted GEDCOM artifact with the explicit media policy', async () => {
        const blob = new Blob(['zip-bytes'], { type: 'application/zip' });
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(blob, { status: 200 })));

        const result = await new HttpGedcomClient().exportGedcom(
            { includeMedia: true, mediaPolicy: 'omit-unresolved' },
            7,
        );

        expect(result.filename).toBe('family_tree_export.zip');
        expect(await result.blob.text()).toBe('zip-bytes');
        expect(fetch).toHaveBeenCalledWith(
            '/api/export/gedcom?includeMedia=true&mediaPolicy=omit-unresolved&treeId=7',
            { method: 'GET' },
        );
    });
});
