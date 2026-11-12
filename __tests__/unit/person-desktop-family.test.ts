import { describe, expect, it } from 'vitest';
import type { Family, LinkedChild, Person, PersonWithRelations } from '@/lib/db/schema';
import { desktopFamily, siblingKind } from '@/app/people/view/desktop/family';

/** The desktop person rail's family blocks (#49): siblings by family, derived kinds, roles. */

const person = (Id: number, FirstName: string, Sex: string | null, BirthDate: string | null = null): Person =>
  ({ Id, FirstName, LastName: 'Lind', Sex, BirthDate, DeathDate: null } as unknown as Person);
const family = (Id: number, Partner1Id: number | null, Partner2Id: number | null, extra: Partial<Family> = {}): Family =>
  ({ Id, Partner1Id, Partner2Id, MarriageDate: null, MarriagePlace: null, UserId: 1, UpdatedAt: null, ...extra } as Family);
const child = (p: Person, l1: string | null, l2: string | null): LinkedChild => ({ ...p, Partner1Relationship: l1, Partner2Relationship: l2 });

const johan = person(1, 'Johan', 'M');
const kristina = person(2, 'Kristina', 'F');
const per = person(3, 'Per', 'M');
const anna = person(10, 'Anna', 'F', '1868');
const erik = person(11, 'Erik', 'M', '1866');
const maja = person(12, 'Maja', 'F', '1870');
const nils = person(13, 'Nils', 'M', '1872');

describe('siblingKind', () => {
  const both = { partner1: true, partner2: true };
  it('is full when both share every recorded parent, unknown links included', () => {
    expect(siblingKind({ Partner1Relationship: 'Birth', Partner2Relationship: 'Birth' }, { Partner1Relationship: 'Birth', Partner2Relationship: null }, both)).toBe('full');
  });
  it('is half when they share one parent', () => {
    expect(siblingKind({ Partner1Relationship: 'Birth', Partner2Relationship: 'Birth' }, { Partner1Relationship: 'Step', Partner2Relationship: 'Birth' }, both)).toBe('half');
  });
  it('is step when they share none', () => {
    expect(siblingKind({ Partner1Relationship: 'Step', Partner2Relationship: 'Birth' }, { Partner1Relationship: 'Birth', Partner2Relationship: 'Step' }, both)).toBe('step');
  });
  it('only counts the parents the family has', () => {
    expect(siblingKind({ Partner1Relationship: 'Birth', Partner2Relationship: 'Step' }, { Partner1Relationship: 'Birth', Partner2Relationship: 'Birth' }, { partner1: true, partner2: false })).toBe('full');
  });
});

describe('desktopFamily', () => {
  const p: PersonWithRelations = {
    ...anna,
    parents: [
      {
        family: family(100, johan.Id, kristina.Id), father: johan, mother: kristina,
        partner1Relationship: 'Birth', partner2Relationship: 'Birth',
        siblings: [child(maja, 'Birth', 'Birth'), child(erik, 'Step', 'Birth')],
      },
      {
        family: family(101, per.Id, kristina.Id), father: per, mother: kristina,
        partner1Relationship: 'Adoption', partner2Relationship: 'Adoption',
        // Maja comes through both families; she shows once, in the first.
        siblings: [child(maja, 'Birth', 'Birth'), child(nils, 'Birth', 'Step')],
      },
    ],
    spouses: [
      { family: family(200, anna.Id, null, { Type: 'Marriage' }), person: null, children: [child(nils, 'Adoption', null), child(erik, 'Birth', null)] },
    ],
  } as unknown as PersonWithRelations;

  const f = desktopFamily(p);

  it('keeps siblings inside their parent family, each once, in birth order', () => {
    expect(f.parentBlocks.map((b) => b.siblings.map((s) => [s.person.FirstName, s.kind]))).toEqual([
      [['Erik', 'half'], ['Maja', 'full']],
      [['Nils', 'half']],
    ]);
  });

  it('names a type in the heading only when both parents share the link', () => {
    expect(f.parentBlocks.map((b) => b.headingLink)).toEqual([null, 'adoption']);
    // Under a typed heading the rows don't repeat the link.
    expect(f.parentBlocks[1].parents.map((x) => [x.role, x.link])).toEqual([['father', null], ['mother', null]]);
  });

  it('gives a row its role when the parents differ', () => {
    const mixed = desktopFamily({
      ...p,
      parents: [{ ...p.parents![0], partner1Relationship: 'Step', partner2Relationship: 'Birth' }],
    } as PersonWithRelations);
    expect(mixed.parentBlocks[0].headingLink).toBeNull();
    expect(mixed.parentBlocks[0].parents.map((x) => [x.role, x.link])).toEqual([['father', 'step'], ['mother', null]]);
  });

  it('tags a child by this person’s own link, and an unknown partner keeps the block', () => {
    const b = f.partnerBlocks[0];
    expect(b.partner).toBeNull();
    expect(b.type).toBe('Marriage');
    expect(b.children.map((c) => [c.person.FirstName, c.role])).toEqual([['Nils', 'adopted'], ['Erik', null]]);
  });
});
