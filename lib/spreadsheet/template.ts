import ExcelJS from 'exceljs';

const PEOPLE_COLUMNS = [
    { header: 'RowID', key: 'RowID', width: 10 },
    { header: 'FirstName', key: 'FirstName', width: 18 },
    { header: 'LastName', key: 'LastName', width: 18 },
    { header: 'Sex', key: 'Sex', width: 12 },
    { header: 'BirthDate', key: 'BirthDate', width: 16 },
    { header: 'BirthPlace', key: 'BirthPlace', width: 24 },
    { header: 'DeathDate', key: 'DeathDate', width: 16 },
    { header: 'DeathPlace', key: 'DeathPlace', width: 24 },
    { header: 'IsDeceased', key: 'IsDeceased', width: 14 },
    { header: 'Notes', key: 'Notes', width: 40 },
];

const FAMILIES_COLUMNS = [
    { header: 'FamilyID', key: 'FamilyID', width: 12 },
    { header: 'HusbandRowID', key: 'HusbandRowID', width: 16 },
    { header: 'WifeRowID', key: 'WifeRowID', width: 14 },
    { header: 'MarriageDate', key: 'MarriageDate', width: 16 },
    { header: 'MarriagePlace', key: 'MarriagePlace', width: 24 },
    { header: '🔒 Preview (auto)', key: 'Preview', width: 40 },
];

const CHILDREN_COLUMNS = [
    { header: 'FamilyID', key: 'FamilyID', width: 12 },
    { header: 'ChildRowID', key: 'ChildRowID', width: 14 },
    { header: '🔒 Preview (auto)', key: 'Preview', width: 54 },
];

const EXAMPLE_LABEL = 'EXAMPLE — delete before importing';

// Rows 2–501: covers 500 data entries, enough for any typical import
const PREVIEW_ROW_START = 2;
const PREVIEW_ROW_END = 501;

// ── Formula generators ────────────────────────────────────────────────────────

/**
 * Builds a name string from People sheet: "FirstName LastName" for a given RowID cell.
 * Falls back to "[#<id>]" when the RowID is not found.
 */
function peopleName(idCell: string): string {
    return (
        `IFERROR(` +
        `INDEX(People!$B:$B,MATCH(${idCell},People!$A:$A,0))` +
        `&" "&` +
        `INDEX(People!$C:$C,MATCH(${idCell},People!$A:$A,0))` +
        `,"[#"&${idCell}&"]")`
    );
}

/**
 * Families sheet column F: "Husband Name & Wife Name"
 * B = HusbandRowID, C = WifeRowID
 */
function familiesPreviewFormula(row: number): string {
    const b = `B${row}`, c = `C${row}`;
    return (
        `IF(AND(ISBLANK(${b}),ISBLANK(${c})),"",` +
        `IFERROR(TRIM(` +
        `IF(${b}<>"",${peopleName(b)},"")` +
        `&IF(AND(${b}<>"",${c}<>"")," & ","")` +
        `&IF(${c}<>"",${peopleName(c)},"")` +
        `),""))`
    );
}

/**
 * Children sheet column C: "Child Name — child of Husband Name & Wife Name"
 * A = FamilyID, B = ChildRowID
 */
function childrenPreviewFormula(row: number): string {
    const a = `A${row}`, b = `B${row}`;

    // Look up a parent's name by chaining through the Families sheet
    const parentName = (famCol: 'B' | 'C'): string => {
        const rowId = `INDEX(Families!$${famCol}:$${famCol},MATCH(${a},Families!$A:$A,0))`;
        return (
            `IFERROR(` +
            `INDEX(People!$B:$B,MATCH(${rowId},People!$A:$A,0))` +
            `&" "&` +
            `INDEX(People!$C:$C,MATCH(${rowId},People!$A:$A,0))` +
            `,"")`
        );
    };

    // True when both spouse slots in the family are filled
    const hasBothParents =
        `AND(` +
        `ISNUMBER(INDEX(Families!$B:$B,MATCH(${a},Families!$A:$A,0))),` +
        `ISNUMBER(INDEX(Families!$C:$C,MATCH(${a},Families!$A:$A,0))))`;

    return (
        `IF(AND(ISBLANK(${a}),ISBLANK(${b})),"",` +
        `IFERROR(` +
        `IF(${b}<>"",${peopleName(b)},"")` +
        `&IF(${a}<>"",` +
        `IFERROR(` +
        `" — child of "&TRIM(` +
        `${parentName('B')}` +
        `&IF(${hasBothParents}," & ","")` +
        `&${parentName('C')}` +
        `)` +
        `," — [family #"&${a}&" not found]")` +
        `,"")` +
        `,""))`
    );
}

// ── Template generator ────────────────────────────────────────────────────────

export async function generateSpreadsheetTemplate(slashOrder: 'MDY' | 'DMY' = 'MDY'): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Heirloom';
    workbook.created = new Date();

    // ── People sheet ──────────────────────────────────────────────────────────
    const people = workbook.addWorksheet('People');
    people.columns = PEOPLE_COLUMNS;
    styleHeaderRow(people.getRow(1));
    people.views = [{ state: 'frozen', ySplit: 1 }];

    // Data validation dropdowns
    const sexCol = people.getColumn('Sex').letter;
    const deceasedCol = people.getColumn('IsDeceased').letter;
    addDropdownValidation(people, `${sexCol}2:${sexCol}1001`, '"M,F,Unknown"', 'Please select M, F, or Unknown.');
    addDropdownValidation(people, `${deceasedCol}2:${deceasedCol}1001`, '"Yes,No,Unknown"', 'Please select Yes, No, or Unknown.');

    addExampleRow(people, {
        RowID: 1, FirstName: 'John', LastName: 'Smith', Sex: 'M',
        BirthDate: '1950-03-12', BirthPlace: 'Boston, MA',
        DeathDate: '', DeathPlace: '', IsDeceased: 'No', Notes: EXAMPLE_LABEL,
    });
    addExampleRow(people, {
        RowID: 2, FirstName: 'Jane', LastName: 'Doe', Sex: 'F',
        BirthDate: '1952-07-04', BirthPlace: 'New York, NY',
        DeathDate: '', DeathPlace: '', IsDeceased: 'No', Notes: EXAMPLE_LABEL,
    });
    addExampleRow(people, {
        RowID: 3, FirstName: 'Billy', LastName: 'Smith', Sex: 'M',
        BirthDate: '1975-01-15', BirthPlace: 'Boston, MA',
        DeathDate: '', DeathPlace: '', IsDeceased: 'No', Notes: EXAMPLE_LABEL,
    });
    addExampleRow(people, {
        RowID: 4, FirstName: 'Sarah', LastName: 'Smith', Sex: 'F',
        BirthDate: '1978-09-22', BirthPlace: 'Boston, MA',
        DeathDate: '', DeathPlace: '', IsDeceased: 'No', Notes: EXAMPLE_LABEL,
    });

    // ── Families sheet ────────────────────────────────────────────────────────
    const families = workbook.addWorksheet('Families');
    families.columns = FAMILIES_COLUMNS;
    styleHeaderRow(families.getRow(1));
    stylePreviewHeader(families.getRow(1), families.getColumn('Preview').number);
    families.views = [{ state: 'frozen', ySplit: 1 }];

    addExampleRow(families, {
        FamilyID: 1, HusbandRowID: 1, WifeRowID: 2,
        MarriageDate: '1974-06-15', MarriagePlace: 'Boston, MA',
    });

    // Add preview formulas (rows 2–501); example row 2 will show live results
    for (let i = PREVIEW_ROW_START; i <= PREVIEW_ROW_END; i++) {
        const row = families.getRow(i);
        const cell = row.getCell(families.getColumn('Preview').number);
        cell.value = { formula: familiesPreviewFormula(i) };
        applyPreviewCellStyle(cell);
        row.commit();
    }

    // ── Children sheet ────────────────────────────────────────────────────────
    const children = workbook.addWorksheet('Children');
    children.columns = CHILDREN_COLUMNS;
    styleHeaderRow(children.getRow(1));
    stylePreviewHeader(children.getRow(1), children.getColumn('Preview').number);
    children.views = [{ state: 'frozen', ySplit: 1 }];

    addExampleRow(children, { FamilyID: 1, ChildRowID: 3 });
    addExampleRow(children, { FamilyID: 1, ChildRowID: 4 });

    // Add preview formulas
    for (let i = PREVIEW_ROW_START; i <= PREVIEW_ROW_END; i++) {
        const row = children.getRow(i);
        const cell = row.getCell(children.getColumn('Preview').number);
        cell.value = { formula: childrenPreviewFormula(i) };
        applyPreviewCellStyle(cell);
        row.commit();
    }

    // ── Instructions sheet ────────────────────────────────────────────────────
    const instructions = workbook.addWorksheet('Instructions');
    instructions.columns = [{ header: '', key: 'text', width: 85 }];
    const isMDY = slashOrder === 'MDY';
    const slashLabel = isMDY ? 'Month/Day/Year  (e.g. 3/15/1950)' : 'Day/Month/Year  (e.g. 15/3/1950)';
    const slashExample = isMDY ? '3/15/1950 = March 15, 1950' : '15/3/1950 = March 15, 1950';
    const slashNote = isMDY
        ? "Your app is set to Month/Day/Year order. You can change this in the app's Options page."
        : "Your app is set to Day/Month/Year order. You can change this in the app's Options page.";

    const lines = [
        'HOW TO USE THIS TEMPLATE',
        '',
        'This spreadsheet lets you add people and family relationships to your family tree.',
        'Fill in the sheets below, then upload the file on the Import / Export page.',
        '',
        '━━━ DATES ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        'Recommended format — always unambiguous regardless of region:',
        '  YYYY-MM-DD  e.g. 1950-03-15 = March 15, 1950  ← month is always the middle number',
        '  YYYY-MM     e.g. 1950-03    = March 1950',
        '  YYYY        e.g. 1950       = year only',
        '',
        'You can also use a short date with slashes (N/N/YYYY). How those are read depends',
        'on your date format setting:',
        `  Your current setting: ${slashLabel}`,
        `  Example: ${slashExample}`,
        `  ⚙  ${slashNote}`,
        '',
        '━━━ SHEET 1: People ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '- RowID: number each row starting at 1 (1, 2, 3, 4…).',
        '  This is just used inside this file to link family members — it is not stored in the app.',
        '- Sex: choose M, F, or Unknown from the dropdown.',
        '- IsDeceased: choose Yes, No, or Unknown from the dropdown.',
        "- Leave any cell blank if you don't have that information.",
        '- Delete all EXAMPLE rows before uploading.',
        '',
        '━━━ SHEET 2: Families ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '- FamilyID: number each family starting at 1 (1, 2, 3…).',
        '- HusbandRowID / WifeRowID: enter the RowID of each spouse from the People sheet.',
        '  Both are optional — you can leave one blank for a single-parent family.',
        '- 🔒 Preview column: auto-calculated — do not edit it.',
        '  It looks up the RowIDs you entered and shows the names to help you verify your data.',
        '- Delete all EXAMPLE rows before uploading.',
        '',
        '━━━ SHEET 3: Children ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '- FamilyID: must match a FamilyID from the Families sheet.',
        '- ChildRowID: must match a RowID from the People sheet.',
        '- Add one row per child. Two children in the same family = two rows.',
        '- 🔒 Preview column: auto-calculated — do not edit it.',
        '  It shows the child name and their parents to help you verify the links.',
        '- Delete all EXAMPLE rows before uploading.',
        '',
        '━━━ UPLOADING ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '1. Go to the Import / Export page in the app.',
        '2. Click "Preview Import" — the app checks for errors and duplicates WITHOUT saving anything.',
        '3. Review the preview. If there are date errors, fix them and try again.',
        '4. If any records will be skipped (already exist), you can download a log.',
        '5. Click "Confirm Import" to save your data.',
    ];
    lines.forEach((line, i) => {
        const row = instructions.getRow(i + 1);
        row.getCell(1).value = line;
        if (i === 0) row.getCell(1).font = { bold: true, size: 13 };
        row.commit();
    });

    const buf = await workbook.xlsx.writeBuffer();
    return Buffer.from(buf);
}

// ── Style helpers ─────────────────────────────────────────────────────────────

type WorksheetWithValidations = ExcelJS.Worksheet & {
    dataValidations: { add: (range: string, opts: object) => void };
};

/**
 * Adds a list dropdown validation to a cell range.
 * ExcelJS's public Worksheet type omits `dataValidations`, so a cast is required.
 */
function addDropdownValidation(sheet: ExcelJS.Worksheet, range: string, formulae: string, errorMsg: string) {
    (sheet as WorksheetWithValidations).dataValidations.add(range, {
        type: 'list', allowBlank: true, formulae: [formulae],
        showErrorMessage: true, errorTitle: 'Invalid value', error: errorMsg,
    });
}

function styleHeaderRow(row: ExcelJS.Row) {
    row.font = { bold: true };
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F0FE' } };
    row.alignment = { vertical: 'middle' };
    row.height = 20;
    row.commit();
}

/** Overrides the header cell for the preview column with a distinct locked appearance. */
function stylePreviewHeader(row: ExcelJS.Row, colNumber: number) {
    const cell = row.getCell(colNumber);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8E8E8' } };
    cell.font = { bold: true, italic: true, color: { argb: 'FF666666' } };
}

/** Styles a preview formula cell to look read-only (light gray, italic). */
function applyPreviewCellStyle(cell: ExcelJS.Cell) {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } };
    cell.font = { italic: true, color: { argb: 'FF888888' } };
    cell.protection = { locked: true };
}

function addExampleRow(sheet: ExcelJS.Worksheet, values: Record<string, unknown>) {
    const row = sheet.addRow(values);
    row.eachCell(cell => {
        cell.font = { italic: true, color: { argb: 'FF888888' } };
    });
    row.commit();
}
