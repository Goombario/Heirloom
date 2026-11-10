import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { generateSpreadsheetTemplate } from '@/lib/spreadsheet/template';

// The file format stores a formula without its leading "=", and ExcelJS writes
// `{ formula }` as given, so an "=" there reached the file as `<f>=IF(…)</f>` (#1232).
describe('spreadsheet template preview formulas', () => {
    it('are written without a leading "="', async () => {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(await generateSpreadsheetTemplate() as unknown as ArrayBuffer);
        for (const name of ['Families', 'Children']) {
            const sheet = workbook.getWorksheet(name)!;
            const formulas: string[] = [];
            sheet.getRow(2).eachCell((cell) => {
                const formula = (cell.value as { formula?: string } | null)?.formula;
                if (formula) formulas.push(formula);
            });
            expect(formulas, name).toHaveLength(1);
            expect(formulas[0], name).toMatch(/^IF\(/);
        }
    });
});
