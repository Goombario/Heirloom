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

    it('hands the media zip to the browser as a link, without fetching it (#29)', async () => {
        vi.stubGlobal('fetch', vi.fn());

        const result = await new HttpGedcomClient().exportGedcom(
            { includeMedia: true, mediaPolicy: 'omit-unresolved' },
            7,
        );

        expect(result).toEqual({
            href: '/api/export/gedcom?includeMedia=true&mediaPolicy=omit-unresolved&treeId=7',
            filename: 'family_tree_export.zip',
        });
        expect(fetch).not.toHaveBeenCalled();
    });

    it('still fetches a bare GEDCOM as bytes', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('0 HEAD', { status: 200, headers: { 'content-type': 'text/plain' } })));

        const result = await new HttpGedcomClient().exportGedcom({}, 7);

        expect(result.filename).toBe('family_tree.ged');
        expect('blob' in result && await result.blob.text()).toBe('0 HEAD');
        expect(fetch).toHaveBeenCalledWith('/api/export/gedcom?treeId=7', { method: 'GET' });
    });
});
