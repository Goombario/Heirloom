import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { MAX_SPREADSHEET_INFLATED_BYTES, MAX_SPREADSHEET_ROWS, capInMegabytes } from '../import-limits';
import { zipInflatesWithin } from '../zip-capped';
import { ValidationError, normalizeNameOrNull, validatePerson } from '../validation';
import { parseUserDateInput } from '../date-utils';

/**
 * Normalises a raw date cell value using the shared parseUserDateInput utility.
 * Accepts YYYY, YYYY-MM, YYYY-MM-DD, slash formats (MM/DD/YYYY), and text
 * month names. Returns null for empty values. Pushes a human-readable error
 * into `errors` when the value is present but cannot be parsed.
 */
function normalizeDate(
    raw: string | null,
    fieldName: string,
    sheetName: string,
    rowNumber: number,
    errors: string[],
    slashOrder: 'MDY' | 'DMY' = 'MDY'
): string | null {
    if (!raw) return null;
    const normalized = parseUserDateInput(raw, slashOrder);
    if (normalized === null) {
        errors.push(
            `${sheetName} row ${rowNumber}, ${fieldName}: "${raw}" is not a recognised date. ` +
            `Use Year-Month-Day format: YYYY-MM-DD (e.g. "1950-03-15"), YYYY-MM (e.g. "1950-03"), or just YYYY (e.g. "1950").`
        );
        return null; // format error already recorded above; null prevents cascading errors in validatePerson
    }
    return normalized;
}

export interface ParsedSpreadsheetPerson {
    rowId: number;
    FirstName: string | null;
    LastName: string | null;
    Sex: string | null;
    BirthDate: string | null;
    BirthPlace: string | null;
    DeathDate: string | null;
    DeathPlace: string | null;
    IsDeceased: number | null;
    Notes: string | null;
}

export interface ParsedSpreadsheetFamily {
    familyId: number;
    husbandRowId: number | null;
    wifeRowId: number | null;
    MarriageDate: string | null;
    MarriagePlace: string | null;
}

export interface ParsedSpreadsheetChild {
    familyId: number;
    childRowId: number;
}

export interface ParsedSpreadsheet {
    people: ParsedSpreadsheetPerson[];
    families: ParsedSpreadsheetFamily[];
    children: ParsedSpreadsheetChild[];
}

// ── Cell value helpers ────────────────────────────────────────────────────────

type ShownValue = string | number | boolean | Date | ExcelJS.CellErrorValue | null;

/**
 * The value Excel shows in a cell: a formula's cached result, a hyperlink's
 * text, rich text's plain text. Unknown object values become null rather than
 * "[object Object]" (#877).
 */
function shownValue(v: ExcelJS.CellValue): ShownValue {
    if (v === null || v === undefined) return null;
    if (typeof v !== 'object' || v instanceof Date) return v;
    if ('error' in v) return v;
    if ('richText' in v) return v.richText.map(r => r.text).join('');
    if ('formula' in v || 'sharedFormula' in v) return shownValue(v.result ?? null);
    if ('hyperlink' in v) return shownValue(v.text as ExcelJS.CellValue);
    return null;
}

/** Reads a cell's shown value; an Excel error cell reads as null and is reported into `errors`. */
function readCell(cell: ExcelJS.Cell, errors?: string[]): Exclude<ShownValue, ExcelJS.CellErrorValue> {
    const v = shownValue(cell.value);
    if (v !== null && typeof v === 'object' && !(v instanceof Date)) {
        errors?.push(
            `${cell.worksheet.name} cell ${cell.address}: the cell shows the Excel error ${v.error}. ` +
            `Fix or clear it, then import again.`
        );
        return null;
    }
    return v;
}

function cellString(cell: ExcelJS.Cell, errors?: string[]): string | null {
    const v = readCell(cell, errors);
    if (v === null) return null;
    // ExcelJS gives date cells as a Date at UTC midnight; local getters would
    // move them a day earlier west of UTC (#877).
    if (v instanceof Date) {
        const y = v.getUTCFullYear();
        const m = String(v.getUTCMonth() + 1).padStart(2, '0');
        const d = String(v.getUTCDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }
    return String(v).trim() || null;
}

function cellNumber(cell: ExcelJS.Cell, errors?: string[]): number | null {
    const v = readCell(cell, errors);
    if (v === null || v === '' || v instanceof Date) return null;
    const n = typeof v === 'number' ? v : Number(String(v).trim());
    return isNaN(n) ? null : n;
}

function buildHeaderIndex(row: ExcelJS.Row): Map<string, number> {
    const map = new Map<string, number>();
    row.eachCell((cell, colNumber) => {
        const text = cellString(cell)?.trim();
        if (!text) return;
        // A repeated header used to read only its last column, silently (#867).
        if (map.has(text)) {
            throw new ValidationError(`${row.worksheet.name} sheet: the column "${text}" appears more than once.`);
        }
        map.set(text, colNumber);
    });
    return map;
}

function requireHeader(headers: Map<string, number>, name: string, sheet: string): number {
    const col = headers.get(name);
    if (col === undefined) {
        throw new ValidationError(`"${sheet}" sheet is missing required column: ${name}`);
    }
    return col;
}

function mapIsDeceased(raw: string | null): number | null {
    if (!raw) return null;
    const lower = raw.toLowerCase();
    if (lower === 'yes') return 1;
    if (lower === 'no') return 0;
    return null; // "unknown" or anything else
}

function mapSex(raw: string | null): string | null {
    if (!raw) return null;
    const upper = raw.toUpperCase();
    if (upper === 'M' || upper === 'F') return upper;
    return null; // "unknown" or anything else
}

// ── Main parser ───────────────────────────────────────────────────────────────

/**
 * An `.xlsx` is a zip: refuse one that inflates past the cap before ExcelJS
 * unpacks it all into memory (#1222, audit L-8).
 */
async function assertWorkbookWithinCap(buffer: Buffer): Promise<void> {
    let zip: JSZip;
    try {
        zip = await JSZip.loadAsync(buffer);
    } catch {
        throw new ValidationError('The uploaded file is not a valid .xlsx workbook.');
    }
    if (!(await zipInflatesWithin(zip, MAX_SPREADSHEET_INFLATED_BYTES))) {
        throw new ValidationError(
            `The spreadsheet is too large once unpacked. Its contents must be under ${capInMegabytes(MAX_SPREADSHEET_INFLATED_BYTES)} MB.`
        );
    }
}

export async function parseSpreadsheet(buffer: Buffer, slashOrder: 'MDY' | 'DMY' = 'MDY'): Promise<ParsedSpreadsheet> {
    await assertWorkbookWithinCap(buffer);
    const workbook = new ExcelJS.Workbook();
    // ExcelJS 4.4.0 bundles @types/node@14 (non-generic Buffer); Node 20 uses Buffer<ArrayBufferLike>.
    // The types are structurally incompatible at the TS level but identical at runtime.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await workbook.xlsx.load(buffer as any);

    const peopleSheet = workbook.getWorksheet('People');
    if (!peopleSheet) {
        throw new ValidationError('The uploaded file is missing the required "People" sheet.');
    }

    // Bound the per-row work and the import that follows (#1222, audit L-8).
    for (const sheet of workbook.worksheets) {
        if (sheet.rowCount > MAX_SPREADSHEET_ROWS) {
            throw new ValidationError(
                `The "${sheet.name}" sheet has ${sheet.rowCount} rows. A spreadsheet import takes at most ${MAX_SPREADSHEET_ROWS} rows per sheet.`
            );
        }
    }

    const rowErrors: string[] = [];

    const people = parsePeopleSheet(peopleSheet, rowErrors, slashOrder);
    const peopleRowIds = new Set(people.map(p => p.rowId));

    const familiesSheet = workbook.getWorksheet('Families');
    const families = familiesSheet ? parseFamiliesSheet(familiesSheet, peopleRowIds, rowErrors, slashOrder) : [];
    const familyIds = new Set(families.map(f => f.familyId));

    const childrenSheet = workbook.getWorksheet('Children');
    const children = childrenSheet ? parseChildrenSheet(childrenSheet, familyIds, peopleRowIds, rowErrors) : [];

    // Logical date validation per person (death before birth, future dates, etc.)
    // Only runs after format validation so BirthDate/DeathDate are already normalised.
    for (const person of people) {
        const issues = validatePerson({ BirthDate: person.BirthDate, DeathDate: person.DeathDate });
        for (const issue of issues) {
            if (issue.type === 'error') {
                const name = [person.FirstName, person.LastName].filter(Boolean).join(' ') || `RowID ${person.rowId}`;
                rowErrors.push(`People (${name}): ${issue.message}.`);
            }
        }
    }

    if (rowErrors.length > 0) {
        throw new ValidationError(
            `The spreadsheet contains ${rowErrors.length} error${rowErrors.length > 1 ? 's' : ''}:\n\n` +
            rowErrors.join('\n')
        );
    }

    return { people, families, children };
}

function parsePeopleSheet(sheet: ExcelJS.Worksheet, rowErrors: string[], slashOrder: 'MDY' | 'DMY'): ParsedSpreadsheetPerson[] {
    const headerRow = sheet.getRow(1);
    const headers = buildHeaderIndex(headerRow);

    const rowIdCol = requireHeader(headers, 'RowID', 'People');
    const firstNameCol = headers.get('FirstName') ?? null;
    const lastNameCol = headers.get('LastName') ?? null;
    const sexCol = headers.get('Sex') ?? null;
    const birthDateCol = headers.get('BirthDate') ?? null;
    const birthPlaceCol = headers.get('BirthPlace') ?? null;
    const deathDateCol = headers.get('DeathDate') ?? null;
    const deathPlaceCol = headers.get('DeathPlace') ?? null;
    const isDeceasedCol = headers.get('IsDeceased') ?? null;
    const notesCol = headers.get('Notes') ?? null;

    const people: ParsedSpreadsheetPerson[] = [];
    const seenRowIds = new Set<number>();

    sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return; // skip header

        const rowIdRaw = cellNumber(row.getCell(rowIdCol), rowErrors);
        if (rowIdRaw === null) return; // skip empty rows

        if (!Number.isInteger(rowIdRaw) || rowIdRaw <= 0) {
            throw new ValidationError(
                `People sheet row ${rowNumber}: RowID must be a positive integer, got "${rowIdRaw}".`
            );
        }
        if (seenRowIds.has(rowIdRaw)) {
            throw new ValidationError(
                `People sheet: duplicate RowID ${rowIdRaw} found (rows must have unique IDs).`
            );
        }
        seenRowIds.add(rowIdRaw);

        const rawBirthDate = birthDateCol ? cellString(row.getCell(birthDateCol), rowErrors) : null;
        const rawDeathDate = deathDateCol ? cellString(row.getCell(deathDateCol), rowErrors) : null;

        people.push({
            rowId: rowIdRaw,
            FirstName: normalizeNameOrNull(firstNameCol ? cellString(row.getCell(firstNameCol), rowErrors) : null),
            LastName: normalizeNameOrNull(lastNameCol ? cellString(row.getCell(lastNameCol), rowErrors) : null),
            Sex: mapSex(sexCol ? cellString(row.getCell(sexCol), rowErrors) : null),
            BirthDate: normalizeDate(rawBirthDate, 'BirthDate', 'People', rowNumber, rowErrors, slashOrder),
            BirthPlace: normalizeNameOrNull(birthPlaceCol ? cellString(row.getCell(birthPlaceCol), rowErrors) : null),
            DeathDate: normalizeDate(rawDeathDate, 'DeathDate', 'People', rowNumber, rowErrors, slashOrder),
            DeathPlace: normalizeNameOrNull(deathPlaceCol ? cellString(row.getCell(deathPlaceCol), rowErrors) : null),
            IsDeceased: mapIsDeceased(isDeceasedCol ? cellString(row.getCell(isDeceasedCol), rowErrors) : null),
            Notes: notesCol ? cellString(row.getCell(notesCol), rowErrors) : null,
        });
    });

    return people;
}

function parseFamiliesSheet(
    sheet: ExcelJS.Worksheet,
    validPeopleRowIds: Set<number>,
    rowErrors: string[],
    slashOrder: 'MDY' | 'DMY'
): ParsedSpreadsheetFamily[] {
    const headerRow = sheet.getRow(1);
    const headers = buildHeaderIndex(headerRow);

    const familyIdCol = requireHeader(headers, 'FamilyID', 'Families');
    const husbandCol = headers.get('HusbandRowID') ?? null;
    const wifeCol = headers.get('WifeRowID') ?? null;
    const marriageDateCol = headers.get('MarriageDate') ?? null;
    const marriagePlaceCol = headers.get('MarriagePlace') ?? null;

    const families: ParsedSpreadsheetFamily[] = [];
    const seenFamilyIds = new Set<number>();

    sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;

        const familyIdRaw = cellNumber(row.getCell(familyIdCol), rowErrors);
        if (familyIdRaw === null) return;

        if (!Number.isInteger(familyIdRaw) || familyIdRaw <= 0) {
            throw new ValidationError(
                `Families sheet row ${rowNumber}: FamilyID must be a positive integer.`
            );
        }
        if (seenFamilyIds.has(familyIdRaw)) {
            throw new ValidationError(
                `Families sheet: duplicate FamilyID ${familyIdRaw}.`
            );
        }
        seenFamilyIds.add(familyIdRaw);

        const husbandRowId = husbandCol ? cellNumber(row.getCell(husbandCol), rowErrors) : null;
        const wifeRowId = wifeCol ? cellNumber(row.getCell(wifeCol), rowErrors) : null;

        if (husbandRowId !== null && !validPeopleRowIds.has(husbandRowId)) {
            throw new ValidationError(
                `Families sheet row ${rowNumber}: HusbandRowID ${husbandRowId} does not match any RowID in the People sheet.`
            );
        }
        if (wifeRowId !== null && !validPeopleRowIds.has(wifeRowId)) {
            throw new ValidationError(
                `Families sheet row ${rowNumber}: WifeRowID ${wifeRowId} does not match any RowID in the People sheet.`
            );
        }

        const rawMarriageDate = marriageDateCol ? cellString(row.getCell(marriageDateCol), rowErrors) : null;

        families.push({
            familyId: familyIdRaw,
            husbandRowId,
            wifeRowId,
            MarriageDate: normalizeDate(rawMarriageDate, 'MarriageDate', 'Families', rowNumber, rowErrors, slashOrder),
            MarriagePlace: normalizeNameOrNull(marriagePlaceCol ? cellString(row.getCell(marriagePlaceCol), rowErrors) : null),
        });
    });

    return families;
}

function parseChildrenSheet(
    sheet: ExcelJS.Worksheet,
    validFamilyIds: Set<number>,
    validPeopleRowIds: Set<number>,
    rowErrors: string[]
): ParsedSpreadsheetChild[] {
    const headerRow = sheet.getRow(1);
    const headers = buildHeaderIndex(headerRow);

    const familyIdCol = requireHeader(headers, 'FamilyID', 'Children');
    const childRowIdCol = requireHeader(headers, 'ChildRowID', 'Children');

    const children: ParsedSpreadsheetChild[] = [];

    sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;

        const familyId = cellNumber(row.getCell(familyIdCol), rowErrors);
        const childRowId = cellNumber(row.getCell(childRowIdCol), rowErrors);

        if (familyId === null && childRowId === null) return; // blank row

        if (familyId === null) {
            throw new ValidationError(`Children sheet row ${rowNumber}: FamilyID is missing.`);
        }
        if (childRowId === null) {
            throw new ValidationError(`Children sheet row ${rowNumber}: ChildRowID is missing.`);
        }
        if (!validFamilyIds.has(familyId)) {
            throw new ValidationError(
                `Children sheet row ${rowNumber}: FamilyID ${familyId} does not match any FamilyID in the Families sheet.`
            );
        }
        if (!validPeopleRowIds.has(childRowId)) {
            throw new ValidationError(
                `Children sheet row ${rowNumber}: ChildRowID ${childRowId} does not match any RowID in the People sheet.`
            );
        }

        children.push({ familyId, childRowId });
    });

    return children;
}
