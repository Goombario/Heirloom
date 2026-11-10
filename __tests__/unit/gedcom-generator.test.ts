import { describe, it, expect } from 'vitest';
import { generateGedcom } from '@/lib/gedcom/generator';
import { parseGedcom } from '@/lib/gedcom/parser';
import type { PersonWithRelations, FamilyWithRelations } from '@/lib/db/schema';

function makePerson(overrides: Partial<PersonWithRelations> = {}): PersonWithRelations {
  return {
    Id: 1,
    UserId: 1,
    FirstName: 'John',
    LastName: 'Smith',
    Sex: 'M',
    GedcomId: null,
    BirthDate: null,
    BirthPlace: null,
    DeathDate: null,
    DeathPlace: null,
    IsDeceased: null,
    UpdatedAt: null,
    EffectiveFirstName: null,
    Nickname: null,
    ...overrides,
  };
}

function makeFamily(overrides: Partial<FamilyWithRelations> = {}): FamilyWithRelations {
  return {
    Id: 1,
    UserId: 1,
    Partner1Id: null,
    Partner2Id: null,
    MarriageDate: null,
    MarriagePlace: null,
    UpdatedAt: null,
    ...overrides,
  };
}

describe('generateGedcom', () => {
  it('generates valid GEDCOM header and trailer', () => {
    const output = generateGedcom([], []);
    expect(output).toContain('0 HEAD');
    expect(output).toContain('2 VERS 5.5.1');
    expect(output).toContain('1 CHAR UTF-8');
    expect(output).toContain('0 TRLR');
  });

  it('generates person INDI record with name', () => {
    const person = makePerson({ Id: 1, FirstName: 'Jane', LastName: 'Doe' });
    const output = generateGedcom([person], []);
    expect(output).toContain('0 @I1@ INDI');
    expect(output).toContain('1 NAME Jane /Doe/');
  });

  it('emits GIVN and SURN name pieces under the NAME line', () => {
    const person = makePerson({ FirstName: 'John', LastName: 'Smith' });
    const output = generateGedcom([person], []);
    expect(output).toContain('1 NAME John /Smith/');
    expect(output).toContain('2 GIVN John');
    expect(output).toContain('2 SURN Smith');
  });

  it('omits a name piece whose column is empty rather than emitting a blank one', () => {
    const person = makePerson({ FirstName: 'Mononymous', LastName: null });
    const output = generateGedcom([person], []);
    expect(output).toContain('2 GIVN Mononymous');
    expect(output).not.toContain('2 SURN');
  });

  it('round-trips names unchanged with the pieces present', () => {
    const person = makePerson({ FirstName: 'Anna Maria', LastName: 'van der Berg' });
    const output = generateGedcom([person], []);
    const parsed = parseGedcom(output).people[0];
    expect(parsed.FirstName).toBe('Anna Maria');
    expect(parsed.LastName).toBe('van der Berg');
  });

  it('generates SEX tag', () => {
    const person = makePerson({ Sex: 'F' });
    const output = generateGedcom([person], []);
    expect(output).toContain('1 SEX F');
  });

  it('generates birth date and place', () => {
    const person = makePerson({
      BirthDate: '1920-03-15',
      BirthPlace: 'Anytown, USA',
    });
    const output = generateGedcom([person], []);
    expect(output).toContain('1 BIRT');
    expect(output).toContain('2 DATE 15 MAR 1920');
    expect(output).toContain('2 PLAC Anytown, USA');
  });

  it('generates death date and place', () => {
    const person = makePerson({
      DeathDate: '2005-06-20',
      DeathPlace: 'Othertown, USA',
    });
    const output = generateGedcom([person], []);
    expect(output).toContain('1 DEAT');
    expect(output).toContain('2 DATE 20 JUN 2005');
    expect(output).toContain('2 PLAC Othertown, USA');
  });

  // A cause alone is enough to constitute a death record on export. The view
  // layer and the vital delete patch both depend on this: a DeathCause left
  // behind would resurrect a death the user believes they removed.
  it('emits a DEAT block with CAUS for a cause-only person (no date, place or flag)', () => {
    const person = makePerson({ DeathCause: 'Heart failure' });
    const output = generateGedcom([person], []);
    expect(output).toContain('1 DEAT');
    expect(output).not.toContain('1 DEAT Y');
    expect(output).toContain('2 CAUS Heart failure');
  });

  it('generates DEAT Y for deceased without date/place', () => {
    const person = makePerson({ IsDeceased: 1 });
    const output = generateGedcom([person], []);
    expect(output).toContain('1 DEAT Y');
  });

  it('generates _LIVING Y for explicitly living person, never DEAT N', () => {
    // 5.5.1 forbids an N value on an event line and directs that a different
    // tag be defined (ged551-4.txt:409-410). "1 DEAT N" reads as a death to a
    // conforming importer.
    const person = makePerson({ IsDeceased: 0 });
    const output = generateGedcom([person], []);
    expect(output).toContain('1 _LIVING Y');
    expect(output).not.toContain('1 DEAT N');
  });

  it('generates family FAM record with husband, wife, children', () => {
    const husband = makePerson({ Id: 1, FirstName: 'John', LastName: 'Doe' });
    const wife = makePerson({ Id: 2, FirstName: 'Jane', LastName: 'Doe', Sex: 'F' });
    const child = makePerson({ Id: 3, FirstName: 'Junior', LastName: 'Doe' });

    const family = makeFamily({
      Id: 1,
      Partner1Id: 1,
      Partner2Id: 2,
      children: [child],
    });

    const output = generateGedcom([husband, wife, child], [family]);
    expect(output).toContain('0 @F1@ FAM');
    expect(output).toContain('1 HUSB @I1@');
    expect(output).toContain('1 WIFE @I2@');
    expect(output).toContain('1 CHIL @I3@');
  });

  it('generates marriage date and place', () => {
    const family = makeFamily({
      MarriageDate: '1940-06-10',
      MarriagePlace: 'Somewhere, USA',
    });
    const output = generateGedcom([], [family]);
    expect(output).toContain('1 MARR');
    expect(output).toContain('2 DATE 10 JUN 1940');
    expect(output).toContain('2 PLAC Somewhere, USA');
  });

  it('emits the marriage anchor alongside a standard divorce event', () => {
    const family = makeFamily({
      MarriageDate: '1930-06-20',
      events: [{ Id: 1, UserId: 1, Type: 'DIV', Date: '1942', Place: null, Description: null, PersonId: null, FamilyId: 1 }],
    });
    const output = generateGedcom([], [family]);
    expect(output).toContain('1 MARR');
    expect(output).toContain('2 DATE 20 JUN 1930');
    expect(output).toContain('1 DIV');
    expect(output).toContain('2 DATE 1942');
    // The retired column extension is no longer emitted.
    expect(output).not.toContain('_ENDREASON');
    expect(output).not.toContain('_ENDED');
  });

  it('emits a dateless annulment event as a bare "1 ANUL"', () => {
    const output = generateGedcom([], [makeFamily({
      events: [{ Id: 1, UserId: 1, Type: 'ANUL', Date: null, Place: null, Description: null, PersonId: null, FamilyId: 1 }],
    })]);
    expect(output).toMatch(/^1 ANUL$/m);
  });

  it('round-trips a divorce event through generate then parse', () => {
    const family = makeFamily({
      MarriageDate: '1930-06-20',
      events: [{ Id: 1, UserId: 1, Type: 'DIV', Date: '1942', Place: null, Description: null, PersonId: null, FamilyId: 1 }],
    });
    const parsed = parseGedcom(generateGedcom([], [family])).families[0];
    expect(parsed.MarriageDate).toBe('1930-06-20');
    const div = parsed.events.find((e) => e.Type === 'DIV');
    expect(div?.Date).toBe('1942');
  });

  it('emits a standard family-event tag for a divorce Events row', () => {
    const family = makeFamily({
      events: [{ Id: 1, UserId: 1, Type: 'DIV', Date: '1984', Place: 'Glasgow', Description: null, PersonId: null, FamilyId: 1 }],
    });
    const output = generateGedcom([], [family]);
    expect(output).toMatch(/^1 DIV/m);
    expect(output).toContain('2 DATE 1984');
  });

  it('rides a non-standard family event (SEPA) on a generic 1 EVEN + 2 TYPE', () => {
    const family = makeFamily({
      events: [{ Id: 1, UserId: 1, Type: 'SEPA', Date: '1990', Place: null, Description: null, PersonId: null, FamilyId: 1 }],
    });
    const output = generateGedcom([], [family]);
    expect(output).toContain('1 EVEN');
    expect(output).toContain('2 TYPE SEPA');
  });

  it('does not double-emit 1 MARR for a stray MARR Events row (anchor is column-owned)', () => {
    const family = makeFamily({
      MarriageDate: '1940-06-10',
      events: [{ Id: 1, UserId: 1, Type: 'MARR', Date: '1940-06-10', Place: null, Description: null, PersonId: null, FamilyId: 1 }],
    });
    const output = generateGedcom([], [family]);
    expect(output.match(/^1 MARR/gm) ?? []).toHaveLength(1);
  });

  it('round-trips passthrough RawGedcom through generate then parse (Slice 0p)', () => {
    // A kept pointer is stored as the record's id (#979).
    const person = makePerson({ RawGedcom: '1 TITL Sir\n1 ASSO @~I:2@\n2 RELA Godfather' });
    const godfather = makePerson({ Id: 2, FirstName: 'Gus', GedcomId: '@I2@' });
    const out = generateGedcom([person, godfather], []);
    // the verbatim subtrees are re-emitted under the INDI record
    expect(out).toContain('1 TITL Sir');
    expect(out).toContain('1 ASSO @I2@');
    expect(out).toContain('2 RELA Godfather');
    // and survive a re-parse (lossless round-trip of unmodeled tags)
    const reparsed = parseGedcom(out).people[0];
    expect(reparsed.rawLines).toContain('1 TITL Sir');
    expect(reparsed.rawLines).toContain('2 RELA Godfather');
  });

  it('names a kept pointer by the xref this export gave its record (#979)', () => {
    const person = makePerson({ RawGedcom: '1 ASSO @~I:2@\n2 RELA Godfather\n1 _CUSTOM @~S:9@\n1 TITL Sir' });
    // Stored GedcomId @I1@ is taken, so the godfather gets a fresh xref.
    const godfather = makePerson({ Id: 2, FirstName: 'Gus', GedcomId: '@I1@' });
    const out = generateGedcom([person, godfather], []);
    const xref = /^0 (@[^@]+@) INDI\n1 NAME Gus/m.exec(out)?.[1];
    expect(xref).toBeDefined();
    expect(out).toContain(`1 ASSO ${xref}\n2 RELA Godfather`);
    // A source the export doesn't hold: the line goes, the rest stays.
    expect(out).not.toContain('_CUSTOM');
    expect(out).toContain('1 TITL Sir');
  });

  it('drops a pointer line whose xref the file never defines, with its sub-lines (#979)', () => {
    const person = makePerson({ RawGedcom: '1 ASSO @I99@\n2 RELA Godfather\n1 TITL Sir' });
    const out = generateGedcom([person], []);
    expect(out).not.toContain('@I99@');
    expect(out).not.toContain('RELA');
    expect(out).toContain('1 TITL Sir');
  });

  it('emits nothing extra when RawGedcom is empty/absent', () => {
    const out = generateGedcom([makePerson({})], []);
    expect(out).toContain('0 @I1@ INDI');
    expect(out).not.toContain('undefined');
  });

  // People."Notes" was dropped in #524 / ADR 0010, so a person's note reaches the
  // file only through the shared Note + NoteLink path — same as every other owner.
  it('generates notes', () => {
    const output = generateGedcom([makePerson({ Id: 1 })], [], undefined, {
      notes: [{ Id: 5, Text: 'A note about this person' }],
      noteLinks: [{ NoteId: 5, OwnerTable: 'People', OwnerId: 1 }],
    });
    expect(output).toContain('1 NOTE @N1@');
    expect(output).toContain('0 @N1@ NOTE A note about this person');
  });

  it('emits a birth fact note even when the birth has no date or place', () => {
    const output = generateGedcom([makePerson({ Id: 1 })], [], undefined, {
      notes: [{ Id: 5, Text: 'Birth note' }],
      noteLinks: [{ NoteId: 5, OwnerTable: 'People', OwnerId: 1, OwnerFact: 'Birth' }],
    });
    const lines = output.split('\n');
    const birt = lines.indexOf('1 BIRT');
    expect(birt).toBeGreaterThanOrEqual(0);
    expect(lines[birt + 1]).toBe('2 NOTE @N1@');
  });

  it('emits a death fact note on a flag-only death', () => {
    const output = generateGedcom([makePerson({ Id: 1, IsDeceased: 1 })], [], undefined, {
      notes: [{ Id: 5, Text: 'Death note' }],
      noteLinks: [{ NoteId: 5, OwnerTable: 'People', OwnerId: 1, OwnerFact: 'Death' }],
    });
    const lines = output.split('\n');
    const deat = lines.indexOf('1 DEAT Y');
    expect(deat).toBeGreaterThanOrEqual(0);
    expect(lines[deat + 1]).toBe('2 NOTE @N1@');
  });

  it('emits a marriage fact note even when the marriage has no date or place', () => {
    const output = generateGedcom([], [makeFamily({ Id: 1 })], undefined, {
      notes: [{ Id: 5, Text: 'Marriage note' }],
      noteLinks: [{ NoteId: 5, OwnerTable: 'Families', OwnerId: 1, OwnerFact: 'Marriage' }],
    });
    const lines = output.split('\n');
    const marr = lines.indexOf('1 MARR');
    expect(marr).toBeGreaterThanOrEqual(0);
    expect(lines[marr + 1]).toBe('2 NOTE @N1@');
  });

  it('generates events', () => {
    const person = makePerson({
      events: [{
        Id: 1, UserId: 1, Type: 'OCCU', Description: 'Farmer',
        Date: '1950', Place: 'Rural County', PersonId: 1, FamilyId: null,
      }],
    });
    const output = generateGedcom([person], []);
    expect(output).toContain('1 OCCU Farmer');
    expect(output).toContain('2 DATE 1950');
    expect(output).toContain('2 PLAC Rural County');
  });

  // `Events."Date"` is one column, and a person event and a family event must not
  // disagree about how to serialise it. The person path used to emit it raw while
  // the family path went through formatDateForGedcom, so an ISO date exported as
  // `2 DATE 1960-08-09` from a person and `2 DATE 9 AUG 1960` from a family — the
  // former being invalid per DATE_GREG (`<DAY> <MONTH> <YEAR>`, MONTH in JAN..DEC:
  // GEDCOM Specs/extracted/ged551-3.txt:325-328, :703-707) and, since the parser
  // stores event dates verbatim, leaving the column with mixed formats.
  it('emits the same DATE line for a person event and a family event with the same stored date', () => {
    const stored = '1960-08-09';
    const person = makePerson({
      Id: 1,
      events: [{
        Id: 1, UserId: 1, Type: 'RESI', Description: null,
        Date: stored, Place: null, PersonId: 1, FamilyId: null,
      }],
    });
    const family = makeFamily({
      Id: 1, Partner1Id: 1,
      events: [{
        Id: 2, UserId: 1, Type: 'DIV', Description: null,
        Date: stored, Place: null, PersonId: null, FamilyId: 1,
      }],
    });
    const out = generateGedcom([person], [family]);

    const dateLines = (out.match(/^2 DATE .*$/gm) ?? []).map(l => l.trim());
    expect(dateLines).toHaveLength(2);
    expect(new Set(dateLines).size, `person and family disagree: ${dateLines.join(' | ')}`).toBe(1);
    expect(dateLines[0]).toBe('2 DATE 9 AUG 1960');
  });

  it('generates media (OBJE) records', () => {
    const output = generateGedcom([makePerson()], [], undefined, {
      media: [{ Id: 1, Title: 'Portrait', FilePath: 'photo.jpg', Format: 'jpeg' }],
      mediaLinks: [{ MediaId: 1, OwnerTable: 'People', OwnerId: 1, IsPrimary: 1 }],
    });
    expect(output).toContain('1 OBJE @O1@');
    expect(output).toContain('0 @O1@ OBJE');
    expect(output).toContain('1 FILE media/O1-portrait.jpg');
    expect(output).toContain('2 FORM jpeg');
    expect(output).toContain('2 TITL Portrait');
    expect(output).toContain('1 _PRIM @I1@');
    expect(output).not.toMatch(/^1 _PRIM [YN]$/m);
  });

  it('assigns sequential GEDCOM IDs regardless of internal IDs', () => {
    const p1 = makePerson({ Id: 42, FirstName: 'Alpha', LastName: 'One' });
    const p2 = makePerson({ Id: 99, FirstName: 'Beta', LastName: 'Two' });
    const output = generateGedcom([p1, p2], []);
    expect(output).toContain('0 @I1@ INDI');
    expect(output).toContain('0 @I2@ INDI');
  });

  it('emits NICK and _AKA tags from name variants', () => {
    const person = makePerson({ Id: 1 });
    const output = generateGedcom([person], [], undefined, {
      nameVariants: [
        { Id: 10, PersonId: 1, Type: 'Nickname', Name: 'Bill' },
        { Id: 11, PersonId: 1, Type: 'Alias', Name: 'William the Elder' },
      ],
    });
    // A nickname is a NAME piece in 5.5.1, so it goes under the primary name (#964).
    expect(output).toMatch(/1 NAME [^\n]*\n(2 (GIVN|SURN) [^\n]*\n)*2 NICK Bill\n/);
    expect(output).not.toContain('1 NICK');
    expect(output).toContain('1 _AKA William the Elder');
  });

  it('does not emit variants belonging to a different person', () => {
    const person = makePerson({ Id: 1 });
    const output = generateGedcom([person], [], undefined, {
      nameVariants: [{ Id: 10, PersonId: 999, Type: 'Nickname', Name: 'Someone Else' }],
    });
    expect(output).not.toContain('NICK');
  });

  // Legacy path: imports predating the NameVariant promotion stored NICK/_AKA as
  // text inside People."Notes". The column is gone (#524 / ADR 0010) but the
  // init-schema backfill mirrored that text into a Note row, so the extraction
  // reads it from there instead. Those rows must still round-trip.
  it('emits NICK and _AKA tags from prefixed lines in a backfilled note', () => {
    const output = generateGedcom([makePerson({ Id: 1 })], [], undefined, {
      notes: [{ Id: 5, Text: 'NICK: Bill\n_AKA: William the Elder\nA plain note', BackfilledFromPersonId: 1 }],
      noteLinks: [{ NoteId: 5, OwnerTable: 'People', OwnerId: 1 }],
    });
    expect(output).toContain('1 NICK Bill');
    expect(output).toContain('1 _AKA William the Elder');
    expect(output).toContain('0 @N1@ NOTE A plain note');
    // The prefixed lines should not also appear as NOTE text.
    expect(output).not.toContain('NICK: Bill');
  });

  it('emits focal-point custom tags only when non-default', () => {
    const output = generateGedcom([makePerson()], [], undefined, {
      media: [{ Id: 1, Title: 'Crop', FilePath: 'p.jpg', Format: 'jpeg', FocalX: 30, FocalY: 70, FocalRadius: 25 }],
      mediaLinks: [{ MediaId: 1, OwnerTable: 'People', OwnerId: 1, IsPrimary: 1 }],
    });
    expect(output).toContain('1 _FOCALX 30');
    expect(output).toContain('1 _FOCALY 70');
    expect(output).toContain('1 _FOCALR 25');
  });

  it('omits focal tags at the default center (50,50)', () => {
    const output = generateGedcom([makePerson()], [], undefined, {
      media: [{ Id: 1, Title: 'Centered', FilePath: 'p.jpg', Format: 'jpeg', FocalX: 50, FocalY: 50 }],
      mediaLinks: [{ MediaId: 1, OwnerTable: 'People', OwnerId: 1, IsPrimary: 1 }],
    });
    expect(output).not.toContain('_FOCALX');
    expect(output).not.toContain('_FOCALY');
  });

  it('emits _FTYPE for a non-default family type (ended-status columns retired)', () => {
    const family = makeFamily({ Type: 'Civil union' });
    const output = generateGedcom([], [family]);
    expect(output).toContain('1 _FTYPE Civil union');
    expect(output).not.toContain('_ENDED');
    expect(output).not.toContain('_ENDREASON');
  });

  it('omits _FTYPE for the default Marriage type', () => {
    const family = makeFamily({ Type: 'Marriage' });
    const output = generateGedcom([], [family]);
    expect(output).not.toContain('_FTYPE');
  });

  // Child relationship type moved from a custom `2 _RELTYPE` under FAM.CHIL to the
  // standard `2 PEDI` under the child's own INDI.FAMC (ADR 0012). Full coverage of
  // the mapping lives in gedcom-pedi.test.ts.
  it('emits PEDI on the child FAMC link for a non-Birth relationship', () => {
    const parent = makePerson({ Id: 1, FirstName: 'Adoptive', LastName: 'Parent' });
    const child = makePerson({ Id: 2, FirstName: 'Adopted', LastName: 'Kid' });
    const family = makeFamily({ Id: 1, Partner1Id: 1, children: [{ ...child, Partner1Relationship: 'Adoption', Partner2Relationship: 'Adoption' }] });
    const output = generateGedcom([parent, { ...child, familiesAsChild: [family] }], [family]);
    expect(output).toContain('1 CHIL @I2@');
    expect(output).toContain('2 PEDI adopted');
    expect(output).not.toContain('_RELTYPE');
  });

  it('omits PEDI for Birth children', () => {
    const child = makePerson({ Id: 2, FirstName: 'Born', LastName: 'Kid' });
    const family = makeFamily({ Id: 1, children: [{ ...child, Partner1Relationship: 'Birth', Partner2Relationship: 'Birth' }] });
    const output = generateGedcom([{ ...child, familiesAsChild: [family] }], [family]);
    expect(output).not.toContain('PEDI');
  });

  it('emits a shared NOTE record + pointer for a family note, and round-trips it (Slice 1)', () => {
    const family = makeFamily({ Id: 7 });
    const out = generateGedcom([], [family], undefined, {
      notes: [{ Id: 11, Text: 'Married in secret\nthen publicly' }],
      noteLinks: [{ NoteId: 11, OwnerTable: 'Families', OwnerId: 7 }],
    });
    // pointer on the family + a standalone shared record
    expect(out).toContain('1 NOTE @N1@');
    expect(out).toContain('0 @N1@ NOTE Married in secret');
    expect(out).toContain('1 CONT then publicly');
    // re-parse: the family note resolves back to the same text
    const fam = parseGedcom(out).families[0];
    expect(fam.notes[0].text).toBe('Married in secret\nthen publicly');
  });

  // Inverted by ADR 0010 / #407. This previously asserted that People-owned note
  // links emit NOTHING shared, on the reasoning that the inline column path owned
  // them — but generatePersonRecord never read its own owner key, so those notes
  // had no export path at all. People are now on the shared path like every other
  // owner, and as of #524 there is no column and no inline emit left.
  it('emits shared records for People-owned note links', () => {
    const out = generateGedcom([makePerson({ Id: 3 })], [], undefined, {
      notes: [{ Id: 5, Text: 'inline bio' }],
      noteLinks: [{ NoteId: 5, OwnerTable: 'People', OwnerId: 3 }],
    });
    expect(out).toContain('1 NOTE @N1@');
    expect(out).toMatch(/^0 @N1@ NOTE inline bio$/m);
    // and not ALSO inline, which would double the note on re-import
    expect(out).not.toContain('1 NOTE inline bio');
  });

  it('emits a top-level OBJE and pointer for a family photo and round-trips it (Slice 2)', () => {
    const family = makeFamily({ Id: 9 });
    const out = generateGedcom([], [family], undefined, {
      media: [{ Id: 4, Title: 'Wedding', FilePath: 'wedding.jpg', Format: 'jpeg' }],
      mediaLinks: [{ MediaId: 4, OwnerTable: 'Families', OwnerId: 9, IsPrimary: 0 }],
    });
    expect(out).toContain('1 OBJE @O1@');
    expect(out).toContain('0 @O1@ OBJE');
    expect(out).toContain('1 FILE media/O1-wedding.jpg');
    expect(out).toContain('2 FORM jpeg');
    expect(out).toContain('2 TITL Wedding');
    expect(out).not.toContain('1 OBJE\n2 FILE wedding.jpg');
    // re-parse: the family retains the shared identity pointer (Task 7 contract)
    const fam = parseGedcom(out).families[0];
    expect(fam.mediaRefs).toEqual([{ xref: '@O1@', legacyPrimary: null }]);
  });

  it('emits PLAC.FORM and round-trips it (Slice 5)', () => {
    const person = makePerson({ Id: 1, BirthPlace: 'Boston, Suffolk, Massachusetts, USA' });
    const out = generateGedcom([person], [], undefined, {
      placeForms: new Map([['Boston, Suffolk, Massachusetts, USA', 'City, County, State, Country']]),
    });
    expect(out).toContain('2 PLAC Boston, Suffolk, Massachusetts, USA');
    expect(out).toContain('3 FORM City, County, State, Country');
    const { places } = parseGedcom(out);
    expect(places.find((p) => p.name.startsWith('Boston'))?.form).toBe('City, County, State, Country');
  });

  it('emits a place NOTE pointer and round-trips it (place-note round-trip)', () => {
    const person = makePerson({ Id: 1, BirthPlace: 'Springfield, Illinois' });
    const out = generateGedcom([person], [], undefined, {
      notes: [{ Id: 21, Text: 'Founded in 1821' }],
      noteLinks: [{ NoteId: 21, OwnerTable: 'Places', OwnerId: 501 }],
      placeIdByName: new Map([['Springfield, Illinois', 501]]),
    });
    expect(out).toContain('2 PLAC Springfield, Illinois');
    expect(out).toContain('3 NOTE @N1@');
    expect(out).toContain('0 @N1@ NOTE Founded in 1821');
    // re-parse: the place note resolves back to the same text under the same name.
    const { placeNotes } = parseGedcom(out);
    expect(placeNotes.find((n) => n.name === 'Springfield, Illinois')?.text).toBe('Founded in 1821');
  });

  it('does not duplicate a shared place note across multiple referencing records (K=2)', () => {
    const personA = makePerson({ Id: 1, BirthPlace: 'London, England' });
    const personB = makePerson({ Id: 2, BirthPlace: 'London, England' });
    const out = generateGedcom([personA, personB], [], undefined, {
      notes: [{ Id: 30, Text: 'Founded by the Romans' }],
      noteLinks: [{ NoteId: 30, OwnerTable: 'Places', OwnerId: 700 }],
      placeIdByName: new Map([['London, England', 700]]),
    });
    // Both people's PLAC lines point at the same shared note record.
    const { placeNotes } = parseGedcom(out);
    const londonNotes = placeNotes.filter((n) => n.name === 'London, England');
    expect(londonNotes).toHaveLength(1);
    expect(londonNotes[0].text).toBe('Founded by the Romans');
  });

  it('emits no PLAC NOTE when the place has no linked note', () => {
    const person = makePerson({ Id: 1, BirthPlace: 'Quiet Town, Illinois' });
    const out = generateGedcom([person], [], undefined, {
      placeIdByName: new Map([['Quiet Town, Illinois', 900]]),
    });
    expect(out).toContain('2 PLAC Quiet Town, Illinois');
    expect(out).not.toContain('NOTE');
  });

  it('round-trips an approximate birth date through generate then parse (GED-4)', () => {
    const person = makePerson({ Id: 1, BirthDate: 'ABT 1850', DeathDate: 'BET 1900 AND 1905' });
    const out = generateGedcom([person], []);
    expect(out).toContain('2 DATE ABT 1850');
    expect(out).toContain('2 DATE BET 1900 AND 1905');
    const reparsed = parseGedcom(out).people[0];
    expect(reparsed.BirthDate).toBe('ABT 1850');
    expect(reparsed.DeathDate).toBe('BET 1900 AND 1905');
  });

  it('writes no _TOLDBY, and a transcript as TEXT for any source type (#470)', () => {
    const out = generateGedcom([], [], undefined, {
      sources: [{
        Id: 1, Title: 'Census page', Author: 'Grandma Rose', PublicationInfo: null, Text: null,
        Contents: 'Household of John Smith', Type: 'Census', Num: null,
        RepositoryName: null, CallNumber: null,
      }],
    });
    expect(out).toContain('1 AUTH Grandma Rose');
    expect(out).toContain('1 TEXT Household of John Smith');
    expect(out).not.toContain('_TOLDBY');
  });

  it('emits REPO record with ADDR and CALN.MEDI, and round-trips them (Slice 4)', () => {
    const out = generateGedcom([], [], undefined, {
      sources: [{
        Id: 1, Title: 'Parish register', Author: null, PublicationInfo: null, Text: null,
        Contents: null, Type: null, Num: null,
        RepositoryName: 'Diocesan Archive', CallNumber: 'MS 12/3',
        RepositoryMedi: 'Microfilm', RepositoryAddress: '1 Cathedral Close',
      }],
    });
    expect(out).toContain('1 REPO @R1@');
    expect(out).toContain('2 CALN MS 12/3');
    expect(out).toContain('3 MEDI Microfilm');
    expect(out).toMatch(/0 @R1@ REPO/);
    expect(out).toContain('1 NAME Diocesan Archive');
    expect(out).toContain('1 ADDR 1 Cathedral Close');
    // round-trip
    const src = parseGedcom(out).sources[0];
    expect(src).toMatchObject({
      RepositoryName: 'Diocesan Archive', RepositoryAddress: '1 Cathedral Close',
      CallNumber: 'MS 12/3', Medi: 'Microfilm',
    });
  });

  it('emits SOURCE_CITATION evidence fields and round-trips them (Slice 3)', () => {
    const person = makePerson({ Id: 1, FirstName: 'A', LastName: 'B' });
    const out = generateGedcom([person], [], undefined, {
      sources: [{
        Id: 1, Title: 'Reg', Author: null, PublicationInfo: null, Text: null, Contents: null,
        Type: null, Num: null, RepositoryName: null, CallNumber: null,
      }],
      citations: [{
        FactTable: 'People', FactId: 1, SourceId: 1, Page: 'p. 42', Note: null,
        Quay: '3', DataText: 'born at home', DataDate: '3 MAR 1900', Even: 'BIRT', Role: 'CHIL',
      }],
    });
    expect(out).toContain('2 EVEN BIRT');
    expect(out).toContain('3 ROLE CHIL');
    expect(out).toContain('2 DATA');
    expect(out).toContain('3 DATE 3 MAR 1900');
    expect(out).toContain('3 TEXT born at home');
    expect(out).toContain('2 QUAY 3');
    // re-parse: evidence comes back on the citation
    const cit = parseGedcom(out).people[0].citations[0];
    expect(cit).toMatchObject({ even: 'BIRT', role: 'CHIL', dataDate: '3 MAR 1900', dataText: 'born at home', quay: '3' });
  });

  it('writes a citation\'s line breaks as CONT, so its text cannot forge a GEDCOM line', () => {
    const person = makePerson({ Id: 1, FirstName: 'A', LastName: 'B' });
    const out = generateGedcom([person], [], undefined, {
      sources: [{
        Id: 1, Title: 'Reg', Author: null, PublicationInfo: null, Text: null, Contents: null,
        Type: null, Num: null, RepositoryName: null, CallNumber: null,
      }],
      citations: [{
        FactTable: 'People', FactId: 1, SourceId: 1, Page: 'folio 7\n0 @X1@ INDI', Note: 'seen\nagain',
        DataText: 'line one\nline two',
      }],
    });
    expect(out).toContain('1 SOUR @S1@\n2 PAGE folio 7\n3 CONT 0 @X1@ INDI\n2 DATA\n3 TEXT line one\n4 CONT line two\n2 NOTE seen\n3 CONT again\n');
    expect(out).not.toMatch(/^0 @X1@/m);
    const cit = parseGedcom(out).people[0].citations[0];
    expect(cit).toMatchObject({ page: 'folio 7\n0 @X1@ INDI', note: 'seen\nagain', dataText: 'line one\nline two' });
  });

  it('treats a lone CR as a line break, and keeps a pointer-shaped nickname', () => {
    const person = makePerson({ Id: 1, FirstName: 'A', LastName: 'B' });
    const out = generateGedcom([person], [], undefined, {
      sources: [{
        Id: 1, Title: 'Reg', Author: null, PublicationInfo: null, Text: null, Contents: null,
        Type: null, Num: null, RepositoryName: null, CallNumber: null,
      }],
      citations: [{ FactTable: 'People', FactId: 1, SourceId: 1, Page: 'x\r0 @I9@ INDI\r1 NAME Evil', Note: null }],
      nameVariants: [{ Id: 4, PersonId: 1, Type: 'Nickname', Name: '@x@' }],
    });
    expect(out).toContain('2 PAGE x\n3 CONT 0 @I9@ INDI\n3 CONT 1 NAME Evil\n');
    expect(out).not.toMatch(/\r/);
    expect(parseGedcom(out).people).toHaveLength(1);
    expect(out).toContain('2 NICK @@x@@\n');
  });

  it('doubles the @ of a pointer-shaped title, so export keeps it and import reads it back', () => {
    const person = makePerson({ Id: 1, FirstName: 'A', LastName: 'B' });
    const out = generateGedcom([person], [], undefined, {
      sources: [{
        Id: 1, Title: '@R1@', Author: null, PublicationInfo: null, Text: null, Contents: null,
        Type: null, Num: null, RepositoryName: null, CallNumber: null,
      }],
      citations: [{ FactTable: 'People', FactId: 1, SourceId: 1, Page: null, Note: null }],
    });
    expect(out).toContain('0 @S1@ SOUR\n1 TITL @@R1@@\n');
    expect(parseGedcom(out).sources[0].Title).toBe('@R1@');
  });

  it('does not emit duplicate People media when the canonical link is present', () => {
    const person = makePerson({ Id: 2, media: [{
      Id: 7, UserId: 1, Title: 'Portrait', FilePath: 'p.jpg', Format: 'jpeg',
      ContentType: null,
    }] });
    const out = generateGedcom([person], [], undefined, {
      media: [{ Id: 7, Title: 'Portrait', FilePath: 'p.jpg', Format: 'jpeg' }],
      mediaLinks: [{ MediaId: 7, OwnerTable: 'People', OwnerId: 2, IsPrimary: 0 }],
    });
    // The canonical pointer and one top-level definition are the only OBJE lines.
    expect(out.match(/^1 OBJE @O1@$/gm)?.length).toBe(1);
    expect(out.match(/^0 @O1@ OBJE$/gm)?.length).toBe(1);
    expect(out).not.toContain('1 OBJE\n2 FILE p.jpg');
  });

  it('emits every canonical owner as a pointer and every media row once', () => {
    const first = makePerson({
      Id: 1,
      events: [{ Id: 101, UserId: 1, Type: 'RESI', Description: null, Date: null, Place: null, PersonId: 1, FamilyId: null }],
    });
    const second = makePerson({ Id: 2, FirstName: 'Grace', LastName: 'Hopper' });
    const family = makeFamily({
      Id: 8,
      events: [{ Id: 202, UserId: 1, Type: 'DIV', Description: null, Date: null, Place: null, PersonId: null, FamilyId: 8 }],
    });
    const out = generateGedcom([first, second], [family], undefined, {
      sources: [{
        Id: 5, Title: 'Register', Author: null, PublicationInfo: null, Text: null,
        Contents: null, Type: null, Num: null,
        RepositoryName: null, CallNumber: null,
      }],
      media: [
        { Id: 30, Title: 'Ownerless', FilePath: 'library.jpg', Format: 'jpg' },
        { Id: 10, Title: 'Shared', FilePath: 'shared.jpg', Format: 'jpg' },
      ],
      mediaLinks: [
        { MediaId: 10, OwnerTable: 'People', OwnerId: 1, IsPrimary: 1 },
        { MediaId: 10, OwnerTable: 'People', OwnerId: 2, IsPrimary: 1 },
        { MediaId: 10, OwnerTable: 'Families', OwnerId: 8, IsPrimary: 0 },
        { MediaId: 10, OwnerTable: 'Sources', OwnerId: 5, IsPrimary: 0 },
        { MediaId: 10, OwnerTable: 'Events', OwnerId: 101, IsPrimary: 0 },
        { MediaId: 10, OwnerTable: 'Events', OwnerId: 202, IsPrimary: 0 },
        { MediaId: 10, OwnerTable: 'Places', OwnerId: 99, IsPrimary: 0 },
      ],
    });

    expect(out.match(/^0 @O1@ OBJE$/gm)).toHaveLength(1);
    expect(out.match(/^0 @O2@ OBJE$/gm)).toHaveLength(1);
    expect(out.match(/^1 OBJE @O1@$/gm)).toHaveLength(4); // two people + family + source
    expect(out).toContain('2 OBJE @O1@');
    expect(out).toContain('1 FILE media/O1-shared.jpg');
    expect(out).toContain('1 FILE media/O2-ownerless.jpg');
    expect(out).toContain('1 _PRIM @I1@');
    expect(out).toContain('1 _PRIM @I2@');
    expect(out).not.toContain('1 _PRIM Y');
    expect(out).not.toContain('1 _PRIM N');
    expect(out).not.toContain('OBJE @O2@');
    expect(out).not.toContain('Places:99');
    const lines = out.split('\n');
    const o1 = lines.indexOf('0 @O1@ OBJE');
    const o2 = lines.indexOf('0 @O2@ OBJE');
    expect(lines.slice(o1, o2)).toEqual([
      '0 @O1@ OBJE', '1 FILE media/O1-shared.jpg', '2 FORM jpg', '2 TITL Shared',
      '1 _PRIM @I1@', '1 _PRIM @I2@',
    ]);
    expect(lines.slice(o2, lines.indexOf('0 TRLR'))).toEqual([
      '0 @O2@ OBJE', '1 FILE media/O2-ownerless.jpg', '2 FORM jpg', '2 TITL Ownerless',
    ]);
  });

  it('does not emit a duplicate BIRT when a column and a BIRT event both exist', () => {
    const person = makePerson({
      Id: 1, BirthDate: '1901',
      events: [{ Id: 1, UserId: 1, Type: 'BIRT', Date: '1901', Place: null, Description: null, PersonId: 1, FamilyId: null }],
    });
    const out = generateGedcom([person], []);
    expect((out.match(/^1 BIRT/gm) ?? []).length).toBe(1);
  });

  it('does not emit a duplicate DEAT when a column and a DEAT event both exist', () => {
    const person = makePerson({
      Id: 1, DeathDate: '1980',
      events: [{ Id: 1, UserId: 1, Type: 'DEAT', Date: '1980', Place: null, Description: null, PersonId: 1, FamilyId: null }],
    });
    const out = generateGedcom([person], []);
    expect((out.match(/^1 DEAT/gm) ?? []).length).toBe(1);
  });

  it('still emits the BIRT event when the person has no BirthDate/BirthPlace column data (no data loss)', () => {
    const person = makePerson({
      Id: 1, BirthDate: null, BirthPlace: null,
      events: [{ Id: 1, UserId: 1, Type: 'BIRT', Date: '1901', Place: null, Description: null, PersonId: 1, FamilyId: null }],
    });
    const out = generateGedcom([person], []);
    expect((out.match(/^1 BIRT/gm) ?? []).length).toBe(1);
    expect(out).toContain('2 DATE 1901');
  });

  it('still emits the DEAT event when the person has no DeathDate/DeathPlace column data and IsDeceased is not set (no data loss)', () => {
    const person = makePerson({
      Id: 1, DeathDate: null, DeathPlace: null, IsDeceased: null,
      events: [{ Id: 1, UserId: 1, Type: 'DEAT', Date: '1980', Place: null, Description: null, PersonId: 1, FamilyId: null }],
    });
    const out = generateGedcom([person], []);
    expect((out.match(/^1 DEAT/gm) ?? []).length).toBe(1);
    expect(out).toContain('2 DATE 1980');
  });

  // A promoted death (Option A → first-class event): the DeathDate column is empty,
  // a dated DEAT *event* carries the fact, and IsDeceased stays 1 (status, not a fact).
  // The flag-only "1 DEAT Y" branch must NOT claim ownership here, or it suppresses the
  // dated event and the death DATE is lost on export.
  it('does not drop a dated DEAT event when the column is empty but IsDeceased is 1 (promoted death)', () => {
    const person = makePerson({
      Id: 1, DeathDate: null, DeathPlace: null, IsDeceased: 1,
      events: [{ Id: 1, UserId: 1, Type: 'DEAT', Date: '1980', Place: null, Description: null, PersonId: 1, FamilyId: null }],
    });
    const out = generateGedcom([person], []);
    expect((out.match(/^1 DEAT/gm) ?? []).length).toBe(1);
    expect(out).toContain('2 DATE 1980');
    expect(out).not.toContain('1 DEAT Y');
  });

});

// Merge re-import matches an imported person to an existing row by stored GedcomId
// (lib/services/gedcom.ts: SELECT ... WHERE "GedcomId" = $1). For a self-export ->
// merge-reimport round-trip to re-attach to the same record instead of a different
// one, the exporter must emit each person's stored GedcomId as their INDI xref rather
// than a fresh sequential @In@. These guard that identity is preserved.
describe('generateGedcom — GedcomId round-trip stability', () => {
  it('emits a stored GedcomId as the INDI xref instead of renumbering', () => {
    const person = makePerson({ Id: 1, GedcomId: '@I50@', FirstName: 'Ada' });
    const out = generateGedcom([person], []);
    expect(out).toContain('0 @I50@ INDI');
    expect(out).not.toContain('0 @I1@ INDI');
  });

  it('keeps each person under their own stored id when ids are non-sequential', () => {
    // Alice @I50@, Bob @I99@ — DB row order differs from id order. A round-trip must
    // not renumber Bob to @I2@ (which would collide with whoever else holds @I2@ on
    // merge and attach Bob's data to the wrong person).
    const alice = makePerson({ Id: 1, GedcomId: '@I50@', FirstName: 'Alice' });
    const bob = makePerson({ Id: 2, GedcomId: '@I99@', FirstName: 'Bob', DeathDate: '1990-01-02' });
    const out = generateGedcom([alice, bob], []);
    const reparsed = parseGedcom(out);
    const byId = new Map(reparsed.people.map((p) => [p.GedcomId, p.FirstName]));
    expect(byId.get('@I50@')).toBe('Alice');
    expect(byId.get('@I99@')).toBe('Bob');
  });

  it('assigns a fresh non-colliding xref to people with no stored id', () => {
    // In-app person (GedcomId null) still needs a valid, unique xref that does not
    // clash with a preserved one.
    const kept = makePerson({ Id: 1, GedcomId: '@I1@', FirstName: 'Kept' });
    const fresh = makePerson({ Id: 2, GedcomId: null, FirstName: 'Fresh' });
    const out = generateGedcom([kept, fresh], []);
    const indis = out.match(/^0 (@[^@]+@) INDI/gm) ?? [];
    expect(indis.length).toBe(2);
    // no duplicate xrefs
    expect(new Set(indis).size).toBe(2);
    expect(out).toContain('0 @I1@ INDI');
  });

  it('renumbers when two rows share a stored GedcomId (would be an invalid duplicate)', () => {
    // A messy prior import can leave duplicate GedcomIds; preserving both would emit
    // two 0 @I5@ INDI records. The exporter must fall back to unique ids here.
    const a = makePerson({ Id: 1, GedcomId: '@I5@', FirstName: 'Dup1' });
    const b = makePerson({ Id: 2, GedcomId: '@I5@', FirstName: 'Dup2' });
    const out = generateGedcom([a, b], []);
    const indis = out.match(/^0 (@[^@]+@) INDI/gm) ?? [];
    expect(indis.length).toBe(2);
    expect(new Set(indis).size).toBe(2);
  });
});
