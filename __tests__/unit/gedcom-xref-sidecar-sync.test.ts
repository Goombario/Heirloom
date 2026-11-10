import { describe, it, expect } from 'vitest';
import { assignPersonXrefs, generateGedcom } from '@/lib/gedcom/generator';
import type { PersonWithRelations } from '@/lib/db/schema';

function person(Id: number, GedcomId: string | null, FirstName: string): PersonWithRelations {
  return {
    Id, GedcomId, FirstName, LastName: 'Test', Sex: 'M', events: [],
    familiesAsSpouse: [], familiesAsChild: [], media: [],
  } as unknown as PersonWithRelations;
}

describe('assignPersonXrefs matches the xrefs generateGedcom actually emits', () => {
  // A GEDCOM-imported tree: some people carry a stored GedcomId, some (added by
  // hand afterwards) do not. Index-based reconstruction is correct ONLY when all
  // are null, which is why no existing fixture caught the desync.
  const people = [
    person(10, '@I7@', 'Stored'),
    person(11, null, 'Fresh'),
    person(12, '@I2@', 'AlsoStored'),
  ];

  it('assigns the stored GedcomId where usable and a free xref otherwise', () => {
    const map = assignPersonXrefs(people);
    expect(map.get(10)).toBe('@I7@');
    expect(map.get(12)).toBe('@I2@');
    // 11 must get a fresh xref that collides with neither @I7@ nor @I2@.
    expect(map.get(11)).toBe('@I1@');
  });

  it('agrees with the INDI xrefs the generator emits', () => {
    const map = assignPersonXrefs(people);
    const ged = generateGedcom(people, []);
    for (const [dbId, xref] of map) {
      const name = people.find(p => p.Id === dbId)!.FirstName;
      const record = ged.split('\n0 ').find(block => block.startsWith(`${xref} INDI`));
      expect(record, `no INDI record for ${xref}`).toBeDefined();
      expect(record).toContain(`1 NAME ${name} /Test/`);
    }
  });

  it('falls back to a fresh xref when a stored GedcomId is duplicated', () => {
    const dupes = [person(1, '@I5@', 'A'), person(2, '@I5@', 'B')];
    const map = assignPersonXrefs(dupes);
    expect(map.get(1)).not.toBe(map.get(2));
    expect(new Set(map.values()).size).toBe(2);
  });
});
