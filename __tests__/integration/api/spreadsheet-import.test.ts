import { describe, it, expect, afterEach, vi } from 'vitest';

// Bypass in-memory rate limiter — 5-per-15-min would otherwise exhaust mid-suite.
vi.mock('@/lib/rate-limit', () => ({
    rateLimit: vi.fn(() => ({ success: true, remaining: 99, retryAfterMs: 0 })),
}));

import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { MAX_SPREADSHEET_INFLATED_BYTES } from '@/lib/import-limits';
import { NextRequest } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { POST as IMPORT_SPREADSHEET } from '@/app/api/import/spreadsheet/route';
import { parseResponse, TEST_USER } from '../../setup/test-helpers';
import { cleanupTestData, hasTestDatabase } from '../../setup/db-helpers';
import { query } from '@/lib/db/connection';
import { rateLimit } from '@/lib/rate-limit';

const describeIf = hasTestDatabase() ? describe : describe.skip;

interface PreviewResponse {
    dryRun: boolean;
    toImport?: { peopleCount: number; familiesCount: number; childrenCount: number };
    skipped?: { type: string; identifier: string; reason: string }[];
    peopleImported?: number;
    familiesImported?: number;
    childrenLinked?: number;
}

/**
 * Build a minimal valid workbook in-memory and return its buffer.
 * Sheets follow the template the route's parser expects.
 */
async function buildWorkbook(options: {
    people?: { rowId: number; FirstName: string; LastName: string; BirthDate?: string }[];
    families?: { familyId: number; HusbandRowID?: number | null; WifeRowID?: number | null; MarriageDate?: string }[];
    children?: { FamilyID: number; ChildRowID: number }[];
} = {}): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const peopleSheet = wb.addWorksheet('People');
    peopleSheet.addRow(['RowID', 'FirstName', 'LastName', 'Sex', 'BirthDate', 'BirthPlace', 'DeathDate', 'DeathPlace', 'IsDeceased', 'Notes']);
    for (const p of options.people ?? []) {
        peopleSheet.addRow([p.rowId, p.FirstName, p.LastName, '', p.BirthDate ?? '', '', '', '', '', '']);
    }

    if (options.families) {
        const familiesSheet = wb.addWorksheet('Families');
        familiesSheet.addRow(['FamilyID', 'HusbandRowID', 'WifeRowID', 'MarriageDate', 'MarriagePlace']);
        for (const f of options.families) {
            familiesSheet.addRow([f.familyId, f.HusbandRowID ?? '', f.WifeRowID ?? '', f.MarriageDate ?? '', '']);
        }
    }

    if (options.children) {
        const childrenSheet = wb.addWorksheet('Children');
        childrenSheet.addRow(['FamilyID', 'ChildRowID']);
        for (const c of options.children) {
            childrenSheet.addRow([c.FamilyID, c.ChildRowID]);
        }
    }

    const ab = await wb.xlsx.writeBuffer();
    return Buffer.from(ab as ArrayBuffer);
}

function multipartRequest(url: string, file: File): NextRequest {
    const fd = new FormData();
    fd.set('file', file);
    return new NextRequest(new URL(url, 'http://localhost:3000'), { method: 'POST', body: fd });
}

describeIf('API /api/import/spreadsheet', () => {
    afterEach(async () => {
        await cleanupTestData();
    });

    it('returns 401 without a user', async () => {
        vi.mocked(getUserFromRequest).mockResolvedValueOnce(null);
        const buf = await buildWorkbook({ people: [{ rowId: 1, FirstName: 'A', LastName: 'B' }] });
        const file = new File([new Uint8Array(buf)], 'test.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const res = await IMPORT_SPREADSHEET(multipartRequest('http://localhost:3000/api/import/spreadsheet', file));
        expect(res.status).toBe(401);
    });

    it('rejects non-xlsx extension with 400', async () => {
        const file = new File(['hello'], 'data.csv', { type: 'text/csv' });
        const res = await IMPORT_SPREADSHEET(multipartRequest('http://localhost:3000/api/import/spreadsheet', file));
        expect(res.status).toBe(400);
    });

    it('rejects file size > 10 MB with 400', async () => {
        // Construct a fake xlsx-named file just over the 10 MB cap.
        const big = Buffer.alloc(11 * 1024 * 1024);
        const file = new File([big], 'big.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const res = await IMPORT_SPREADSHEET(multipartRequest('http://localhost:3000/api/import/spreadsheet', file));
        expect(res.status).toBe(400);
    });

    it('rejects an .xlsx that inflates past the cap with 400 (#1222)', async () => {
        // A small upload that unpacks to more than the cap: a zip bomb.
        const zip = new JSZip();
        zip.file('xl/sharedStrings.xml', new Uint8Array(MAX_SPREADSHEET_INFLATED_BYTES + 1));
        // Level 1 halves JSZip's (pure JS) deflate of the 128 MB entry.
        const bomb = await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE', compressionOptions: { level: 1 } });
        expect(bomb.byteLength).toBeLessThan(10 * 1024 * 1024);
        const file = new File([bomb], 'bomb.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const res = await IMPORT_SPREADSHEET(multipartRequest('http://localhost:3000/api/import/spreadsheet', file));
        expect(res.status).toBe(400);
        const body = await parseResponse<{ error: string }>(res);
        expect(body.error).toMatch(/too large once unpacked/);
        // Building and then inflating 128 MB takes ~3 s alone, but past the 10 s default on a
        // CI runner busy with the other PGlite suites.
    }, 60_000);

    it('returns 400 when the workbook is missing the People sheet', async () => {
        const wb = new ExcelJS.Workbook();
        wb.addWorksheet('Wrong');
        const ab = await wb.xlsx.writeBuffer();
        const file = new File([Buffer.from(ab as ArrayBuffer)], 'test.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const res = await IMPORT_SPREADSHEET(multipartRequest('http://localhost:3000/api/import/spreadsheet', file));
        expect(res.status).toBe(400);
    });

    it('happy-path dry-run returns counts without writing', async () => {
        const buf = await buildWorkbook({
            people: [
                { rowId: 1, FirstName: 'Alice', LastName: 'A', BirthDate: '1900' },
                { rowId: 2, FirstName: 'Bob', LastName: 'B', BirthDate: '1901' },
            ],
        });
        const file = new File([new Uint8Array(buf)], 'test.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const res = await IMPORT_SPREADSHEET(multipartRequest('http://localhost:3000/api/import/spreadsheet', file));
        expect(res.status).toBe(200);
        const data = await parseResponse<PreviewResponse>(res);
        expect(data.dryRun).toBe(true);
        expect(data.toImport?.peopleCount).toBe(2);

        const dbRows = await query('SELECT COUNT(*)::int AS n FROM "People" WHERE "UserId" = $1', [TEST_USER.id]);
        expect((dbRows.rows[0] as { n: number }).n).toBe(0);
    });

    it('confirm=true commits people to the DB', async () => {
        const buf = await buildWorkbook({
            people: [
                { rowId: 1, FirstName: 'Alice', LastName: 'A' },
                { rowId: 2, FirstName: 'Bob', LastName: 'B' },
            ],
        });
        const file = new File([new Uint8Array(buf)], 'test.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const res = await IMPORT_SPREADSHEET(multipartRequest('http://localhost:3000/api/import/spreadsheet?confirm=true', file));
        expect(res.status).toBe(200);
        const data = await parseResponse<PreviewResponse>(res);
        expect(data.dryRun).toBe(false);
        expect(data.peopleImported).toBe(2);

        const dbRows = await query('SELECT COUNT(*)::int AS n FROM "People" WHERE "UserId" = $1', [TEST_USER.id]);
        expect((dbRows.rows[0] as { n: number }).n).toBe(2);
    });

    it('duplicate detection skips re-imports of the same person', async () => {
        const wb = { people: [{ rowId: 1, FirstName: 'Dupe', LastName: 'X', BirthDate: '1900-01-01' }] };
        const file1 = new File([new Uint8Array(await buildWorkbook(wb))], 'test.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const firstRes = await IMPORT_SPREADSHEET(multipartRequest('http://localhost:3000/api/import/spreadsheet?confirm=true', file1));
        expect(firstRes.status).toBe(200);
        const firstData = await parseResponse<PreviewResponse>(firstRes);
        expect(firstData.peopleImported).toBe(1);

        const file2 = new File([new Uint8Array(await buildWorkbook(wb))], 'test.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const res = await IMPORT_SPREADSHEET(multipartRequest('http://localhost:3000/api/import/spreadsheet', file2));
        expect(res.status).toBe(200);
        const data = await parseResponse<PreviewResponse>(res);
        // Either the row is in `skipped`, or `toImport.peopleCount` is 0.
        const wasSkipped = data.skipped?.some(s => s.type === 'person') ?? false;
        const wasFilteredOut = (data.toImport?.peopleCount ?? -1) === 0;
        expect(wasSkipped || wasFilteredOut).toBe(true);
    });

    it('Preview and import use separate limits, and a 429 says when to retry (#1231)', async () => {
        const buf = await buildWorkbook({ people: [{ rowId: 1, FirstName: 'A', LastName: 'B' }] });
        const file = () => new File([new Uint8Array(buf)], 'test.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

        vi.mocked(rateLimit).mockClear();
        await IMPORT_SPREADSHEET(multipartRequest('http://localhost:3000/api/import/spreadsheet', file()));
        expect(vi.mocked(rateLimit).mock.calls[0]).toEqual([`${TEST_USER.id}:spreadsheet-preview`, 30, 15 * 60 * 1000]);

        vi.mocked(rateLimit).mockReturnValueOnce({ success: false, remaining: 0, retryAfterMs: 125_000 });
        const res = await IMPORT_SPREADSHEET(multipartRequest('http://localhost:3000/api/import/spreadsheet?confirm=true', file()));
        expect(vi.mocked(rateLimit).mock.calls[1]).toEqual([`${TEST_USER.id}:spreadsheet-import`, 5, 15 * 60 * 1000]);
        expect(res.status).toBe(429);
        expect(res.headers.get('Retry-After')).toBe('125');
        expect(await res.json()).toMatchObject({ retryAfterSeconds: 125 });
    });
});
