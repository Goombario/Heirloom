import { describe, it, expect } from 'vitest';
import { FACT_TABLES, PERSON_KEYED_FACT_TABLES } from '@/lib/db/fact-tables';

describe('FACT_TABLES', () => {
    it('has distinct values for every key', () => {
        const values = Object.values(FACT_TABLES);
        expect(new Set(values).size).toBe(values.length);
    });

    it('uses the canonical PascalCase values the queries read back', () => {
        // These literals appear in lib/db/queries/citations.ts and init-schema.ts.
        // If a constant drifts from the literal, person-scoped citations silently
        // stop matching — pin them here.
        expect(FACT_TABLES.PEOPLE).toBe('People');
        expect(FACT_TABLES.EVENTS).toBe('Events');
        expect(FACT_TABLES.NAME_VARIANT).toBe('NameVariant');
        expect(FACT_TABLES.CASES).toBe('Cases');
        expect(FACT_TABLES.PERSON_BIRTH).toBe('PersonBirth');
        expect(FACT_TABLES.PERSON_DEATH).toBe('PersonDeath');
        expect(FACT_TABLES.PERSON_NAME).toBe('PersonName');
    });

    it('person-keyed set is a subset of FACT_TABLES values', () => {
        const all = new Set<string>(Object.values(FACT_TABLES));
        for (const t of PERSON_KEYED_FACT_TABLES) {
            expect(all.has(t)).toBe(true);
        }
    });

    it('person-keyed set excludes row-keyed fact tables (Events, NameVariant)', () => {
        expect(PERSON_KEYED_FACT_TABLES).not.toContain(FACT_TABLES.EVENTS);
        expect(PERSON_KEYED_FACT_TABLES).not.toContain(FACT_TABLES.NAME_VARIANT);
    });
});
