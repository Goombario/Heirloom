import { describe, it, expect } from 'vitest';
import { parseGedcom } from '@/lib/gedcom/parser';
import { countUnreadableDates } from '@/lib/services/gedcom';
import { formatGedcomImportWarning } from '@/lib/gedcom/import-warning';

// #39: dates kept as written are counted for the import summary.
const FILE = [
    '0 HEAD', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
    '0 @I1@ INDI', '1 NAME Ada /Arbor/',
    '1 BIRT', '2 DATE 12 Feb 1712-1713',
    '1 DEAT', '2 DATE 3 MAR 1790',
    '1 RESI', '2 DATE <unknown>',
    '1 OCCU Smith', '2 DATE (during the war)',
    '0 @I2@ INDI', '1 NAME Ben /Arbor/', '1 BIRT', '2 DATE ABT 1715',
    '0 @F1@ FAM', '1 HUSB @I2@', '1 WIFE @I1@', '1 MARR', '2 DATE Deceased',
    '1 DIV', '2 DATE 1750',
    '0 TRLR',
].join('\n');

describe('countUnreadableDates (#39)', () => {
    it('counts person, family and event dates it could not read, not phrases', () => {
        const { people, families } = parseGedcom(FILE);
        // 12 Feb 1712-1713, <unknown>, Deceased. The phrase and the readable dates don't count.
        expect(countUnreadableDates(people, families)).toBe(3);
    });

    it('formats the summary line', () => {
        const line = formatGedcomImportWarning({ code: 'dates_kept_as_written', values: { count: 3 } }, (key, values) => `${key}:${JSON.stringify(values)}`);
        expect(line).toBe('warning_dates_kept_as_written:{"count":3}');
    });
});
