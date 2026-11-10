import { describe, expect, it } from 'vitest';
import { generateGedcom } from '@/lib/gedcom/generator';
import { parseGedcom } from '@/lib/gedcom/parser';
import type { PersonWithRelations } from '@/lib/db/schema';

function personWithEvents(events: Array<Record<string, unknown>>): PersonWithRelations {
  return {
    Id: 1,
    FirstName: 'John',
    LastName: 'Doe',
    Sex: 'M',
    BirthDate: null,
    BirthPlace: null,
    DeathDate: null,
    DeathPlace: null,
    IsDeceased: null,
    events,
  } as unknown as PersonWithRelations;
}

function event(id: number, type: string, description: string | null, extra: Record<string, unknown> = {}) {
  return {
    Id: id,
    UserId: 1,
    Type: type,
    Description: description,
    Date: null,
    Place: null,
    PersonId: 1,
    FamilyId: null,
    ...extra,
  };
}

describe('person-event Description export (#561)', () => {
  it('keeps only OCCU and EDUC descriptions on the level-1 event line', () => {
    const out = generateGedcom([personWithEvents([
      event(1, 'ADOP', 'adoption detail'),
      event(2, 'OCCU', 'Blacksmith'),
      event(3, 'EDUC', 'University of Example'),
      event(4, 'RESI', 'Lived in the north ward'),
      event(5, 'Land Lease', 'custom event detail'),
    ])], []);

    expect(out).toContain('1 ADOP\n2 NOTE adoption detail');
    expect(out).not.toContain('1 ADOP adoption detail');
    expect(out).toContain('1 OCCU Blacksmith');
    expect(out).toContain('1 EDUC University of Example');
    expect(out).toContain('1 RESI\n2 NOTE Lived in the north ward');
    expect(out).not.toContain('1 RESI Lived in the north ward');
    expect(out).toContain('1 EVEN\n2 TYPE Land Lease\n2 NOTE custom event detail');
    expect(out).not.toContain('1 EVEN custom event detail');
  });

  it('round-trips affected descriptions separately from linked event notes', () => {
    const out = generateGedcom([personWithEvents([
      event(10, 'ADOP', 'Adopted by the Example family'),
      event(11, 'RESI', 'Lived in the north ward'),
      event(12, 'Land Lease', 'Custom event detail'),
    ])], [], undefined, {
      notes: [{ Id: 99, Text: 'County adoption register' }],
      noteLinks: [{ NoteId: 99, OwnerTable: 'Events', OwnerId: 11 }],
    });

    const outputLines = out.split('\n');
    const resiLines = outputLines.slice(outputLines.indexOf('1 RESI')).join('\n');
    expect(resiLines).toContain('2 NOTE Lived in the north ward');
    expect(resiLines).toContain('2 NOTE @N1@');
    expect(out.match(/^0 @N\d+@ NOTE County adoption register$/gm)).toHaveLength(1);

    const parsed = parseGedcom(out).people[0];
    const adop = parsed.events.find((e) => e.Type === 'ADOP');
    const resi = parsed.events.find((e) => e.Type === 'RESI');
    const custom = parsed.events.find((e) => e.Type === 'Land Lease');
    expect(adop?.Description).toBe('Adopted by the Example family');
    expect(adop?.notes).toEqual([]);
    expect(resi?.Description).toBe('Lived in the north ward');
    expect(resi?.notes.map((note) => note.text)).toEqual(['County adoption register']);
    expect(custom?.Description).toBe('Custom event detail');
    expect(custom?.notes).toEqual([]);
  });

  it('preserves long and multiline affected descriptions with CONC and CONT', () => {
    const firstLine = 'A'.repeat(300);
    const description = `${firstLine}\nSecond line of the adoption detail`;
    const out = generateGedcom([personWithEvents([event(20, 'ADOP', description)])], []);

    expect(out).toMatch(/^2 NOTE A+$/m);
    expect(out).toContain('3 CONC ');
    expect(out).toContain('3 CONT Second line of the adoption detail');

    const parsed = parseGedcom(out).people[0];
    expect(parsed.events[0].Description).toBe(description);
  });

  it('keeps fallback BIRT and DEAT event dates and descriptions', () => {
    const out = generateGedcom([personWithEvents([
      event(30, 'BIRT', 'Birth detail', { Date: '1901-01-02' }),
      event(31, 'DEAT', 'Death detail', { Date: '1980-02-03' }),
    ])], []);

    expect(out).toContain('1 BIRT\n2 NOTE Birth detail\n2 DATE 2 JAN 1901');
    expect(out).toContain('1 DEAT\n2 NOTE Death detail\n2 DATE 3 FEB 1980');
    expect(out).not.toContain('1 BIRT Birth detail');
    expect(out).not.toContain('1 DEAT Death detail');

    const parsed = parseGedcom(out).people[0];
    expect(parsed.BirthDate).toBe('1901-01-02');
    expect(parsed.DeathDate).toBe('1980-02-03');
    expect(parsed.notes.map((note) => note.text)).toEqual(['Birth detail', 'Death detail']);
  });
});
