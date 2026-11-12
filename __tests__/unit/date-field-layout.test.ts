import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const source = (path: string) => readFileSync(join(root, path), 'utf8');

describe('date field layout contracts', () => {
    it('stacks birth and death Date fields above their Places', () => {
        const vitals = source('app/components/person-form/VitalsSection.tsx');

        expect(vitals).toContain("const gridCols = '1fr'");
    });

    it('gives event Date its own row instead of sharing a row with Type', () => {
        const editor = source('app/components/InlineEventEditor.tsx');

        expect(editor).not.toContain("gridTemplateColumns: '1fr 1fr'");
        expect(editor).toContain('<div className="grid gap-2.5 mb-2.5">');
    });

    it('stacks the new-family Started Date above Started Place', () => {
        const familyForm = source('app/components/FamilyForm.tsx');

        expect(familyForm).toContain('<div className="grid grid-cols-1 gap-3.5">');
        expect(familyForm).not.toContain('grid-cols-[1fr_2fr] gap-3.5');
    });

    it('stacks the family timeline marriage Date above Place', () => {
        const marriageEditor = source('app/families/view/InlineMarriageEditor.tsx');

        expect(marriageEditor).toContain('<div className="grid grid-cols-1 gap-3">');
        expect(marriageEditor).not.toContain('sm:grid-cols-[1fr_2fr]');
    });
});
