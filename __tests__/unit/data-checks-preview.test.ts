import { describe, it, expect } from 'vitest';
import { runDataChecks } from '@/lib/data-checks/engine';
import { dateClearsProblem, neighbourhood } from '@/lib/data-checks/preview';
import type { DataCheckInput } from '@/lib/data-checks/rules';

// Mary Ellen Byrne (#786): born 1813, died aged seven months (1814-01-27), and
// mother of four born 1843–1849. Her death is the date to fix (#832).
const input: DataCheckInput = {
    people: [
        { Id: 1, Sex: 'F', BirthDate: '1813', DeathDate: '1814-01-27', IsDeceased: 1 },
        { Id: 2, Sex: 'M', BirthDate: '1810', DeathDate: '1871', IsDeceased: 1 },
        { Id: 3, Sex: 'F', BirthDate: '1843-03-03', DeathDate: null, IsDeceased: 1 },
        { Id: 4, Sex: 'M', BirthDate: '1845', DeathDate: null, IsDeceased: 1 },
        { Id: 5, Sex: 'F', BirthDate: '1847', DeathDate: null, IsDeceased: 1 },
        { Id: 6, Sex: 'M', BirthDate: 'ABT 1849', DeathDate: null, IsDeceased: 1 },
        { Id: 8, Sex: 'F', BirthDate: '1802', DeathDate: null, IsDeceased: 1 },
        { Id: 9, Sex: 'M', BirthDate: '1860', DeathDate: null, IsDeceased: 1 },
        // Mary Ellen's own mother, and an unrelated man: neither is her neighbourhood.
        { Id: 12, Sex: 'F', BirthDate: '1790', DeathDate: null, IsDeceased: 1 },
        { Id: 13, Sex: 'M', BirthDate: '1900', DeathDate: '1850', IsDeceased: 1 },
    ],
    events: [
        { Id: 50, Type: 'BAPM', Date: '1845-05-01', PersonId: 4, FamilyId: null },
        { Id: 51, Type: 'DIV', Date: '1860', PersonId: null, FamilyId: 10 },
        { Id: 52, Type: 'OCCU', Date: '1870', PersonId: 13, FamilyId: null },
    ],
    families: [
        { Id: 10, Partner1Id: 2, Partner2Id: 1, MarriageDate: null, childIds: [3, 4, 5, 6] },
        { Id: 11, Partner1Id: null, Partner2Id: 8, MarriageDate: null, childIds: [9] },
        { Id: 14, Partner1Id: null, Partner2Id: 12, MarriageDate: null, childIds: [1] },
    ],
};

const problem = runDataChecks(input).find((p) => p.id === 'child_born_after_mother_death:1')!;
const death = problem.facts.find((f) => f.key === 'PersonDeath:1')!;

describe('data checks preview (#832)', () => {
    it("takes the person, their partners, children and those people's events, and nobody else", () => {
        const n = neighbourhood(input, 1);
        expect(n.people.map((p) => p.Id)).toEqual([1, 2, 3, 4, 5, 6]);
        expect(n.families.map((f) => f.Id)).toEqual([10]);
        expect(n.events.map((e) => e.Id)).toEqual([50, 51]);
    });

    it('carries adoption and foster links, so the preview decides as the page does (#841)', () => {
        const adopted: DataCheckInput = {
            people: [
                { Id: 1, Sex: 'F', BirthDate: '1800', DeathDate: null, IsDeceased: 1 },
                { Id: 2, Sex: 'M', BirthDate: '1858', DeathDate: null, IsDeceased: 1 },
            ],
            events: [],
            families: [{ Id: 10, Partner1Id: null, Partner2Id: 1, MarriageDate: null, childIds: [2], partner2NonBirthChildIds: [2] }],
        };
        const n = neighbourhood(adopted, 1);
        expect(n.families[0].partner2NonBirthChildIds).toEqual([2]);
        expect(runDataChecks(n)).toEqual([]);
    });

    it("decides Mary Ellen's problem the same on her neighbourhood as on the whole tree", () => {
        const ids = (i: DataCheckInput) => runDataChecks(i).filter((p) => p.personId === 1).map((p) => p.id);
        expect(ids(neighbourhood(input, 1))).toEqual(ids(input));
    });

    it("says whether a new death date clears Mary Ellen's problem: 1814 doesn't, 1874 does", () => {
        const n = neighbourhood(input, 1);
        expect(dateClearsProblem(n, problem.id, death, '1814')).toBe(false);
        expect(dateClearsProblem(n, problem.id, death, '1874')).toBe(true);
        // Flagged only when every reading conflicts: "before 1874" may be after 1849, so it clears.
        expect(dateClearsProblem(n, problem.id, death, 'BEF 1874')).toBe(true);
        expect(dateClearsProblem(n, problem.id, death, 'BEF 1840')).toBe(false);
    });

    it('re-checks a date stored on an event or a family', () => {
        const baptism = runDataChecks({
            people: [{ Id: 1, Sex: 'M', BirthDate: '1850', DeathDate: null, IsDeceased: 1 }],
            events: [{ Id: 5, Type: 'BAPM', Date: '1840', PersonId: 1, FamilyId: null }],
            families: [],
        })[0];
        expect(baptism.id).toBe('baptism_before_birth:1');
        const birth = baptism.facts.find((f) => f.key === 'PersonBirth:1')!;
        const n = { people: [{ Id: 1, Sex: 'M', BirthDate: '1850', DeathDate: null, IsDeceased: 1 }], events: [{ Id: 5, Type: 'BAPM', Date: '1840', PersonId: 1, FamilyId: null }], families: [] };
        expect(dateClearsProblem(n, baptism.id, birth, '1839')).toBe(true);

        const ends = runDataChecks(neighbourhood(input, 2)).find((p) => p.rule === 'partnership_ends_before_start');
        expect(ends).toBeUndefined();
        const withStart = { ...input, families: input.families.map((f) => (f.Id === 10 ? { ...f, MarriageDate: '1865' } : f)) };
        const end = runDataChecks(withStart).find((p) => p.rule === 'partnership_ends_before_start')!;
        const start = end.facts.find((f) => f.table === 'Families')!;
        const divorce = end.facts.find((f) => f.table === 'Events')!;
        expect(dateClearsProblem(neighbourhood(withStart, end.personId), end.id, divorce, '1866')).toBe(true);
        expect(dateClearsProblem(neighbourhood(withStart, end.personId), end.id, start, '1855')).toBe(true);
    });
});
