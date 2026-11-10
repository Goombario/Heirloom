import { describe, it, expect } from 'vitest';
import { createTranslator } from 'next-intl';
import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import ru from '@/messages/ru.json';
import { runDataChecks } from '@/lib/data-checks/engine';
import { DATA_CHECK_RULES, type DataCheckInput } from '@/lib/data-checks/rules';
import type { DataCheckEntry } from '@/lib/data/types';
import {
    PAGE_SIZE, applyRule, entryCount, filterEntries, messageArgs, pageCount, pageGroups, pageOfIndex,
    peopleById, ruleCounts, timelineRows,
} from '@/app/data-checks/model';

// Mary Ellen Byrne (#786): died aged seven months, mother of four born 1843–1849.
// Thomas Kelly: death before birth. Anne Doyle: a mother over 55 (unlikely).
const input: DataCheckInput = {
    people: [
        { Id: 1, Sex: 'F', BirthDate: '1813', DeathDate: '1814-01-27', IsDeceased: 1 },
        { Id: 2, Sex: 'M', BirthDate: '1810', DeathDate: '1871', IsDeceased: 1 },
        { Id: 3, Sex: 'F', BirthDate: '1843-03-03', DeathDate: null, IsDeceased: 1 },
        { Id: 4, Sex: 'M', BirthDate: '1845', DeathDate: null, IsDeceased: 1 },
        { Id: 5, Sex: 'F', BirthDate: '1847', DeathDate: null, IsDeceased: 1 },
        { Id: 6, Sex: 'M', BirthDate: 'ABT 1849', DeathDate: null, IsDeceased: 1 },
        { Id: 7, Sex: 'M', BirthDate: '1851-03-14', DeathDate: 'ABT 1841', IsDeceased: 1 },
        { Id: 8, Sex: 'F', BirthDate: '1802', DeathDate: null, IsDeceased: 1 },
        { Id: 9, Sex: 'M', BirthDate: '1860', DeathDate: null, IsDeceased: 1 },
    ],
    events: [],
    families: [
        { Id: 10, Partner1Id: 2, Partner2Id: 1, MarriageDate: 'EST 1842', childIds: [3, 4, 5, 6] },
        { Id: 11, Partner1Id: null, Partner2Id: 8, MarriageDate: null, childIds: [9] },
    ],
};
const names = [
    { Id: 1, FirstName: 'Mary Ellen', LastName: 'Byrne', Sex: 'F', BirthDate: '1813', DeathDate: '1814-01-27' },
    { Id: 7, FirstName: 'Thomas', LastName: 'Kelly', Sex: 'M', BirthDate: null, DeathDate: null },
    { Id: 8, FirstName: 'Anne', LastName: 'Doyle', Sex: 'F', BirthDate: null, DeathDate: null },
    { Id: 9, FirstName: 'Patrick', LastName: 'Doyle', Sex: 'M', BirthDate: null, DeathDate: null },
];
const byId = peopleById(names);
const entries: DataCheckEntry[] = runDataChecks(input).map((p) => ({ ...p, confirmation: null }));
const find = (id: string) => entries.find((e) => e.id === id)!;
const open = { tab: 'open' as const, familyId: null, query: '' };

describe('Data checks page model (#831)', () => {
    it('lists impossible checks first, one entry per person', () => {
        expect(entries.map((e) => e.id)).toEqual([
            'death_before_birth:7', 'child_born_after_mother_death:1', 'partnership_after_death:1', 'mother_too_old:8',
        ]);
        expect(entryCount(find('child_born_after_mother_death:1'))).toBe(4);
    });

    it('splits To check from Confirmed, and filters by family and by a folded name', () => {
        const confirmed = entries.map((e) => (e.kind === 'unlikely'
            ? { ...e, confirmation: { reason: 'Register', confirmedBy: 1, confirmedByName: null, confirmedAt: '2026-09-26T00:00:00Z' } }
            : e));
        expect(filterEntries(confirmed, open, byId).map((e) => e.id)).not.toContain('mother_too_old:8');
        expect(filterEntries(confirmed, { ...open, tab: 'confirmed' }, byId).map((e) => e.id)).toEqual(['mother_too_old:8']);
        const mary = ['child_born_after_mother_death:1', 'partnership_after_death:1'];
        expect(filterEntries(entries, { ...open, familyId: 10 }, byId).map((e) => e.id)).toEqual(mary);
        expect(filterEntries(entries, { ...open, query: 'BYRNÉ' }, byId).map((e) => e.id)).toEqual(mary);
    });

    it('counts only the checks that found something, in display order', () => {
        expect(ruleCounts(entries)).toEqual([
            { rule: 'death_before_birth', kind: 'impossible', count: 1 },
            { rule: 'child_born_after_mother_death', kind: 'impossible', count: 1 },
            { rule: 'partnership_after_death', kind: 'impossible', count: 1 },
            { rule: 'mother_too_old', kind: 'unlikely', count: 1 },
        ]);
        expect(applyRule(entries, 'mother_too_old').map((e) => e.id)).toEqual(['mother_too_old:8']);
    });

    it('pages 25 entries at a time, grouped by check with whole-list totals', () => {
        const many = Array.from({ length: 30 }, (_, i) => ({ ...entries[1], id: `x:${i}`, personId: 100 + i }));
        const list = [entries[0], ...many];
        expect(pageCount(list)).toBe(2);
        expect(pageOfIndex(PAGE_SIZE)).toBe(2);
        const page2 = pageGroups(list, 2);
        expect(page2).toHaveLength(1);
        expect(page2[0]).toMatchObject({ rule: 'child_born_after_mother_death', total: 30 });
        expect(page2[0].entries).toHaveLength(6);
    });

    it("marks only the date to fix: Mary Ellen's death, not her children's births", () => {
        const rows = timelineRows(find('child_born_after_mother_death:1'));
        expect(rows.map((r) => [r.fact.key, r.toFix])).toEqual([
            ['PersonDeath:1', true],
            ['PersonBirth:3', false],
            ['PersonBirth:6', false], // ABT 1849 reads from 1844
            ['PersonBirth:4', false],
            ['PersonBirth:5', false],
        ]);
        // Death before birth marks both.
        expect(timelineRows(find('death_before_birth:7')).filter((r) => r.toFix)).toHaveLength(2);
    });
});

describe('Data checks rule messages (#831)', () => {
    const catalogs = { en, fr, ru } as Record<string, { dataChecks: Record<string, string> }>;
    const translator = (locale: string) => createTranslator({ locale, messages: catalogs[locale], namespace: 'dataChecks' }) as unknown as
        (key: string, values: Record<string, string | number>) => string;
    const samples = [
        { sex: 'F', count: 1 }, { sex: 'M', count: 4 }, { sex: 'other', count: 21 },
    ];

    it.each(Object.keys(catalogs))('%s has a name, summary and sentence for every rule, and each formats', (loc) => {
        const dc = catalogs[loc].dataChecks;
        const t = translator(loc);
        for (const { id } of DATA_CHECK_RULES) {
            for (const kind of ['rule', 'summary', 'sentence']) {
                expect(dc[`${kind}_${id}`], `${loc} ${kind}_${id}`).toBeTypeOf('string');
                for (const s of samples) {
                    const out = t(`${kind}_${id}`, { name: 'Mary Ellen Byrne', threshold: 55, age: 8, months: 10, ...s });
                    expect(out, `${loc} ${kind}_${id}`).not.toMatch(/[{}]|dataChecks\./);
                }
            }
        }
    });

    it("reads Mary Ellen's entry the way the mock does", () => {
        const e = find('child_born_after_mother_death:1');
        const args = messageArgs(e, byId, 'Unknown');
        const t = translator('en');
        expect(t('summary_child_born_after_mother_death', args)).toBe('4 children born after her death');
        expect(t('sentence_child_born_after_mother_death', args)).toBe('Mary Ellen Byrne died before her 4 children were born');
    });
});
