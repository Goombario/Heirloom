import { describe, it, expect, vi } from 'vitest';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';

// Small caps so the tests don't build huge files (#1222).
vi.mock('@/lib/import-limits', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/import-limits')>()),
    MAX_SPREADSHEET_ROWS: 5,
}));

import { parseSpreadsheet } from '@/lib/spreadsheet/parser';
import { zipInflatesWithin } from '@/lib/zip-capped';

async function workbookWithPeople(count: number): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('People');
    sheet.addRow(['RowID', 'FirstName', 'LastName']);
    for (let i = 1; i <= count; i++) sheet.addRow([i, `P${i}`, 'Lee']);
    return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

describe('spreadsheet row cap (#1222, audit L-8)', () => {
    it('accepts a sheet at the cap', async () => {
        const { people } = await parseSpreadsheet(await workbookWithPeople(4));
        expect(people).toHaveLength(4);
    });

    it('refuses a sheet over the cap', async () => {
        await expect(parseSpreadsheet(await workbookWithPeople(5))).rejects.toThrow(/"People" sheet has 6 rows/);
    });

    it('refuses a file that is not a workbook', async () => {
        await expect(parseSpreadsheet(Buffer.from('not a zip'))).rejects.toThrow(/not a valid \.xlsx/);
    });
});

describe('zipInflatesWithin', () => {
    async function zipOf(sizes: number[]): Promise<JSZip> {
        const zip = new JSZip();
        sizes.forEach((size, i) => zip.file(`f${i}.bin`, new Uint8Array(size)));
        return JSZip.loadAsync(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }));
    }

    it('counts every entry against one total', async () => {
        expect(await zipInflatesWithin(await zipOf([600, 400]), 1000)).toBe(true);
        expect(await zipInflatesWithin(await zipOf([600, 401]), 1000)).toBe(false);
    });

    it('stops on a single entry over the cap', async () => {
        expect(await zipInflatesWithin(await zipOf([5000]), 1000)).toBe(false);
    });
});
