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

    it('keeps the family timeline marriage Date at least 240px wide, wrapping Place below when narrow', () => {
        const marriageEditor = source('app/families/view/InlineMarriageEditor.tsx');

        expect(marriageEditor).toContain('grid-cols-[repeat(auto-fit,minmax(240px,1fr))]');
        expect(marriageEditor).not.toContain('sm:grid-cols-[1fr_2fr]');
    });
});
