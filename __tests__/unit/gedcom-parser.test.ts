import { describe, it, expect } from 'vitest';
import { parseGedcom, parseDate } from '@/lib/gedcom/parser';
import { generateGedcom } from '@/lib/gedcom/generator';

describe('parseGedcom', () => {
  it('returns empty arrays for empty input', () => {
    const result = parseGedcom('');
    expect(result.people).toEqual([]);
    expect(result.families).toEqual([]);
  });

  it('does not fabricate an event from a nested ADOP inside an adoption record', () => {
    // 5.5.1 INDIVIDUAL_EVENT_STRUCTURE: "3 ADOP HUSB" says WHICH PARENT adopted,
    // it is not a second adoption event (ged551-2.txt:467-470).
    const gedcom = `0 @I1@ INDI
1 NAME Adopted /Child/
1 ADOP
2 FAMC @F1@
3 ADOP HUSB
0 TRLR`;
    const result = parseGedcom(gedcom);
    const adoptions = result.people[0].events.filter((e) => e.Type === 'ADOP');
    expect(adoptions).toHaveLength(1);
    expect(adoptions[0].Description).not.toBe('HUSB');
  });

  it('does not fabricate an event from EVEN under an inline SOUR citation', () => {
    // Inline (non-pointer) source citations are deprecated but legal in 5.5.1,
    // so real files contain them. "2 EVEN" here describes the citation, not a
    // life event.
    const gedcom = `0 @I1@ INDI
1 NAME Cited /Person/
1 SOUR Parish register, volume 3
2 EVEN BIRT
0 TRLR`;
    const result = parseGedcom(gedcom);
    expect(result.people[0].events).toHaveLength(0);
  });

  it('parses a single person with name', () => {
    const gedcom = `0 HEAD
1 GEDC
2 VERS 5.5.1
0 @I1@ INDI
1 NAME John /Smith/
1 SEX M
0 TRLR`;
    const result = parseGedcom(gedcom);
    expect(result.people).toHaveLength(1);
    expect(result.people[0].FirstName).toBe('John');
    expect(result.people[0].LastName).toBe('Smith');
    expect(result.people[0].Sex).toBe('M');
    expect(result.people[0].GedcomId).toBe('@I1@');
  });

  it('parses birth and death dates/places', () => {
    const gedcom = `0 @I1@ INDI
1 NAME Jane /Doe/
1 BIRT
2 DATE 15 MAR 1920
2 PLAC Anytown, USA
1 DEAT
2 DATE 20 JUN 2005
2 PLAC Othertown, USA
0 TRLR`;
    const result = parseGedcom(gedcom);
    const person = result.people[0];
    expect(person.BirthDate).toBe('1920-03-15');
    expect(person.BirthPlace).toBe('Anytown, USA');
    expect(person.DeathDate).toBe('2005-06-20');
    expect(person.DeathPlace).toBe('Othertown, USA');
    expect(person.IsDeceased).toBe(1);
  });

  it('sets IsDeceased for DEAT tag without date', () => {
    const gedcom = `0 @I1@ INDI
1 NAME John /Doe/
1 DEAT Y
0 TRLR`;
    const result = parseGedcom(gedcom);
    expect(result.people[0].IsDeceased).toBe(1);
  });

  it('sets IsDeceased to 0 for DEAT N (explicitly living)', () => {
    const gedcom = `0 @I1@ INDI
1 NAME Alice /Living/
1 DEAT N
0 TRLR`;
    const result = parseGedcom(gedcom);
    expect(result.people[0].IsDeceased).toBe(0);
  });

  it('sets IsDeceased to 0 for _LIVING Y', () => {
    const gedcom = `0 @I1@ INDI
1 NAME Alice /Living/
1 _LIVING Y
0 TRLR`;
    const result = parseGedcom(gedcom);
    expect(result.people[0].IsDeceased).toBe(0);
  });

  it('keeps _LIVING out of rawLines passthrough', () => {
    // _LIVING must be in HANDLED_INDI_L1, or it lands in the verbatim
    // passthrough bucket and never reaches IsDeceased.
    const gedcom = `0 @I1@ INDI
1 NAME Alice /Living/
1 _LIVING Y
0 TRLR`;
    const result = parseGedcom(gedcom);
    expect(result.people[0].rawLines.join('\n')).not.toContain('_LIVING');
  });

  it('round-trips IsDeceased=0 through generate then parse', () => {
    // generateGedcom emits 1 _LIVING Y for IsDeceased=0; parseGedcom should restore it
    const person = {
      Id: 1, UserId: 1, FirstName: 'Round', LastName: 'Trip', Sex: 'M',
      GedcomId: null, BirthDate: null, BirthPlace: null, DeathDate: null,
      DeathPlace: null, IsDeceased: 0, Notes: null, UpdatedAt: null,
      EffectiveFirstName: null, Nickname: null,
    };
    const gedcom = generateGedcom([person], []);
    const result = parseGedcom(gedcom);
    expect(result.people[0].IsDeceased).toBe(0);
  });

  it('parses a file with CR-only (classic Mac) line endings (GED-1)', () => {
    // Split on lone \r — these files previously collapsed to one line and imported empty.
    const gedcom = ['0 @I1@ INDI', '1 NAME Mac /Classic/', '1 SEX M', '0 TRLR'].join('\r');
    const result = parseGedcom(gedcom);
    expect(result.people).toHaveLength(1);
    expect(result.people[0].FirstName).toBe('Mac');
    expect(result.people[0].LastName).toBe('Classic');
  });

  it('does not store a NOTE pointer (@N@) as note text, but keeps inline notes (GED-3)', () => {
    const pointer = parseGedcom('0 @I1@ INDI\n1 NAME A /B/\n1 NOTE @N7@\n0 TRLR').people[0];
    // Unresolvable pointer: dropped, so the bare "@N7@" is never leaked as text.
    expect(pointer.notes).toHaveLength(0);

    const inline = parseGedcom('0 @I1@ INDI\n1 NAME A /B/\n1 NOTE A real note\n0 TRLR').people[0];
    expect(inline.notes[0].text).toBe('A real note');
  });

  it('collapses an escaped "@@" to "@" in values (GED-6)', () => {
    const person = parseGedcom('0 @I1@ INDI\n1 NAME A /B/\n1 NOTE mail a@@b.com\n0 TRLR').people[0];
    expect(person.notes[0].text).toBe('mail a@b.com');
  });

  it('captures unmodeled level-1 subtrees as rawLines, leaving modeled fields alone (Slice 0p)', () => {
    const gedcom = [
      '0 @I1@ INDI',
      '1 NAME A /B/',
      '1 TITL Sir',          // unmodeled attribute -> raw
      '1 ASSO @I2@',         // unmodeled, with a subordinate line -> raw (both lines)
      '2 RELA Godfather',
      '1 BIRT',              // modeled event -> must NOT be captured as raw
      '2 DATE 1900',
      '0 TRLR',
    ].join('\n');
    const p = parseGedcom(gedcom).people[0];
    expect(p.BirthDate).toBe('1900');                 // modeled field still parsed
    expect(p.rawLines).toContain('1 TITL Sir');
    expect(p.rawLines).toContain('1 ASSO @I2@');
    expect(p.rawLines).toContain('2 RELA Godfather'); // subordinate line captured too
    expect(p.rawLines.some((l) => l.includes('BIRT') || l.includes('1900'))).toBe(false);
  });

  it('captures unmodeled FAM and SOUR subtrees as rawLines (Slice 0p)', () => {
    const fam = parseGedcom('0 @F1@ FAM\n1 HUSB @I1@\n1 SLGS\n2 DATE 1899\n0 TRLR').families[0];
    expect(fam.rawLines).toContain('1 SLGS');
    expect(fam.rawLines).toContain('2 DATE 1899');

    // ABBR used to be the example here; it is modeled as of #501, so this now uses
    // AGNC — which stays unmodeled by decision (ADR 0012) and rides passthrough.
    const src = parseGedcom('0 @S1@ SOUR\n1 TITL T\n1 AGNC Ville de Montréal\n0 TRLR').sources[0];
    expect(src.Title).toBe('T');                              // modeled
    expect(src.rawLines).toContain('1 AGNC Ville de Montréal'); // unmodeled -> raw
  });

  it('resolves a shared NOTE-record pointer on a family to its text (Slice 1)', () => {
    const gedcom = [
      '0 @F1@ FAM',
      '1 HUSB @I1@',
      '1 NOTE @N1@',                 // pointer to a shared note record
      '0 @N1@ NOTE Married in secret',
      '1 CONT then publicly a year later',
      '0 TRLR',
    ].join('\n');
    const fam = parseGedcom(gedcom).families[0];
    expect(fam.notes).toHaveLength(1);
    expect(fam.notes[0].xref).toBe('@N1@');
    expect(fam.notes[0].text).toBe('Married in secret\nthen publicly a year later');
    // The pointer must NOT leak into passthrough rawLines anymore.
    expect(fam.rawLines).not.toContain('1 NOTE @N1@');
  });

  it('parses an inline family NOTE and a source NOTE (Slice 1)', () => {
    const fam = parseGedcom('0 @F1@ FAM\n1 HUSB @I1@\n1 NOTE just a plain note\n0 TRLR').families[0];
    expect(fam.notes[0]).toEqual({ text: 'just a plain note', xref: null });

    const src = parseGedcom('0 @S1@ SOUR\n1 TITL T\n1 NOTE archival note\n0 TRLR').sources[0];
    expect(src.notes[0]).toEqual({ text: 'archival note', xref: null });
    expect(src.rawLines).not.toContain('1 NOTE archival note');
  });

  it('folds _TOLDBY from an older export into the source Author (#470)', () => {
    const [onlyTeller, both] = parseGedcom([
      '0 @S1@ SOUR', '1 TITL Story', '1 _TYPE Oral', '1 _TOLDBY Grandma', '2 CONC  Rose',
      '0 @S2@ SOUR', '1 TITL Interview', '1 AUTH Anna Petrova', '1 _TOLDBY Ivan',
      '0 TRLR',
    ].join('\n')).sources;
    expect(onlyTeller.Author).toBe('Grandma Rose');
    expect(both.Author).toBe('Anna Petrova (told by Ivan)');
    expect(onlyTeller.rawLines.join('\n')).not.toContain('_TOLDBY');
  });

  it('resolves a person NOTE pointer into Notes without leaking the xref (GED-3 / Slice 1)', () => {
    const gedcom = [
      '0 @I1@ INDI',
      '1 NAME A /B/',
      '1 NOTE @N1@',
      '0 @N1@ NOTE Biography text',
      '0 TRLR',
    ].join('\n');
    const p = parseGedcom(gedcom).people[0];
    expect(p.notes[0].text).toBe('Biography text');
    expect(p.notes[0].text).not.toContain('@N1@');
  });

  it('drops a dangling NOTE pointer rather than leaking it (Slice 1)', () => {
    const fam = parseGedcom('0 @F1@ FAM\n1 NOTE @NMISSING@\n0 TRLR').families[0];
    expect(fam.notes).toHaveLength(0);
    expect(fam.rawLines).not.toContain('1 NOTE @NMISSING@');
  });

  it('parses an inline OBJE on a family (Slice 2)', () => {
    const gedcom = [
      '0 @F1@ FAM',
      '1 HUSB @I1@',
      '1 OBJE',
      '2 FILE wedding.jpg',
      '3 FORM jpeg',
      '2 TITL Wedding day',
      '2 _PRIM Y',
      '1 MARR',
      '2 DATE 1950',
      '0 TRLR',
    ].join('\n');
    const fam = parseGedcom(gedcom).families[0];
    expect(fam.media).toHaveLength(1);
    expect(fam.media[0]).toMatchObject({ FilePath: 'wedding.jpg', Format: 'jpeg', Title: 'Wedding day', legacyPrimary: 1 });
    expect(fam.MarriageDate).toBe('1950');          // OBJE closed; MARR still parsed
    expect(fam.rawLines).not.toContain('1 OBJE');   // promoted out of passthrough
  });

  it('resolves a standalone OBJE-record pointer on a source (Slice 2)', () => {
    const gedcom = [
      '0 @S1@ SOUR', '1 TITL Register', '1 OBJE @O1@',
      '0 @O1@ OBJE', '1 FILE scan.pdf', '2 FORM pdf', '1 TITL Page 3',
      '0 TRLR',
    ].join('\n');
    const parsed = parseGedcom(gedcom);
    const src = parsed.sources[0];
    expect(src.Title).toBe('Register');
    expect(src.media).toHaveLength(0);
    expect(src.mediaRefs).toEqual([{ xref: '@O1@', legacyPrimary: null }]);
    expect(parsed.mediaRecords[0]).toMatchObject({ xref: '@O1@', FilePath: 'scan.pdf', Format: 'pdf', Title: 'Page 3' });
  });

  it('drops a family OBJE with no usable file (Slice 2)', () => {
    const fam = parseGedcom('0 @F1@ FAM\n1 OBJE @OMISSING@\n0 TRLR').families[0];
    expect(fam.media).toHaveLength(0);
    expect(fam.rawLines).not.toContain('1 OBJE @OMISSING@');
  });

  it('captures SOURCE_CITATION evidence fields on a person (Slice 3)', () => {
    const gedcom = [
      '0 @I1@ INDI',
      '1 NAME A /B/',
      '1 SOUR @S1@',
      '2 PAGE p. 42',
      '2 EVEN BIRT',
      '3 ROLE CHIL',
      '2 DATA',
      '3 DATE 3 MAR 1900',
      '3 TEXT born at home',
      '2 QUAY 3',
      '0 @S1@ SOUR',
      '1 TITL Reg',
      '0 TRLR',
    ].join('\n');
    const cit = parseGedcom(gedcom).people[0].citations[0];
    expect(cit).toMatchObject({
      sourceXref: '@S1@', page: 'p. 42', even: 'BIRT', role: 'CHIL',
      dataDate: '3 MAR 1900', dataText: 'born at home', quay: '3',
    });
  });

  it('collects distinct places with their PLAC.FORM (header default + per-place) (Slice 5)', () => {
    const gedcom = [
      '0 HEAD', '1 PLAC', '2 FORM City, County, State, Country',
      '0 @I1@ INDI', '1 NAME A /B/',
      '1 BIRT', '2 PLAC Boston, Suffolk, Massachusetts, USA',
      '1 DEAT', '2 PLAC Paris', '3 FORM City',
      '0 TRLR',
    ].join('\n');
    const { places } = parseGedcom(gedcom);
    const byName = Object.fromEntries(places.map((p) => [p.name, p.form]));
    expect(byName['Boston, Suffolk, Massachusetts, USA']).toBe('City, County, State, Country'); // header default
    expect(byName['Paris']).toBe('City'); // per-place form overrides
  });

  it('does not mistake HEAD.GEDC.FORM for the HEAD.PLAC.FORM default (round-trip defect 3)', () => {
    // The app's own generator emits `1 GEDC / 2 FORM LINEAGE-LINKED` (the file's
    // GEDCOM dialect declaration) but never a real `HEAD.PLAC.FORM`. `inHeader`
    // alone can't distinguish this from an actual place-form default, since it's
    // true for the whole header block — this reproduces on every file this app
    // exports and reimports (found by the round-trip suite).
    const gedcomNoHeadPlac = [
      '0 HEAD', '1 SOUR GenealogyApp', '1 GEDC', '2 VERS 5.5.1', '2 FORM LINEAGE-LINKED',
      '1 CHAR UTF-8',
      '0 @I1@ INDI', '1 NAME A /B/',
      '1 BIRT', '2 PLAC Montréal, Québec, Canada',
      '0 TRLR',
    ].join('\n');
    const { places: placesNoHeadPlac } = parseGedcom(gedcomNoHeadPlac);
    const byNameNoHeadPlac = Object.fromEntries(placesNoHeadPlac.map((p) => [p.name, p.form]));
    expect(byNameNoHeadPlac['Montréal, Québec, Canada']).toBeNull();

    // A REAL HEAD.PLAC.FORM alongside HEAD.GEDC.FORM must still apply as the
    // default for a place with no form of its own — the fix must not just
    // delete the header default, only stop it firing off the wrong tag.
    const gedcomWithHeadPlac = [
      '0 HEAD', '1 SOUR GenealogyApp', '1 GEDC', '2 VERS 5.5.1', '2 FORM LINEAGE-LINKED',
      '1 CHAR UTF-8', '1 PLAC', '2 FORM City, County',
      '0 @I1@ INDI', '1 NAME A /B/',
      '1 BIRT', '2 PLAC Montréal, Québec, Canada',
      '0 TRLR',
    ].join('\n');
    const { places: placesWithHeadPlac } = parseGedcom(gedcomWithHeadPlac);
    const byNameWithHeadPlac = Object.fromEntries(placesWithHeadPlac.map((p) => [p.name, p.form]));
    expect(byNameWithHeadPlac['Montréal, Québec, Canada']).toBe('City, County');
  });

  it('preserves date qualifiers instead of dropping them (GED-4)', () => {
    const p = (date: string) =>
      parseGedcom(`0 @I1@ INDI\n1 BIRT\n2 DATE ${date}\n0 TRLR`).people[0].BirthDate;
    expect(p('ABT 1850')).toBe('ABT 1850');
    expect(p('EST 1850')).toBe('EST 1850');
    expect(p('CAL 1850')).toBe('CAL 1850');
    expect(p('BEF 3 MAR 1900')).toBe('BEF 1900-03-03');
    expect(p('AFT JUN 1880')).toBe('AFT 1880-06');
    expect(p('BET 1850 AND 1860')).toBe('BET 1850 AND 1860');
    expect(p('FROM 1850 TO 1860')).toBe('FROM 1850 TO 1860');
    expect(p('ABOUT 1840')).toBe('ABT 1840'); // ABOUT/CIRCA normalize to ABT
    // a plain date is unchanged
    expect(p('15 MAR 1945')).toBe('1945-03-15');
  });

  // #400: `parseDate` returns null for text it cannot resolve, and the old bare
  // assignment therefore DELETED the value outright. DATE ∈ HANDLED_COLUMN_EVENT_L2,
  // so the #423 passthrough never caught it either — the date was simply gone.
  it('keeps an unparseable date as literal text rather than deleting it (#400)', () => {
    const p = (date: string) =>
      parseGedcom(`0 @I1@ INDI\n1 BIRT\n2 DATE ${date}\n0 TRLR`).people[0].BirthDate;
    expect(p('during the war')).toBe('during the war');
    expect(p('sometime after the flood')).toBe('sometime after the flood');
    // CIRCA is a recognised ABT alias, so this one normalises its keyword and keeps
    // the remainder — still lossless, just not byte-identical.
    expect(p('circa the war')).toBe('ABT the war');
  });

  // #531: an unrecognised phrase carrying a year must stay verbatim. The old
  // `new Date(str)` fallback fabricated a precise day/month that never appeared
  // in the source and varied by JavaScript engine.
  it('preserves free-text dates instead of fabricating day/month precision', () => {
    const p = (date: string) =>
      parseGedcom(`0 @I1@ INDI\n1 BIRT\n2 DATE ${date}\n0 TRLR`).people[0].BirthDate;
    expect(p('Michaelmas 1723')).toBe('Michaelmas 1723');
  });

  // The other half of #400: event dates used to be assigned the RAW value even when
  // they parsed cleanly, leaving Events."Date" holding two formats at once.
  it('normalises event dates to ISO like the promoted columns do (#400)', () => {
    const ged = [
      '0 @I1@ INDI', '1 NAME A /B/',
      '1 RESI', '2 DATE 26 AUG 1819',
      '1 OCCU Cooper', '2 DATE during the war',
      '0 TRLR',
    ].join('\n');
    const events = parseGedcom(ged).people[0].events;
    expect(events.find((e) => e.Type === 'RESI')?.Date).toBe('1819-08-26');
    expect(events.find((e) => e.Type === 'OCCU')?.Date).toBe('during the war');
  });

  it('normalises family event dates the same way (#400)', () => {
    const ged = [
      '0 @I1@ INDI', '1 NAME A /B/',
      '0 @F1@ FAM', '1 HUSB @I1@',
      '1 MARR', '2 DATE 3 MAR 1900',
      '1 DIV', '2 DATE 2 OCT 1837',
      '0 TRLR',
    ].join('\n');
    const fam = parseGedcom(ged).families[0];
    expect(fam.MarriageDate).toBe('1900-03-03');
    expect(fam.events.find((e) => e.Type === 'DIV')?.Date).toBe('1837-10-02');
  });

  it('captures REPO name/address and source CALN.MEDI (Slice 4)', () => {
    const gedcom = [
      '0 @S1@ SOUR',
      '1 TITL Parish register',
      '1 REPO @R1@',
      '2 CALN MS 12/3',
      '3 MEDI Microfilm',
      '0 @R1@ REPO',
      '1 NAME Diocesan Archive',
      '1 ADDR 1 Cathedral Close',
      '0 TRLR',
    ].join('\n');
    const src = parseGedcom(gedcom).sources[0];
    expect(src.RepositoryName).toBe('Diocesan Archive');
    expect(src.RepositoryAddress).toBe('1 Cathedral Close');
    expect(src.CallNumber).toBe('MS 12/3');
    expect(src.Medi).toBe('Microfilm');
  });

  it('binds ROLE to EVEN and DATE/TEXT to DATA, not to each other (Slice 3)', () => {
    // A DATE directly under the citation (no DATA) must NOT become dataDate, and a
    // citation DATE must never leak into the person's birth date.
    const gedcom = [
      '0 @I1@ INDI', '1 BIRT', '2 DATE 1 JAN 1850',
      '1 SOUR @S1@', '2 DATA', '3 DATE 1999', '2 EVEN MARR', '3 ROLE HUSB',
      '0 TRLR',
    ].join('\n');
    const p = parseGedcom(gedcom).people[0];
    expect(p.BirthDate).toBe('1850-01-01');             // citation DATE didn't clobber birth
    expect(p.citations[0].dataDate).toBe('1999');
    expect(p.citations[0].even).toBe('MARR');
    expect(p.citations[0].role).toBe('HUSB');
  });

  it('parses family with husband, wife, and children', () => {
    const gedcom = `0 @I1@ INDI
1 NAME John /Doe/
1 FAMS @F1@
0 @I2@ INDI
1 NAME Jane /Doe/
1 FAMS @F1@
0 @I3@ INDI
1 NAME Jimmy /Doe/
1 FAMC @F1@
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 CHIL @I3@
1 MARR
2 DATE 10 JUN 1940
2 PLAC Somewhere, USA
0 TRLR`;
    const result = parseGedcom(gedcom);

    expect(result.people).toHaveLength(3);
    expect(result.families).toHaveLength(1);

    const family = result.families[0];
    expect(family.husbRef).toBe('@I1@');
    expect(family.wifeRef).toBe('@I2@');
    expect(family.chilRefs).toEqual(['@I3@']);
    expect(family.MarriageDate).toBe('1940-06-10');
    expect(family.MarriagePlace).toBe('Somewhere, USA');
  });

  it('parses FAMC and FAMS cross-references on people', () => {
    const gedcom = `0 @I1@ INDI
1 NAME Child /Test/
1 FAMC @F1@
1 FAMS @F2@
0 TRLR`;
    const result = parseGedcom(gedcom);
    expect(result.people[0].famcRefs).toEqual(['@F1@']);
    expect(result.people[0].famsRefs).toEqual(['@F2@']);
  });

  it('does not push a nested FAMC under ADOP into famcRefs', () => {
    // The FAMC inside an adoption record names the adopting family; it is part
    // of the event, not a child-to-family link.
    const gedcom = `0 @I1@ INDI
1 NAME Adopted /Child/
1 FAMC @F1@
1 ADOP
2 FAMC @F2@
0 TRLR`;
    const result = parseGedcom(gedcom);
    expect(result.people[0].famcRefs).toEqual(['@F1@']);
  });

  it('parses events on a person', () => {
    const gedcom = `0 @I1@ INDI
1 NAME Worker /Bee/
1 OCCU Farmer
2 DATE 1950
2 PLAC Rural County, USA
0 TRLR`;
    const result = parseGedcom(gedcom);
    const events = result.people[0].events;
    expect(events).toHaveLength(1);
    expect(events[0].Type).toBe('OCCU');
    expect(events[0].Description).toBe('Farmer');
    expect(events[0].Date).toBe('1950');
    expect(events[0].Place).toBe('Rural County, USA');
  });

  it('parses media (OBJE) on a person', () => {
    const gedcom = `0 @I1@ INDI
1 NAME Photo /Subject/
1 OBJE
2 FILE photo.jpg
2 FORM jpeg
2 TITL Portrait
0 TRLR`;
    const result = parseGedcom(gedcom);
    const media = result.people[0].media;
    expect(media).toHaveLength(1);
    expect(media[0].FilePath).toBe('photo.jpg');
    expect(media[0].Format).toBe('jpeg');
    expect(media[0].Title).toBe('Portrait');
    expect(media[0].legacyPrimary).toBe(1); // first media is primary
    expect(media[0].xref).toBeNull();
  });

  it('uses the first valid FILE from a foreign top-level media record', () => {
    const parsed = parseGedcom([
      '0 @O1@ OBJE',
      '1 FILE',
      '1 FILE media/first.jpg',
      '1 FILE media/second.jpg',
      '0 TRLR',
    ].join('\n'));
    expect(parsed.mediaRecords).toHaveLength(1);
    expect(parsed.mediaRecords[0].FilePath).toBe('media/first.jpg');
  });

  it('parses notes on a person', () => {
    const gedcom = `0 @I1@ INDI
1 NAME Noted /Person/
1 NOTE This is a note
1 NOTE Second note line
0 TRLR`;
    const result = parseGedcom(gedcom);
    // Two sibling `1 NOTE` lines are two first-class notes now, not one blob.
    expect(result.people[0].notes.map((n) => n.text)).toEqual(['This is a note', 'Second note line']);
  });

  it('parses multiple people and families', () => {
    const gedcom = `0 @I1@ INDI
1 NAME Person /One/
0 @I2@ INDI
1 NAME Person /Two/
0 @I3@ INDI
1 NAME Person /Three/
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
0 @F2@ FAM
1 HUSB @I3@
0 TRLR`;
    const result = parseGedcom(gedcom);
    expect(result.people).toHaveLength(3);
    expect(result.families).toHaveLength(2);
  });

  it('handles names without slash-delimited last name', () => {
    const gedcom = `0 @I1@ INDI
1 NAME FirstOnly
0 TRLR`;
    const result = parseGedcom(gedcom);
    expect(result.people[0].FirstName).toBe('FirstOnly');
    expect(result.people[0].LastName).toBeNull();
  });

  it('parses year-month GEDCOM dates', () => {
    const gedcom = `0 @I1@ INDI
1 NAME Partial /Date/
1 BIRT
2 DATE AUG 1920
0 TRLR`;
    const result = parseGedcom(gedcom);
    expect(result.people[0].BirthDate).toBe('1920-08');
  });

  it('parses year-only GEDCOM dates', () => {
    const gedcom = `0 @I1@ INDI
1 NAME Year /Only/
1 BIRT
2 DATE 1900
0 TRLR`;
    const result = parseGedcom(gedcom);
    expect(result.people[0].BirthDate).toBe('1900');
  });

  // NICK and _AKA used to be appended to Notes as "NICK: Bill" text lines. That
  // round-tripped, but nothing in the app could read them: the nickname display path
  // keys off NameVariant, so every imported nickname was invisible.
  it('promotes NICK and _AKA to name variants rather than Notes lines', () => {
    const gedcom = `0 @I1@ INDI
1 NAME William /Smith/
1 NICK Bill
1 _AKA William the Elder
0 TRLR`;
    const result = parseGedcom(gedcom);
    expect(result.people[0].nameVariants).toEqual([
      { Type: 'Nickname', Name: 'Bill' },
      { Type: 'Alias', Name: 'William the Elder' },
    ]);
    // Asserted against the scalar `Notes` column until #524 / ADR 0010 dropped it;
    // the person's first-class note list is where a regression would show now.
    const noteText = result.people[0].notes.map((n) => n.text ?? '').join('\n');
    expect(noteText).not.toContain('NICK');
    expect(noteText).not.toContain('_AKA');
  });

  // #872: every NAME used to overwrite the last, so the LAST one won and the rest
  // vanished. GEDCOM's first NAME is the preferred one; later ones are variants.
  it('keeps the first NAME as primary and later NAMEs as typed variants', () => {
    const result = parseGedcom(`0 @I1@ INDI
1 NAME Anna /Smith/
1 NAME Anna /Jones/
2 TYPE married
2 SOUR @S1@
1 NAME /Smith/
2 TYPE birth
1 NAME Anya /Smirnova/
2 TYPE immigrant
1 NAME Anna /Smith/
1 NAME Annie
2 TYPE professional
0 TRLR`);
    const [person] = result.people;
    expect(person.FirstName).toBe('Anna');
    expect(person.LastName).toBe('Smith');
    expect(person.nameVariants).toEqual([
      { Type: 'Married', Name: 'Anna Jones', citations: [expect.objectContaining({ sourceXref: '@S1@' })] },
      { Type: 'Maiden', Name: 'Smith' },
      { Type: 'Anglicized', Name: 'Anya Smirnova' },
      // A repeat of the primary name adds nothing; an unknown TYPE is an Alias.
      { Type: 'Alias', Name: 'Annie' },
    ]);
    // The variant's citation is not also a PersonName citation.
    expect(person.citations).toEqual([]);
  });

  // #873: a second WIFE (or HUSB) used to overwrite the first.
  it('fills both partner slots from two same-tag pointers and keeps a third raw', () => {
    const { families } = parseGedcom(`0 @F1@ FAM
1 WIFE @I1@
1 WIFE @I2@
0 @F2@ FAM
1 HUSB @I3@
1 HUSB @I4@
1 HUSB @I5@
0 TRLR`);
    expect(families[0]).toMatchObject({ husbRef: '@I1@', wifeRef: '@I2@', extraPartnerRefs: [] });
    expect(families[1]).toMatchObject({ husbRef: '@I3@', wifeRef: '@I4@', extraPartnerRefs: ['@I5@'] });
    expect(families[1].rawLines).toEqual(['1 HUSB @I5@']);
  });

  it('treats a repeated partner pointer as one partner (#873)', () => {
    const { families } = parseGedcom(`0 @F1@ FAM\n1 HUSB @I1@\n1 HUSB @I1@\n1 WIFE @I2@\n0 TRLR`);
    expect(families[0]).toMatchObject({ husbRef: '@I1@', wifeRef: '@I2@', extraPartnerRefs: [] });
  });

  it('keeps one CHIL pointer when a FAM lists the same child twice (#874)', () => {
    const { families } = parseGedcom(`0 @F1@ FAM
1 CHIL @I1@
1 CHIL @I2@
1 CHIL @I1@
0 TRLR`);
    expect(families[0].chilRefs).toEqual(['@I1@', '@I2@']);
  });

  // 5.5.1 puts NICK at level 2 beneath NAME. processPersonTag is dispatched
  // unconditionally, so the nested form must land in the same place.
  it('promotes a level-2 NICK beneath NAME', () => {
    const gedcom = `0 @I1@ INDI
1 NAME William /Smith/
2 NICK Bill
0 TRLR`;
    const result = parseGedcom(gedcom);
    expect(result.people[0].nameVariants).toEqual([{ Type: 'Nickname', Name: 'Bill' }]);
  });

  it('ignores an empty NICK value', () => {
    const gedcom = `0 @I1@ INDI
1 NAME William /Smith/
1 NICK
0 TRLR`;
    const result = parseGedcom(gedcom);
    expect(result.people[0].nameVariants).toEqual([]);
  });

  it('parses media focal-point custom tags', () => {
    const gedcom = `0 @I1@ INDI
1 NAME Crop /Subject/
1 OBJE
2 FILE p.jpg
2 _FOCALX 30
2 _FOCALY 70
2 _FOCALR 25
0 TRLR`;
    const media = parseGedcom(gedcom).people[0].media[0];
    expect(media.FocalX).toBe(30);
    expect(media.FocalY).toBe(70);
    expect(media.FocalRadius).toBe(25);
  });

  it('ignores legacy _STORY records (stories are retired)', () => {
    const gedcom = `0 @I1@ INDI
1 NAME Ada /Test/
0 @S1@ _STORY
1 TITL The Big Move
1 _TOLDBY Grandma
1 _SUBJ @I1@
0 TRLR`;
    const result = parseGedcom(gedcom);
    // The person still parses; the _STORY record is silently dropped.
    expect(result.people).toHaveLength(1);
    expect('stories' in result).toBe(false);
  });

  it('parses _FTYPE + legacy _ENDED/_ENDREASON into a family end-event (Phase 2)', () => {
    // Older app exports used the _ENDED/_ENDREASON extension. They now resolve into a
    // family end-event rather than the retired EndedDate/EndedReason columns.
    const gedcom = `0 @F1@ FAM
1 HUSB @I1@
1 _FTYPE Civil union
1 _ENDED 4 MAR 1990
1 _ENDREASON Divorce
0 TRLR`;
    const family = parseGedcom(gedcom).families[0];
    expect(family.Type).toBe('Civil union');
    const div = family.events.find((e) => e.Type === 'DIV');
    expect(div?.Date).toBe('1990-03-04');
  });

  it('parses a standard GEDCOM DIV (divorce) into an event without clobbering the marriage date', () => {
    // Foreign GEDCOMs (Ancestry, FamilySearch, Gramps) use the standard `1 DIV`
    // structure. The divorce becomes an Events row and its DATE must NOT overwrite
    // the marriage date.
    const gedcom = `0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 MARR
2 DATE 20 JUN 1930
2 PLAC Chicago, Cook, Illinois, USA
1 DIV
2 DATE 1942
0 TRLR`;
    const family = parseGedcom(gedcom).families[0];
    expect(family.MarriageDate).toBe('1930-06-20');
    expect(family.MarriagePlace).toBe('Chicago, Cook, Illinois, USA');
    const div = family.events.find((e) => e.Type === 'DIV');
    expect(div?.Date).toBe('1942');
  });

  it('does not leak a legacy _ENDED date across family records', () => {
    // Family 1 has _ENDED with no _ENDREASON; family 2 has _ENDREASON with no _ENDED.
    // The unresolved placeholder from family 1 must not bleed its date into family 2.
    const gedcom = `0 @F1@ FAM
1 HUSB @I1@
1 _ENDED 4 MAR 1990
0 @F2@ FAM
1 HUSB @I2@
1 _ENDREASON Divorce
0 TRLR`;
    const [f1, f2] = parseGedcom(gedcom).families;
    // Family 2's divorce carries its own (empty) date, not family 1's 1990.
    const div = f2.events.find((e) => e.Type === 'DIV');
    expect(div?.Date).toBeNull();
    // Family 1 keeps its own date-only ending.
    expect(f1.events.some((e) => e.Date === '1990-03-04')).toBe(true);
    expect(f2.events.some((e) => e.Date === '1990-03-04')).toBe(false);
  });

  it('keeps `DIV N` / `ANUL N` as passthrough, not an event, and parses ANUL as an Annulment event', () => {
    const notDivorced = parseGedcom(`0 @F1@ FAM
1 MARR
2 DATE 1 JAN 1900
1 DIV N
2 NOTE checked
1 ANUL N
0 TRLR`).families[0];
    expect(notDivorced.MarriageDate).toBe('1900-01-01');
    expect(notDivorced.events).toHaveLength(0);
    // #991: the file's "didn't happen" is kept verbatim for export.
    expect(notDivorced.rawLines).toEqual(['1 DIV N', '2 NOTE checked', '1 ANUL N']);

    const annulled = parseGedcom(`0 @F2@ FAM
1 MARR
2 DATE 1 JAN 1900
1 ANUL
2 DATE 1905
0 TRLR`).families[0];
    expect(annulled.MarriageDate).toBe('1900-01-01');
    const anul = annulled.events.find((e) => e.Type === 'ANUL');
    expect(anul?.Date).toBe('1905');
  });

  // Pedigree linkage now arrives on the CHILD's own `1 FAMC` as a standard `2 PEDI`
  // and is resolved onto the family after the parse (ADR 0012), replacing the custom
  // `2 _RELTYPE` under `CHIL`. Full mapping coverage is in gedcom-pedi.test.ts.
  it('binds PEDI to the right child, leaving siblings at the default', () => {
    const gedcom = `0 @I2@ INDI
1 FAMC @F1@
2 PEDI adopted
0 @I3@ INDI
1 FAMC @F1@
0 @F1@ FAM
1 CHIL @I2@
1 CHIL @I3@
0 TRLR`;
    const family = parseGedcom(gedcom).families[0];
    expect(family.chilRefs).toEqual(['@I2@', '@I3@']);
    expect(family.chilRelationships['@I2@']).toEqual({ partner1: 'Adoption', partner2: 'Adoption' });
    expect(family.chilRelationships['@I3@']).toBeUndefined();
  });

  it('round-trips family type + a separation event through generate then parse', () => {
    const family = {
      Id: 1, UserId: 1, Partner1Id: null, Partner2Id: null,
      MarriageDate: null, MarriagePlace: null, UpdatedAt: null,
      Type: 'Common-law' as const,
      events: [{ Id: 1, UserId: 1, Type: 'SEPA', Date: '2001', Place: null, Description: null, PersonId: null, FamilyId: 1 }],
    };
    const parsed = parseGedcom(generateGedcom([], [family])).families[0];
    expect(parsed.Type).toBe('Common-law');
    const sepa = parsed.events.find((e) => e.Type === 'SEPA');
    expect(sepa?.Date).toBe('2001');
  });

  it('round-trips NICK through generate then parse', () => {
    const person = {
      Id: 1, UserId: 1, FirstName: 'William', LastName: 'Smith', Sex: 'M',
      GedcomId: null, BirthDate: null, BirthPlace: null, DeathDate: null,
      DeathPlace: null, IsDeceased: null, Notes: null, UpdatedAt: null,
      EffectiveFirstName: null, Nickname: null,
    };
    // The nickname now lives in NameVariant on both sides of the round trip, so the
    // generator has to be handed the variants for the tag to survive.
    const ged = generateGedcom([person], [], undefined, {
      nameVariants: [{ Id: 10, PersonId: 1, Type: 'Nickname', Name: 'Bill' }],
    });
    expect(ged).toContain('NICK Bill');

    const result = parseGedcom(ged);
    expect(result.people[0].nameVariants).toEqual([{ Type: 'Nickname', Name: 'Bill' }]);
  });

  it('ignores inline (non-pointer) SOUR on events — only @xref@ citations are captured', () => {
    // Since Task 5, SOUR @xref@ pointer citations are captured in structured citations[].
    // Inline free-text SOUR lines (no @ prefix) can't round-trip so they are silently
    // ignored rather than appended to Description.
    // OCCU is one of the tags the parser materializes as an event row.
    const gedcom = `0 @I1@ INDI
1 NAME John /Doe/
1 OCCU Blacksmith
2 DATE 1900
2 SOUR St Andrews parish register
3 PAGE Vol 3, p.14
0 TRLR
`;
    const result = parseGedcom(gedcom);
    expect(result.people).toHaveLength(1);
    const events = result.people[0].events;
    expect(events).toHaveLength(1);
    // Inline SOUR text is NOT appended to Description — Description only holds the tag value
    expect(events[0].Description).toBe('Blacksmith');
    // Inline SOUR produces no structured citations (no @xref@ pointer)
    expect(events[0].citations).toHaveLength(0);
  });

  it('round-trips media focal points through generate then parse', () => {
    const person = {
      Id: 1, UserId: 1, FirstName: 'Crop', LastName: 'Subject', Sex: 'M',
      GedcomId: null, BirthDate: null, BirthPlace: null, DeathDate: null,
      DeathPlace: null, IsDeceased: null, Notes: null, UpdatedAt: null,
      EffectiveFirstName: null, Nickname: null,
      media: [{
        Id: 1, UserId: 1, Title: 'Crop', FilePath: 'p.jpg', Format: 'jpeg',
        ContentType: null, FocalX: 30, FocalY: 70, FocalRadius: 25,
      }],
    };
    const gedcom = generateGedcom([person], [], undefined, {
      media: person.media,
      mediaLinks: [{ MediaId: 1, OwnerTable: 'People', OwnerId: 1, IsPrimary: 1 }],
    });
    expect(gedcom).toContain('1 _FOCALX 30');
    expect(gedcom).toContain('1 _FOCALY 70');
    expect(gedcom).toContain('1 _FOCALR 25');

    const parsed = parseGedcom(gedcom);
    const media = parsed.mediaRecords.find((record) => record.xref === '@O1@');
    expect(media).toBeDefined();
    expect(media).toMatchObject({
      xref: '@O1@',
      FilePath: 'media/O1-crop.jpg',
      Title: 'Crop',
      Format: 'jpeg',
      FocalX: 30,
      FocalY: 70,
      FocalRadius: 25,
    });
    expect(parsed.people[0].mediaRefs).toEqual([{ xref: '@O1@', legacyPrimary: null }]);
  });

  it('captures an inline NOTE nested under a PLAC as a place note', () => {
    const gedcom = `0 @I1@ INDI
1 NAME Jane /Doe/
1 BIRT
2 PLAC Springfield, Illinois
3 NOTE Founded in 1821
4 CONT and later became the state capital
0 TRLR`;
    const result = parseGedcom(gedcom);
    expect(result.placeNotes).toHaveLength(1);
    expect(result.placeNotes[0].name).toBe('Springfield, Illinois');
    expect(result.placeNotes[0].text).toBe('Founded in 1821\nand later became the state capital');
    expect(result.placeNotes[0].xref).toBeNull();
    // The place-level note must NOT leak into the person's own notes.
    expect(result.people[0].notes).toEqual([]);
  });

  it('captures a NOTE pointer nested under a PLAC and resolves it against a standalone NOTE record', () => {
    const gedcom = `0 @N1@ NOTE A historic river crossing
0 @I1@ INDI
1 NAME Jane /Doe/
1 RESI
2 PLAC Cairo, Illinois
3 NOTE @N1@
0 TRLR`;
    const result = parseGedcom(gedcom);
    expect(result.placeNotes).toHaveLength(1);
    expect(result.placeNotes[0].name).toBe('Cairo, Illinois');
    expect(result.placeNotes[0].text).toBe('A historic river crossing');
    // A RESI is a generic event (currentEvent set) — its own event-notes array
    // must stay empty; the NOTE belongs to the place, not the event.
    expect(result.people[0].events[0].notes).toHaveLength(0);
  });

  it('does not attribute a NOTE under a sibling SOUR citation to the preceding PLAC', () => {
    const gedcom = `0 @I1@ INDI
1 NAME Jane /Doe/
1 BIRT
2 PLAC Peoria, Illinois
2 SOUR @S1@
3 PAGE p. 12
3 NOTE Citation-only note, not a place note
0 TRLR`;
    const result = parseGedcom(gedcom);
    expect(result.placeNotes).toHaveLength(0);
  });

  it('a PLAC with no NOTE produces no placeNotes entries', () => {
    const gedcom = `0 @I1@ INDI
1 NAME No /Note/
1 BIRT
2 PLAC Quiet Town, Illinois
0 TRLR`;
    const result = parseGedcom(gedcom);
    expect(result.placeNotes).toEqual([]);
  });
});

describe('parseDate — bare date phrase', () => {
  // DATE_VALUE admits `(<DATE_PHRASE>)` (ged551-3.txt:415-421). This used to fall
  // through to parsePlainDate, return null, and silently drop the user's date.
  it('keeps a bare parenthesised phrase', () => {
    expect(parseDate('(harvest time)')).toBe('(harvest time)');
    expect(parseDate('  (harvest time)  ')).toBe('(harvest time)');
  });

  it('does not promote a phrase whose text starts with a qualifier word', () => {
    expect(parseDate('(abt the time of the fire)')).toBe('(abt the time of the fire)');
    expect(parseDate('(abt 1850)')).toBe('(abt 1850)');
  });

  it('still parses INT with its phrase', () => {
    expect(parseDate('INT 1850 (the year of the fire)')).toBe('INT 1850 (the year of the fire)');
  });
});

// #876: parsePlainDate was a prefix parser over parseInt, so these looked parseable
// and silently lost information. Each now keeps the original text verbatim.
describe('parseDate — dates with more than the parser models (#876)', () => {
  const birthDate = (date: string) =>
    parseGedcom(`0 @I1@ INDI\n1 NAME A /B/\n1 BIRT\n2 DATE ${date}\n0 TRLR`).people[0].BirthDate;

  it.each([
    ['11 FEB 1712/13', 'dual year'],
    ['500 B.C.', 'B.C.'],
    ['30 FEB 1900', 'impossible day'],
    ['45 JAN 1900', 'day out of range'],
    ['1850?', 'trailing doubt'],
    ['1900s', 'decade'],
    ['12 JUN 1850 or 1851', 'alternative year'],
  ])('keeps %s (%s) as written', (date) => {
    expect(parseDate(date)).toBeNull();
    expect(birthDate(date)).toBe(date);
  });

  it('keeps a qualified date with leftover text verbatim too', () => {
    expect(parseDate('ABT 1850?')).toBe('ABT 1850?');
    expect(parseDate('BET 1850 AND 1860s')).toBeNull();
  });

  it('still parses the plain shapes, including a leap day', () => {
    expect(parseDate('26 aug 1819')).toBe('1819-08-26');
    expect(parseDate('29 FEB 1700')).toBe('1700-02-29');
    expect(parseDate('AUG  1819')).toBe('1819-08');
    expect(parseDate('1819')).toBe('1819');
    expect(parseDate('BEF 3 MAR 1900')).toBe('BEF 1900-03-03');
  });
});
