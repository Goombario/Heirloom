// Pin a zone west of UTC before any Date is built: ExcelJS hands date cells
// over at UTC midnight, and local getters would read them a day early (#877).
process.env.TZ = 'America/Toronto';

import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { parseSpreadsheet } from '@/lib/spreadsheet/parser';

async function workbookWithRow(cells: ExcelJS.CellValue[]): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('People');
    sheet.addRow(['RowID', 'FirstName', 'LastName', 'BirthDate', 'Notes']);
    sheet.addRow(cells);
    return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

describe('spreadsheet cell values (#877)', () => {
    it('runs west of UTC', () => {
        expect(new Date(Date.UTC(1950, 0, 1)).getDate()).toBe(31);
    });

    it('reads a date cell as the calendar day Excel shows', async () => {
        const buf = await workbookWithRow([1, 'Ann', 'Lee', new Date(Date.UTC(1950, 0, 1))]);
        const { people } = await parseSpreadsheet(buf);
        expect(people[0].BirthDate).toBe('1950-01-01');
    });

    it('reads a formula cell as its result', async () => {
        const buf = await workbookWithRow([
            { formula: '1+0', result: 1 },
            { formula: 'PROPER("ann")', result: 'Ann' },
            'Lee',
            { formula: 'DATE(1950,1,1)', result: new Date(Date.UTC(1950, 0, 1)) },
        ]);
        const { people } = await parseSpreadsheet(buf);
        expect(people).toHaveLength(1);
        expect(people[0]).toMatchObject({ rowId: 1, FirstName: 'Ann', BirthDate: '1950-01-01' });
    });

    it('reads a hyperlink cell as its text', async () => {
        const buf = await workbookWithRow([1, { text: 'Ann', hyperlink: 'https://example.org/ann' }, 'Lee']);
        const { people } = await parseSpreadsheet(buf);
        expect(people[0].FirstName).toBe('Ann');
    });

    it('reports an error cell instead of importing it', async () => {
        const buf = await workbookWithRow([1, 'Ann', 'Lee', null, { error: '#N/A' }]);
        await expect(parseSpreadsheet(buf)).rejects.toThrow(/People cell E2: the cell shows the Excel error #N\/A/);
    });

    it('reports an error formula result', async () => {
        const buf = await workbookWithRow([1, { formula: 'VLOOKUP(1,A:A,9)', result: { error: '#REF!' } }, 'Lee']);
        await expect(parseSpreadsheet(buf)).rejects.toThrow(/People cell B2: the cell shows the Excel error #REF!/);
    });

    it('refuses a repeated header instead of reading its last column (#867)', async () => {
        const wb = new ExcelJS.Workbook();
        const sheet = wb.addWorksheet('People');
        sheet.addRow(['RowID', 'FirstName', 'LastName', 'FirstName']);
        sheet.addRow([1, 'Ann', 'Lee', 'Oops']);
        const buf = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
        await expect(parseSpreadsheet(buf)).rejects.toThrow(/People sheet: the column "FirstName" appears more than once/);
    });
});
