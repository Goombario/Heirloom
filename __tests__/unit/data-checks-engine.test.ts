import { describe, it, expect } from 'vitest';
import { runDataChecks } from '@/lib/data-checks/engine';
import { daysFromCivil } from '@/lib/date-intervals';
import type {
  DataCheckEvent, DataCheckFamily, DataCheckInput, DataCheckPerson, DataCheckRuleId,
} from '@/lib/data-checks/rules';

// Task audit §11 (#828): per rule, a fixture it flags, a clean family it
// doesn't, and an approximate date where one reading conflicts and another
// doesn't, which must not flag.

let nextId = 1000;
const person = (o: Partial<DataCheckPerson> = {}): DataCheckPerson =>
  ({ Id: nextId++, Sex: null, BirthDate: null, DeathDate: null, IsDeceased: null, ...o });
const event = (personId: number | null, Type: string, Date: string, FamilyId: number | null = null): DataCheckEvent =>
  ({ Id: nextId++, Type, Date, PersonId: personId, FamilyId });
const family = (p1: DataCheckPerson | null, p2: DataCheckPerson | null, MarriageDate: string | null, children: DataCheckPerson[] = []): DataCheckFamily =>
  ({ Id: nextId++, Partner1Id: p1?.Id ?? null, Partner2Id: p2?.Id ?? null, MarriageDate, childIds: children.map((c) => c.Id) });
const run = (i: Partial<DataCheckInput>) => runDataChecks({ people: [], events: [], families: [], ...i });
const rules = (i: Partial<DataCheckInput>) => run(i).map((p) => p.rule);
const only = (i: Partial<DataCheckInput>, rule: DataCheckRuleId) => run(i).filter((p) => p.rule === rule);

/** A family with nothing wrong: every rule must leave it alone. */
function cleanFamily() {
  const father = person({ Sex: 'M', BirthDate: '1810', DeathDate: '1871-03-02' });
  const mother = person({ Sex: 'F', BirthDate: 'ABT 1815', DeathDate: '1880' });
  const kids = [person({ Sex: 'F', BirthDate: '1843-03-03' }), person({ Sex: 'M', BirthDate: '1849' })];
  const fam = family(father, mother, '1842', kids);
  const events = [
    event(kids[0].Id, 'BAPM', '1843-03-10'),
    event(father.Id, 'OCCU', '1840'),
    event(father.Id, 'BURI', '1871-03-06'),
    event(father.Id, 'PROB', '1872'),
    event(mother.Id, 'RESI', 'BET 1850 AND 1860'),
  ];
  return { people: [father, mother, ...kids], events, families: [fam] };
}

describe('runDataChecks: a clean family', () => {
  it('flags nothing', () => {
    expect(run(cleanFamily())).toEqual([]);
  });
  it('skips date phrases in every rule, and flags nothing in an empty tree', () => {
    const p = person({ BirthDate: '(in the old country)', DeathDate: '(during the war)' });
    expect(run({ people: [p], events: [event(p.Id, 'RESI', '1700')] })).toEqual([]);
    expect(run({})).toEqual([]);
  });
});

describe('1. death before birth', () => {
  it('flags it, with both dates editable', () => {
    const p = person({ BirthDate: '1851-03-14', DeathDate: 'ABT 1841' });
    const [problem] = run({ people: [p] });
    expect(problem).toMatchObject({ rule: 'death_before_birth', kind: 'impossible', personId: p.Id });
    expect(problem.editable).toEqual([`PersonBirth:${p.Id}`, `PersonDeath:${p.Id}`]);
    expect(problem.facts.map((f) => f.date)).toEqual(['1851-03-14', 'ABT 1841']);
  });
  it('uses a burial as the bound when the death is missing', () => {
    const p = person({ BirthDate: '1851' });
    const burial = event(p.Id, 'BURI', '1840');
    const [problem] = run({ people: [p], events: [burial] });
    expect(problem.rule).toBe('death_before_birth');
    expect(problem.editable).toEqual([`PersonBirth:${p.Id}`, `Events:${burial.Id}`]);
  });
  it("doesn't flag when one reading overlaps", () => {
    expect(rules({ people: [person({ BirthDate: '1851', DeathDate: 'ABT 1847' })] })).toEqual([]);
  });
});

describe('2. burial or cremation before death', () => {
  it('flags a burial and a cremation, editing the death', () => {
    const p = person({ DeathDate: '1871-03-02' });
    const problems = run({ people: [p], events: [event(p.Id, 'BURI', '1871-02-20'), event(p.Id, 'CREM', '1870')] });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ rule: 'burial_before_death', editable: [`PersonDeath:${p.Id}`] });
    expect(problems[0].facts).toHaveLength(3);
  });
  it("doesn't flag a burial in the same month as an undated-day death", () => {
    const p = person({ DeathDate: '1871-03' });
    expect(rules({ people: [p], events: [event(p.Id, 'BURI', '1871-03-01')] })).toEqual([]);
  });
});

describe('3. baptism or christening before birth', () => {
  it('flags it, editing the birth', () => {
    const p = person({ BirthDate: '1843-03-03' });
    const [problem] = run({ people: [p], events: [event(p.Id, 'CHR', '1843-02-01')] });
    expect(problem).toMatchObject({ rule: 'baptism_before_birth', editable: [`PersonBirth:${p.Id}`] });
  });
  it("doesn't flag an approximate birth", () => {
    const p = person({ BirthDate: 'ABT 1843' });
    expect(rules({ people: [p], events: [event(p.Id, 'BAPM', '1840')] })).toEqual([]);
  });
});

describe('4. any event before birth', () => {
  it('flags every event before birth as one entry', () => {
    const p = person({ BirthDate: '1850' });
    const problems = run({ people: [p], events: [event(p.Id, 'OCCU', '1830'), event(p.Id, 'RESI', 'BEF 1849')] });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ rule: 'event_before_birth', editable: [`PersonBirth:${p.Id}`] });
    expect(problems[0].facts).toHaveLength(3);
  });
  it("doesn't flag an open-ended AFT event or an overlapping BET", () => {
    const p = person({ BirthDate: '1850' });
    expect(rules({ people: [p], events: [event(p.Id, 'OCCU', 'AFT 1820'), event(p.Id, 'RESI', 'BET 1845 AND 1851')] })).toEqual([]);
  });
  it("doesn't repeat a baptism (rule 3) or a burial already reported (rules 1 and 2)", () => {
    const p = person({ BirthDate: '1850', DeathDate: '1900' });
    const got = rules({ people: [p], events: [event(p.Id, 'BAPM', '1849'), event(p.Id, 'BURI', '1848')] });
    expect(got).toEqual(['burial_before_death', 'baptism_before_birth']);
  });
});

describe('5. any event after death', () => {
  it('flags a non-exempt event, editing the death', () => {
    const p = person({ DeathDate: '1871' });
    const [problem] = run({ people: [p], events: [event(p.Id, 'CENS', '1881')] });
    expect(problem).toMatchObject({ rule: 'event_after_death', editable: [`PersonDeath:${p.Id}`] });
  });
  it('exempts burial, cremation, probate, will and obituary', () => {
    const p = person({ DeathDate: '1871' });
    const events = ['BURI', 'CREM', 'PROB', 'WILL', 'OBIT'].map((t) => event(p.Id, t, '1880'));
    expect(rules({ people: [p], events })).toEqual([]);
  });
  it('uses a burial as the bound when the death is missing', () => {
    const p = person({});
    const burial = event(p.Id, 'BURI', '1871');
    const [problem] = run({ people: [p], events: [burial, event(p.Id, 'CENS', '1881')] });
    expect(problem).toMatchObject({ rule: 'event_after_death', editable: [`Events:${burial.Id}`] });
  });
  it('skips custom events: an EVEN label, a generic EVEN or FACT, a _TAG and an LDS ordinance (#869)', () => {
    const p = person({ BirthDate: '1450', DeathDate: '1505' });
    const events = ['genannt', 'Alt. Burial', 'EVEN', 'FACT', '_MILT', 'BAPL'].map((t) => event(p.Id, t, '1950'));
    expect(rules({ people: [p], events: [...events, event(p.Id, 'Funktion', '1405')] })).toEqual([]);
  });
  it("doesn't flag an approximate event that could precede the death", () => {
    const p = person({ DeathDate: '1871' });
    expect(rules({ people: [p], events: [event(p.Id, 'CENS', 'ABT 1875')] })).toEqual([]);
  });
});

describe('6. partnership ends before it starts', () => {
  it('flags an explicit end event, editing it', () => {
    const a = person({ Sex: 'M' });
    const b = person({ Sex: 'F' });
    const f = family(a, b, '1842');
    const div = event(null, 'DIV', '1830', f.Id);
    const [problem] = run({ people: [a, b], families: [f], events: [div] });
    expect(problem).toMatchObject({ rule: 'partnership_ends_before_start', personId: a.Id, relatedPersonIds: [b.Id], familyIds: [f.Id], editable: [`Events:${div.Id}`] });
  });
  it("doesn't flag an approximate start that could precede the end", () => {
    const a = person();
    const f = family(a, null, 'EST 1842');
    expect(rules({ people: [a], families: [f], events: [event(null, 'SEPA', '1839', f.Id)] })).toEqual([]);
  });
});

describe('7. child born before a parent', () => {
  it("flags it under the parent, editing the parent's birth", () => {
    const parent = person({ BirthDate: '1850' });
    const kid = person({ BirthDate: '1820' });
    const f = family(parent, null, null, [kid]);
    const [problem] = run({ people: [parent, kid], families: [f] });
    expect(problem).toMatchObject({ rule: 'child_born_before_parent', personId: parent.Id, relatedPersonIds: [kid.Id], editable: [`PersonBirth:${parent.Id}`] });
  });
  it("uses the child's baptism as the bound on the child's birth", () => {
    const parent = person({ BirthDate: '1850' });
    const kid = person({});
    expect(rules({ people: [parent, kid], families: [family(parent, null, null, [kid])], events: [event(kid.Id, 'BAPM', '1820')] }))
      .toEqual(['child_born_before_parent']);
  });
  it("doesn't flag overlapping approximate births as impossible (only as unlikely)", () => {
    const parent = person({ BirthDate: 'ABT 1830' });
    const kid = person({ BirthDate: '1826' });
    expect(rules({ people: [parent, kid], families: [family(parent, null, null, [kid])] })).toEqual(['parent_too_young']);
  });
});

describe('8. child born after the mother’s death', () => {
  it('makes one entry under the mother, with all her children', () => {
    const mother = person({ Sex: 'F', BirthDate: '1813', DeathDate: '1814-01-27' });
    const father = person({ Sex: 'M', BirthDate: '1810', DeathDate: '1871' });
    const kids = ['1843-03-03', '1845', '1847', 'ABT 1849'].map((d) => person({ BirthDate: d }));
    const f = family(mother, father, 'EST 1842', kids);
    const got = only({ people: [mother, father, ...kids], families: [f] }, 'child_born_after_mother_death');
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ personId: mother.Id, familyIds: [f.Id], editable: [`PersonDeath:${mother.Id}`] });
    expect(got[0].relatedPersonIds).toEqual(kids.map((k) => k.Id));
  });
  it('flags a birth one day after the mother’s death', () => {
    const mother = person({ Sex: 'F', DeathDate: '1850-06-01' });
    const kid = person({ BirthDate: '1850-06-02' });
    expect(rules({ people: [mother, kid], families: [family(null, mother, null, [kid])] })).toEqual(['child_born_after_mother_death']);
  });
  it("doesn't flag a birth that could fall in the mother's death year", () => {
    const mother = person({ Sex: 'F', DeathDate: '1850' });
    const kid = person({ BirthDate: 'ABT 1853' });
    expect(rules({ people: [mother, kid], families: [family(null, mother, null, [kid])] })).toEqual([]);
  });
});

describe('9. child born more than 10 months after the father’s death', () => {
  const setup = (death: string, birth: string, sex: string | null = 'M') => {
    const father = person({ Sex: sex, DeathDate: death });
    const kid = person({ BirthDate: birth });
    return { people: [father, kid], families: [family(father, null, null, [kid])] };
  };
  it('flags 11 months, editing the father’s death', () => {
    const [problem] = run(setup('1850-01-15', '1850-12-20'));
    expect(problem).toMatchObject({ rule: 'child_born_after_father_death', editable: [problem.facts[0].key] });
    expect(problem.facts[0].table).toBe('PersonDeath');
  });
  it("doesn't flag 10 months or less (changed from 9)", () => {
    expect(rules(setup('1850-01-15', '1850-11-15'))).toEqual([]);
  });
  it('gives a parent of unknown sex the father’s allowance', () => {
    expect(rules(setup('1850-01-15', '1850-09-01', null))).toEqual([]);
    expect(rules(setup('1850-01-15', '1851-06-01', null))).toEqual(['child_born_after_father_death']);
  });
  it("doesn't flag a father whose approximate death could be later", () => {
    expect(rules(setup('ABT 1850', '1853'))).toEqual([]);
  });
  it('gives both partners of a same-sex couple the father’s allowance (#841)', () => {
    const setupCouple = (birth: string) => {
      const a = person({ Sex: 'F', DeathDate: '1850-01-15' });
      const b = person({ Sex: 'F', DeathDate: '1850-01-15' });
      const kid = person({ BirthDate: birth });
      return { people: [a, b, kid], families: [family(a, b, null, [kid])], a, b };
    };
    // Six months after both died: either could be the birth parent, so not flagged.
    const { a: _a, b: _b, ...soon } = setupCouple('1850-07-15');
    expect(rules(soon)).toEqual([]);
    // Two years after: flagged under each partner, as a father's death is.
    const { a, b, ...late } = setupCouple('1852-01-15');
    const got = only(late, 'child_born_after_father_death');
    expect(got.map((p) => p.personId)).toEqual([a.Id, b.Id]);
    expect(rules(late)).not.toContain('child_born_after_mother_death');
  });
  it('applies to adopted and foster children too (#841)', () => {
    const father = person({ Sex: 'M', DeathDate: '1850-01-15' });
    const kid = person({ BirthDate: '1852' });
    const f = { ...family(father, null, null, [kid]), partner1NonBirthChildIds: [kid.Id] };
    expect(rules({ people: [father, kid], families: [f] })).toEqual(['child_born_after_father_death']);
  });
});

describe('10. partnership starts after a partner’s death', () => {
  it("flags it, editing the partner's death", () => {
    const a = person({ DeathDate: '1814-01-27' });
    const b = person({});
    const f = family(a, b, 'EST 1842');
    const [problem] = run({ people: [a, b], families: [f] });
    expect(problem).toMatchObject({ rule: 'partnership_after_death', personId: a.Id, relatedPersonIds: [b.Id], editable: [`PersonDeath:${a.Id}`] });
  });
  it("doesn't flag an estimated start that could precede the death", () => {
    const a = person({ DeathDate: '1840' });
    expect(rules({ people: [a], families: [family(a, null, 'EST 1842')] })).toEqual([]);
  });
});

describe('11. partnership starts before a partner’s birth', () => {
  it("flags it, editing the partner's birth", () => {
    const a = person({ BirthDate: '1850' });
    const [problem] = run({ people: [a], families: [family(a, null, '1842')] });
    expect(problem).toMatchObject({ rule: 'partnership_before_birth', editable: [`PersonBirth:${a.Id}`] });
  });
  it("doesn't flag an approximate birth that could precede the start as impossible (only as unlikely)", () => {
    const a = person({ BirthDate: 'ABT 1845' });
    expect(rules({ people: [a], families: [family(a, null, '1842')] })).toEqual(['married_too_young']);
  });
});

describe('12. died aged 8 or younger but has children', () => {
  it('flags a death at 7 months with a child, editing the death', () => {
    const a = person({ BirthDate: '1813', DeathDate: '1814-01-27' });
    const b = person({});
    const kid = person({});
    const f = family(a, b, null, [kid]);
    const [problem] = run({ people: [a, b, kid], families: [f] });
    expect(problem).toMatchObject({ rule: 'died_young_with_family', relatedPersonIds: [b.Id, kid.Id], familyIds: [f.Id], editable: [`PersonDeath:${a.Id}`] });
  });
  it("doesn't flag a child spouse with no children: child marriages were real (#970)", () => {
    // Anne Mowbray married Richard of Shrewsbury at 5 and died at 8.
    const anne = person({ Sex: 'F', BirthDate: '10 DEC 1472', DeathDate: '19 NOV 1481' });
    const richard = person({ Sex: 'M', BirthDate: '17 AUG 1473' });
    // Only the unlikely (confirmable) marriage-age check stays.
    expect(rules({ people: [anne, richard], families: [family(anne, richard, '15 JAN 1478')] }))
      .toEqual(['married_too_young', 'married_too_young']);
  });
  it('flags a single parent with a child', () => {
    const a = person({ BirthDate: '1850-05-01', DeathDate: '1859-04-30' });
    const kid = person({});
    expect(rules({ people: [a, kid], families: [family(a, null, null, [kid])] })).toEqual(['died_young_with_family']);
  });
  it("doesn't flag someone who could have been 9, or someone with no family", () => {
    const a = person({ BirthDate: '1850-05-01', DeathDate: '1859-05-01' });
    const b = person({});
    expect(rules({ people: [a, b], families: [family(a, b, null)] })).toEqual([]);
    expect(rules({ people: [person({ BirthDate: '1850', DeathDate: '1851' })] })).toEqual([]);
    const c = person({ BirthDate: 'ABT 1850', DeathDate: '1857' });
    expect(rules({ people: [c, b], families: [family(c, b, null)] })).toEqual([]);
  });
  it("isn't repeated when the death already falls before the birth", () => {
    const a = person({ BirthDate: '1850', DeathDate: '1840' });
    const b = person({});
    expect(rules({ people: [a, b], families: [family(a, b, null)] })).toEqual(['death_before_birth']);
  });
  it("isn't repeated when another impossible check already marks the same death (Mary Ellen, #841)", () => {
    const mother = person({ Sex: 'F', BirthDate: '1813', DeathDate: '1814-01-27' });
    const father = person({ Sex: 'M', BirthDate: '1810', DeathDate: '1871' });
    const kids = ['1843-03-03', '1845'].map((d) => person({ BirthDate: d }));
    const input = { people: [mother, father, ...kids], families: [family(mother, father, 'EST 1842', kids)] };
    expect(rules(input)).toEqual(['child_born_after_mother_death', 'partnership_after_death']);
  });
});

describe('13. person is their own ancestor', () => {
  it('flags a cycle once, under its lowest ID, with nothing editable', () => {
    const a = person();
    const b = person();
    const c = person();
    const f1 = family(a, null, null, [b]);
    const f2 = family(b, null, null, [c]);
    const f3 = family(c, null, null, [a]);
    const got = run({ people: [a, b, c], families: [f1, f2, f3] });
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ rule: 'own_ancestor', personId: a.Id, relatedPersonIds: [b.Id, c.Id], editable: [], facts: [] });
    expect(got[0].familyIds).toEqual([f1.Id, f2.Id, f3.Id]);
  });
  it('flags a person linked as their own child', () => {
    const a = person();
    expect(rules({ people: [a], families: [family(a, null, null, [a])] })).toEqual(['own_ancestor']);
  });
  it("doesn't flag a deep tree without a cycle", () => {
    const line = Array.from({ length: 2000 }, () => person());
    const families = line.slice(1).map((p, i) => family(line[i], null, null, [p]));
    expect(rules({ people: line, families })).toEqual([]);
  });
});

const TODAY = daysFromCivil(2026, 9, 26);

describe('unlikely: parent under 12', () => {
  it("flags it under the parent, editing the parent's birth, with a threshold", () => {
    const parent = person({ BirthDate: '1840-06-01' });
    const kid = person({ BirthDate: '1851-05-31' });
    const [problem] = run({ people: [parent, kid], families: [family(parent, null, null, [kid])] });
    expect(problem).toMatchObject({ rule: 'parent_too_young', kind: 'unlikely', threshold: 12, personId: parent.Id, editable: [`PersonBirth:${parent.Id}`] });
  });
  it("doesn't flag a parent who is exactly 12", () => {
    const parent = person({ BirthDate: '1840-06-01' });
    const kid = person({ BirthDate: '1852-06-01' });
    expect(rules({ people: [parent, kid], families: [family(parent, null, null, [kid])] })).toEqual([]);
  });
  it("isn't repeated when the child is born before the parent", () => {
    const parent = person({ BirthDate: '1850' });
    const kid = person({ BirthDate: '1840' });
    expect(rules({ people: [parent, kid], families: [family(parent, null, null, [kid])] })).toEqual(['child_born_before_parent']);
  });
  it("doesn't flag a foster or adoptive parent younger than the child (#841)", () => {
    const parent = person({ BirthDate: '1850' });
    const older = person({ BirthDate: '1840' });
    const young = person({ BirthDate: '1858' });
    const f = { ...family(parent, null, null, [older, young]), partner1NonBirthChildIds: [older.Id, young.Id] };
    expect(rules({ people: [parent, older, young], families: [f] })).toEqual([]);
  });
  it("checks each partner by their own link: a step-parent isn't, the birth parent is (#982)", () => {
    const stepParent = person({ BirthDate: '1850' });
    const birthParent = person({ BirthDate: '1850' });
    const kid = person({ BirthDate: '1840' });
    const f = { ...family(stepParent, birthParent, null, [kid]), partner1NonBirthChildIds: [kid.Id] };
    const got = only({ people: [stepParent, birthParent, kid], families: [f] }, 'child_born_before_parent');
    expect(got.map((p) => p.personId)).toEqual([birthParent.Id]);
  });
});

describe('unlikely: mother over 55', () => {
  const setup = (motherBirth: string, kidBirth: string, sex = 'F') => {
    const mother = person({ Sex: sex, BirthDate: motherBirth });
    const kid = person({ BirthDate: kidBirth });
    return { people: [mother, kid], families: [family(null, mother, null, [kid])], mother };
  };
  it("flags a mother of 56, editing her birth", () => {
    const { mother, ...input } = setup('1802-03-01', '1858-03-01');
    const [problem] = run(input);
    expect(problem).toMatchObject({ rule: 'mother_too_old', threshold: 55, personId: mother.Id, editable: [`PersonBirth:${mother.Id}`] });
  });
  it("doesn't flag a mother at exactly 55, or one day short of 56", () => {
    expect(rules(setup('1802-03-01', '1857-03-01'))).toEqual([]);
    expect(rules(setup('1802-03-01', '1858-02-28'))).toEqual([]);
  });
  it("doesn't flag a father, or an approximate birth that could make her 55", () => {
    expect(rules(setup('1802', '1870', 'M'))).toEqual([]);
    expect(rules(setup('ABT 1802', '1858'))).toEqual([]);
  });
  it('flags a birth child of a 58-year-old mother but not an adopted one (#841)', () => {
    const mother = person({ Sex: 'F', BirthDate: '1800' });
    const born = person({ BirthDate: '1858' });
    const adopted = person({ BirthDate: '1858' });
    const f = { ...family(null, mother, null, [born, adopted]), partner2NonBirthChildIds: [adopted.Id] };
    const got = only({ people: [mother, born, adopted], families: [f] }, 'mother_too_old');
    expect(got).toHaveLength(1);
    expect(got[0].relatedPersonIds).toEqual([born.Id]);
  });
});

describe('unlikely: married under 12', () => {
  it("flags it, editing the partner's birth", () => {
    const a = person({ BirthDate: '1835' });
    const [problem] = run({ people: [a], families: [family(a, null, '1842')] });
    expect(problem).toMatchObject({ rule: 'married_too_young', threshold: 12, editable: [`PersonBirth:${a.Id}`] });
  });
  it("doesn't flag 12 or older", () => {
    const a = person({ BirthDate: '1830-01-01' });
    expect(rules({ people: [a], families: [family(a, null, '1842-01-01')] })).toEqual([]);
  });
});

describe('unlikely: age at death over 110', () => {
  it('flags 111, editing the birth', () => {
    const p = person({ BirthDate: '1700-01-01', DeathDate: '1811-01-01' });
    const [problem] = run({ people: [p] });
    expect(problem).toMatchObject({ rule: 'died_too_old', threshold: 110, editable: [`PersonBirth:${p.Id}`] });
  });
  it("doesn't flag 110 or an approximate birth that could make it 110", () => {
    expect(rules({ people: [person({ BirthDate: '1700-01-01', DeathDate: '1810-12-31' })] })).toEqual([]);
    expect(rules({ people: [person({ BirthDate: 'ABT 1700', DeathDate: '1813' })] })).toEqual([]);
  });
  it('uses a baptism as the bound when the birth is missing', () => {
    const p = person({ DeathDate: '1811-06-01' });
    expect(rules({ people: [p], events: [event(p.Id, 'BAPM', '1700-01-01')] })).toEqual(['died_too_old']);
  });
});

describe('unlikely: marked living but born more than 110 years ago', () => {
  it('flags it with nothing editable: the fix is the living flag', () => {
    const p = person({ BirthDate: '1915-09-25', IsDeceased: 0 });
    const [problem] = runDataChecks({ people: [p], events: [], families: [] }, { today: TODAY });
    expect(problem).toMatchObject({ rule: 'living_too_old', threshold: 110, editable: [] });
  });
  it("doesn't flag 110, someone not marked living, or someone with a death date", () => {
    const check = (o: Partial<DataCheckPerson>) => runDataChecks({ people: [person(o)], events: [], families: [] }, { today: TODAY });
    expect(check({ BirthDate: '1915-09-27', IsDeceased: 0 })).toEqual([]);
    expect(check({ BirthDate: '1800', IsDeceased: null })).toEqual([]);
    expect(check({ BirthDate: '1800', IsDeceased: 0, DeathDate: '(unknown)' })).toEqual([]);
  });
});

describe('record shape: dates the checks can’t read', () => {
  it('flags an unreadable stored value on a person, an event and a family', () => {
    const a = person({ BirthDate: 'sometime in spring' });
    const b = person({});
    const f = family(b, a, 'ABT the fire');
    const e = event(a.Id, 'RESI', '1850-02-30');
    const problems = run({ people: [a, b], families: [f], events: [e] });
    expect(problems.map((p) => [p.rule, p.kind, p.personId])).toEqual([
      ['unreadable_date', 'unreadable', a.Id],
      ['unreadable_date', 'unreadable', b.Id],
    ]);
    expect(problems[0].editable).toEqual([`PersonBirth:${a.Id}`, `Events:${e.Id}`]);
    expect(problems[1]).toMatchObject({ editable: [`Families:${f.Id}`], familyIds: [f.Id], threshold: null });
  });
  it("skips GEDCOM date phrases and readable values", () => {
    const a = person({ BirthDate: '(the winter of the great frost)', DeathDate: 'INT 1850 (from the stone)' });
    expect(rules({ people: [a], events: [event(a.Id, 'CENS', 'BET 1841 AND 1842')] })).toEqual([]);
  });
  it('reads dual years and B.C. dates, and checks them (#971)', () => {
    const a = person({ BirthDate: '13 JAN 1712/13', DeathDate: '1780' });
    const b = person({ BirthDate: 'ABT 70 BC', DeathDate: '19 AD' });
    expect(rules({ people: [a, b] })).toEqual([]);
    // Readable now, so the event rules see a B.C. death before a B.C. birth.
    expect(rules({ people: [person({ BirthDate: '44 B.C.', DeathDate: '100 BC' })] })).toEqual(['death_before_birth']);
  });
  it('still lists a calendar escape as unreadable', () => {
    expect(rules({ people: [person({ BirthDate: '@#DJULIAN@ 11 FEB 1712' })] })).toEqual(['unreadable_date']);
  });
});

describe('output order', () => {
  it('lists impossible rules in rule order, then by person', () => {
    const a = person({ BirthDate: '1850', DeathDate: '1840' });
    const b = person({ DeathDate: '1871' });
    const got = run({ people: [b, a], events: [event(b.Id, 'CENS', '1881')] });
    expect(got.map((p) => p.id)).toEqual([`death_before_birth:${a.Id}`, `event_after_death:${b.Id}`]);
  });
});
