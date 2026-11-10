import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';

// Both '@/lib/db/connection' and the (normalized) imports inside the query
// files resolve to the same module, so this single mock redirects the whole
// query layer onto the PGlite implementation.
vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

import { LocalDataClient } from '@/lib/data/local';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { __resetLocalUserCache } from '@/lib/data/local-user';
import { ValidationError } from '@/lib/validation';
import { NotFoundError } from '@/lib/data/errors';
import { truncateAllTables } from '../setup/pglite-truncate';

let db: PGlite;

beforeAll(async () => {
  db = await newEmptyClusterDb();
  __setTestDb(db);
  await query('SELECT 1'); // boot WASM + run schema init ONCE for the whole file
});

beforeEach(async () => {
  await truncateAllTables(db);
  __resetLocalUserCache(); // in-memory cache must still reset per test (cheap)
});

afterAll(async () => {
  __setTestDb(null);
  await db.close();
});

describe('LocalDataClient (in-memory PGlite)', () => {
  it('creates a person and lists it back', async () => {
    const client = new LocalDataClient();
    const created = await client.people.create({ FirstName: 'Ada', LastName: 'Lovelace' });
    expect(created.Id).toBeGreaterThan(0);

    const { people, count } = await client.people.list();
    expect(count).toBe(1);
    expect(people[0].FirstName).toBe('Ada');
    expect(people[0].LastName).toBe('Lovelace');
  });

  it('omits the heavy RawGedcom field from list rows', async () => {
    const client = new LocalDataClient();
    await client.people.create({ FirstName: 'Trim', LastName: 'Target' });

    const { people } = await client.people.list();
    const row = people.find((p) => p.LastName === 'Target')!;
    // Fields the list renders are present…
    expect(row.FirstName).toBe('Trim');
    // …but the large text column is trimmed from the list payload (#6). `Notes`
    // used to be trimmed alongside it; that column is gone entirely (#524 /
    // ADR 0010), so its absence here is the schema, not the projection.
    expect('RawGedcom' in row).toBe(false);
    expect('Notes' in row).toBe(false);
  });

  it('finds a created person via search', async () => {
    const client = new LocalDataClient();
    await client.people.create({ FirstName: 'Grace', LastName: 'Hopper' });

    const { people } = await client.people.list({ search: 'Hopper' });
    expect(people.some((p) => p.LastName === 'Hopper')).toBe(true);
  });

  it('throws ValidationError when neither name is provided', async () => {
    const client = new LocalDataClient();
    await expect(client.people.create({})).rejects.toBeInstanceOf(ValidationError);
  });

  it('gets a created person with relations', async () => {
    const client = new LocalDataClient();
    const created = await client.people.create({ FirstName: 'Ada', LastName: 'Lovelace' });

    const person = await client.people.get(created.Id);
    expect(person.Id).toBe(created.Id);
    expect(person.FirstName).toBe('Ada');
    // PersonWithRelations has spouses (not a top-level children) — verify relation arrays are present
    expect(Array.isArray(person.spouses)).toBe(true);
  });

  it('throws NotFoundError when getting a missing person', async () => {
    const client = new LocalDataClient();
    await expect(client.people.get(999999)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('updates only the provided fields of a person', async () => {
    const client = new LocalDataClient();
    const created = await client.people.create({ FirstName: 'Ada', LastName: 'Lovelace' });

    const updated = await client.people.update(created.Id, { BirthDate: '1815' });
    expect(updated.BirthDate).toBe('1815');
    expect(updated.FirstName).toBe('Ada'); // untouched field preserved
    expect(updated.LastName).toBe('Lovelace');
  });

  it('removes a person', async () => {
    const client = new LocalDataClient();
    const created = await client.people.create({ FirstName: 'Temp', LastName: 'Person' });

    await client.people.remove(created.Id);

    const { count } = await client.people.list();
    expect(count).toBe(0);
  });

  it('throws NotFoundError when removing a missing person', async () => {
    const client = new LocalDataClient();
    await expect(client.people.remove(999999)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('searches people by name and respects the limit', async () => {
    const client = new LocalDataClient();
    await client.people.create({ FirstName: 'Grace', LastName: 'Hopper' });
    await client.people.create({ FirstName: 'Edsger', LastName: 'Dijkstra' });

    const results = await client.people.search('Hopper');
    expect(results.some((p) => p.LastName === 'Hopper')).toBe(true);
    expect(results.some((p) => p.LastName === 'Dijkstra')).toBe(false);
  });

  it('creates and lists name variants for a person', async () => {
    const client = new LocalDataClient();
    const person = await client.people.create({ FirstName: 'Mark', LastName: 'Twain' });

    const variant = await client.people.createNameVariant(person.Id, {
      Type: 'Alias',
      Name: 'Samuel Clemens',
    });
    expect(variant.Name).toBe('Samuel Clemens');
    expect(variant.PersonId).toBe(person.Id);

    const variants = await client.people.listNameVariants(person.Id);
    expect(variants).toHaveLength(1);
    expect(variants[0].Name).toBe('Samuel Clemens');
  });

  it('rejects an invalid name-variant type', async () => {
    const client = new LocalDataClient();
    const person = await client.people.create({ FirstName: 'X', LastName: 'Y' });
    await expect(
      client.people.createNameVariant(person.Id, { Type: 'Bogus', Name: 'Z' })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('sets a name variant primary and removes it', async () => {
    const client = new LocalDataClient();
    const person = await client.people.create({ FirstName: 'Mark', LastName: 'Twain' });
    const variant = await client.people.createNameVariant(person.Id, {
      Type: 'Alias',
      Name: 'Samuel Clemens',
    });

    const primary = await client.people.setPrimaryNameVariant(person.Id, variant.Id, true);
    expect(primary.IsPrimary).toBeTruthy(); // stored as integer 1 (pre-existing)

    await client.people.removeNameVariant(person.Id, variant.Id);
    const variants = await client.people.listNameVariants(person.Id);
    expect(variants).toHaveLength(0);
  });

  it('changes a name variant\'s type, keeping an imported one and rejecting an unknown one (#1052)', async () => {
    const client = new LocalDataClient();
    const person = await client.people.create({ FirstName: 'Greta', LastName: 'Halvorsen' });
    const variant = await client.people.createNameVariant(person.Id, { Type: 'Alias', Name: 'Margaret Halverson', FromDate: '1900' });

    const updated = await client.people.updateNameVariant(person.Id, variant.Id, 'Margaret Halverson', null, { FromDate: '1900', ToDate: null, Type: 'Anglicized' });
    expect(updated.Type).toBe('Anglicized');
    expect(updated.auditIds.length).toBe(1);
    // Omitted keeps the stored type.
    expect((await client.people.updateNameVariant(person.Id, variant.Id, 'Maggie', null)).Type).toBe('Anglicized');
    await expect(
      client.people.updateNameVariant(person.Id, variant.Id, 'Maggie', null, { FromDate: null, ToDate: null, Type: 'Bogus' })
    ).rejects.toBeInstanceOf(ValidationError);
    await client.audit.revert(updated.auditIds);
    expect((await client.people.listNameVariants(person.Id))[0].Name).toBe('Maggie');
  });

  it('returns family suggestions (empty for an empty tree)', async () => {
    const client = new LocalDataClient();
    const suggestions = await client.people.suggestFamily({
      lastName: 'Nobody',
      birthDate: '1900',
    });
    expect(Array.isArray(suggestions)).toBe(true);
    expect(suggestions).toHaveLength(0);
  });

  // ── Relationship ──────────────────────────────────────────────────────────

  it('returns Spouse relationship for two people in the same family', async () => {
    const client = new LocalDataClient();
    const p1 = await client.people.create({ FirstName: 'Alice', LastName: 'Smith' });
    const p2 = await client.people.create({ FirstName: 'Bob', LastName: 'Smith' });
    await client.families.create({ Partner1Id: p1.Id, Partner2Id: p2.Id });

    const result = await client.relationship.get(p1.Id, p2.Id);
    expect(result.relationship).toBe('Spouse');
    expect(result.degree).toBe(1);
  });

  it('returns same-person result without a DB hit', async () => {
    const client = new LocalDataClient();
    const result = await client.relationship.get(42, 42);
    expect(result.relationship).toBe('Same person');
    expect(result.degree).toBe(0);
  });

  it('returns no relationship when people are unconnected', async () => {
    const client = new LocalDataClient();
    const p1 = await client.people.create({ FirstName: 'Unrelated', LastName: 'A' });
    const p2 = await client.people.create({ FirstName: 'Unrelated', LastName: 'B' });

    const result = await client.relationship.get(p1.Id, p2.Id);
    expect(result.relationship).toBe('No relationship found');
    expect(result.degree).toBe(-1);
  });

  // ── Places ────────────────────────────────────────────────────────────────

  it('lists places after creating a person with a birth place', async () => {
    const client = new LocalDataClient();
    await client.people.create({ FirstName: 'Marie', LastName: 'Curie', BirthPlace: 'Warsaw' });

    const { places, count } = await client.places.list();
    expect(count).toBeGreaterThan(0);
    expect(places.some((p) => p.name === 'Warsaw')).toBe(true);
  });

  it('returns place detail with people born/died there', async () => {
    const client = new LocalDataClient();
    await client.people.create({ FirstName: 'Frédéric', LastName: 'Chopin', BirthPlace: 'Warsaw' });

    const detail = await client.places.detail('Warsaw');
    expect(detail.name).toBe('Warsaw');
    expect(Array.isArray(detail.people)).toBe(true);
    expect(detail.people.length).toBeGreaterThan(0);
  });

  // ── Families ──────────────────────────────────────────────────────────────

  it('creates and lists families', async () => {
    const client = new LocalDataClient();
    const p1 = await client.people.create({ FirstName: 'Romeo', LastName: 'Montague' });
    const p2 = await client.people.create({ FirstName: 'Juliet', LastName: 'Capulet' });
    await client.families.create({ Partner1Id: p1.Id, Partner2Id: p2.Id, MarriageDate: '1597' });

    const { families, count } = await client.families.list();
    expect(count).toBe(1);
    expect(families[0].MarriageDate).toBe('1597');
  });

  it('gets a family by id', async () => {
    const client = new LocalDataClient();
    const p1 = await client.people.create({ FirstName: 'Adam', LastName: 'Test' });
    const p2 = await client.people.create({ FirstName: 'Eve', LastName: 'Test' });
    const created = await client.families.create({ Partner1Id: p1.Id, Partner2Id: p2.Id });

    const detail = await client.families.get(created.Id);
    expect(detail.family.Id).toBe(created.Id);
    expect(Array.isArray(detail.children)).toBe(true);
  });

  it('throws NotFoundError when getting a missing family', async () => {
    const client = new LocalDataClient();
    await expect(client.families.get(999999)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('adds and removes a child from a family', async () => {
    const client = new LocalDataClient();
    const parent1 = await client.people.create({ FirstName: 'Parent', LastName: 'One' });
    const parent2 = await client.people.create({ FirstName: 'Parent', LastName: 'Two' });
    const child = await client.people.create({ FirstName: 'Child', LastName: 'Test' });
    const family = await client.families.create({ Partner1Id: parent1.Id, Partner2Id: parent2.Id });

    await client.families.addChild(family.Id, child.Id, 'Birth');
    const detail = await client.families.get(family.Id);
    expect(detail.children?.some((c) => c.Id === child.Id)).toBe(true);

    await client.families.removeChild(family.Id, child.Id);
    const detailAfter = await client.families.get(family.Id);
    expect(detailAfter.children?.some((c) => c.Id === child.Id)).toBe(false);
  });

  // #788: the static build audits the removal too, and Undo reverts that entry.
  it('undoes a child removal through the audit revert', async () => {
    const client = new LocalDataClient();
    const parent = await client.people.create({ FirstName: 'Parent', LastName: 'One' });
    const child = await client.people.create({ FirstName: 'Child', LastName: 'Test' });
    const family = await client.families.create({ Partner1Id: parent.Id });
    await client.families.addChild(family.Id, child.Id, 'Foster');

    const { auditId } = await client.families.removeChild(family.Id, child.Id);
    expect(auditId).toEqual(expect.any(Number));
    await client.audit.revert([auditId!]);

    const detail = await client.families.get(family.Id);
    const restored = detail.children?.find((c) => c.Id === child.Id);
    expect([restored?.Partner1Relationship, restored?.Partner2Relationship]).toEqual(['Foster', 'Foster']);
  });

  it('restores a deleted person with their name variants', async () => {
    const client = new LocalDataClient();
    const person = await client.people.create({ FirstName: 'Hazel', LastName: 'Bracken' });
    await client.people.createNameVariant(person.Id, { Type: 'Nickname', Name: 'Hazie' });
    await client.people.remove(person.Id);

    const { entries } = await client.audit.list({ entityType: 'person', action: 'delete' });
    await client.audit.revert([entries[0].Id]);

    const variants = await client.people.listNameVariants(person.Id);
    expect(variants.map((v) => v.Name)).toEqual(['Hazie']);
  });

  // ── Events ────────────────────────────────────────────────────────────────

  // ── Tree ─────────────────────────────────────────────────────────────────

  it('builds a descendants tree for a single person', async () => {
    const client = new LocalDataClient();
    const person = await client.people.create({ FirstName: 'Isaac', LastName: 'Newton' });

    const treeData = await client.tree.get({ mode: 'descendants' });
    expect(treeData.tree.id).toBe(person.Id);
    expect(treeData.currentRootId).toBe(person.Id);
    expect(treeData.currentMode).toBe('descendants');
    expect(Array.isArray(treeData.allPeople)).toBe(true);
    expect(treeData.allPeople.length).toBe(1);
  });

  it('throws NotFoundError when the tree is empty', async () => {
    const client = new LocalDataClient();
    await expect(client.tree.get({ mode: 'descendants' })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('creates an event', async () => {
    const client = new LocalDataClient();
    const person = await client.people.create({ FirstName: 'Test', LastName: 'Person' });

    const event = await client.events.create({
      Type: 'Birth',
      Date: '1900',
      Place: 'London',
      PersonId: person.Id,
    });
    expect(event.Id).toBeGreaterThan(0);
    expect(event.Type).toBe('Birth');
    expect(event.PersonId).toBe(person.Id);
  });

  // ── Sources ───────────────────────────────────────────────────────────────

  it('creates and lists sources', async () => {
    const client = new LocalDataClient();
    await client.sources.create({ Title: 'Census 1901', Author: 'Government', Type: 'Census' });

    const { sources, count } = await client.sources.list();
    expect(count).toBe(1);
    expect(sources[0].Title).toBe('Census 1901');
    expect(sources[0].Author).toBe('Government');
  });

  it('searches sources by title', async () => {
    const client = new LocalDataClient();
    await client.sources.create({ Title: 'Parish Register 1850' });
    await client.sources.create({ Title: 'Newspaper Archive' });

    const results = await client.sources.search('Parish');
    expect(results.length).toBe(1);
    expect(results[0].Title).toBe('Parish Register 1850');
  });

  it('gets a source by id', async () => {
    const client = new LocalDataClient();
    const created = await client.sources.create({ Title: 'Birth Certificate' });

    const found = await client.sources.get(created.Id);
    expect(found.Id).toBe(created.Id);
    expect(found.Title).toBe('Birth Certificate');
  });

  it('throws NotFoundError when getting a missing source', async () => {
    const client = new LocalDataClient();
    await expect(client.sources.get(999999)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('updates a source', async () => {
    const client = new LocalDataClient();
    const created = await client.sources.create({ Title: 'Old Title' });

    const updated = await client.sources.update(created.Id, { Title: 'New Title', Author: 'Jane Doe' });
    expect(updated.Title).toBe('New Title');
    expect(updated.Author).toBe('Jane Doe');
  });

  it('removes a source', async () => {
    const client = new LocalDataClient();
    const created = await client.sources.create({ Title: 'To Delete' });

    await client.sources.remove(created.Id);

    const { count } = await client.sources.list();
    expect(count).toBe(0);
  });

  it('returns empty citedBy for a source with no citations', async () => {
    const client = new LocalDataClient();
    const source = await client.sources.create({ Title: 'Uncited Source' });

    const cited = await client.sources.citedBy(source.Id);
    expect(Array.isArray(cited)).toBe(true);
    expect(cited).toHaveLength(0);
  });

  // ── Citations ──────────────────────────────────────────────────────────────

  it('creates a citation and lists it for a fact', async () => {
    const client = new LocalDataClient();
    const person = await client.people.create({ FirstName: 'Ada', LastName: 'Lovelace' });
    const source = await client.sources.create({ Title: 'Birth Record' });

    const citation = await client.citations.create({
      FactTable: 'People',
      FactId: person.Id,
      SourceId: source.Id,
      Page: '42',
    });
    expect(citation.Id).toBeGreaterThan(0);
    expect(citation.SourceId).toBe(source.Id);
    expect(citation.Page).toBe('42');

    const facts = await client.citations.listForFact('People', person.Id);
    expect(facts.length).toBe(1);
    expect(facts[0].Id).toBe(citation.Id);
  });

  it('removes a citation', async () => {
    const client = new LocalDataClient();
    const person = await client.people.create({ FirstName: 'Test', LastName: 'Person' });
    const source = await client.sources.create({ Title: 'Source' });

    const citation = await client.citations.create({
      FactTable: 'People',
      FactId: person.Id,
      SourceId: source.Id,
    });

    await client.citations.remove(citation.Id);

    const facts = await client.citations.listForFact('People', person.Id);
    expect(facts).toHaveLength(0);
  });

  it('lists citations for a person', async () => {
    const client = new LocalDataClient();
    const person = await client.people.create({ FirstName: 'Marie', LastName: 'Curie' });
    const source = await client.sources.create({ Title: 'Biography' });

    await client.citations.create({
      FactTable: 'People',
      FactId: person.Id,
      SourceId: source.Id,
    });

    const map = await client.citations.listForPerson(person.Id);
    expect(typeof map).toBe('object');
    const key = `People:${person.Id}`;
    expect(Array.isArray(map[key])).toBe(true);
    expect(map[key].length).toBe(1);
  });

  it('lists family and persisted family-event citations together', async () => {
    const client = new LocalDataClient();
    const family = await client.families.create({ Type: 'Marriage' });
    const event = await client.events.create({ Type: 'DIV', Date: '1920', FamilyId: family.Id });
    const source = await client.sources.create({ Title: 'Family register' });

    await client.citations.create({ FactTable: 'Families', FactId: family.Id, SourceId: source.Id });
    await client.citations.create({ FactTable: 'Events', FactId: event.Id, SourceId: source.Id });

    const map = await client.citations.listForFamily(family.Id);
    expect(map[`Families:${family.Id}`]).toHaveLength(1);
    expect(map[`Events:${event.Id}`]).toHaveLength(1);
  });

  // ── Audit ──────────────────────────────────────────────────────────────────

  it('lists audit entries after creating a person', async () => {
    const client = new LocalDataClient();
    await client.people.create({ FirstName: 'Audit', LastName: 'Test' });

    const result = await client.audit.list();
    expect(result.total).toBeGreaterThan(0);
    expect(Array.isArray(result.entries)).toBe(true);
    expect(result.entries.length).toBeGreaterThan(0);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(50);
  });

  it('audit.revert throws NotFoundError for a non-existent audit entry id', async () => {
    const client = new LocalDataClient();
    // 999999 does not exist — revertAuditService wraps "Audit entry not found" as NotFoundError
    await expect(client.audit.revert([999999])).rejects.toBeInstanceOf(NotFoundError);
  });

  it('audit.revert is wired (not NotImplementedError) even if revert of a person create may fail', async () => {
    const client = new LocalDataClient();
    const { NotImplementedError } = await import('@/lib/data/errors');
    await client.people.create({ FirstName: 'Revert', LastName: 'Subject' });

    const { entries } = await client.audit.list();
    expect(entries.length).toBeGreaterThan(0);
    const auditId = entries[0].Id;

    try {
      await client.audit.revert([auditId]);
      // If it succeeds, revertedCount must be 1
    } catch (err) {
      // Must NOT be a NotImplementedError — that would mean the method is a stub
      expect(err).not.toBeInstanceOf(NotImplementedError);
    }
  });

  // ── Dashboard ─────────────────────────────────────────────────────────────
  it('returns dashboard data for an empty tree', async () => {
    const client = new LocalDataClient();
    const data = await client.dashboard.get();
    expect(data.stats.people).toBe(0);
    expect(data.stats.families).toBe(0);
    expect(Array.isArray(data.openCases)).toBe(true);
    expect(Array.isArray(data.recentActivity)).toBe(true);
    expect(Array.isArray(data.places)).toBe(true);
    expect(data.resumedPerson).toBeNull();
  });

  it('reflects a created person in dashboard stats', async () => {
    const client = new LocalDataClient();
    await client.people.create({ FirstName: 'Test', LastName: 'Person' });
    const data = await client.dashboard.get();
    expect(data.stats.people).toBe(1);
  });

  it('returns suggestions (empty for an empty tree)', async () => {
    const client = new LocalDataClient();
    const suggestions = await client.dashboard.suggestions();
    expect(Array.isArray(suggestions)).toBe(true);
  });

  it('returns no missing-parents suggestion: that research never reaches zero (#834)', async () => {
    const client = new LocalDataClient();
    await client.people.create({ FirstName: 'Orphan', LastName: 'Test' });
    const suggestions = await client.dashboard.suggestions();
    expect(suggestions.map(s => s.type)).not.toContain('no_parents');
  });

  // ── GEDCOM ───────────────────────────────────────────────────────────────

  it('reset returns success', async () => {
    const client = new LocalDataClient();
    const result = await client.gedcom.reset();
    expect(result.success).toBe(true);
    expect(typeof result.message).toBe('string');
  });

  it('gedcom methods are wired (not NotImplementedError)', async () => {
    const { NotImplementedError } = await import('@/lib/data/errors');
    const client = new LocalDataClient();

    // previewGedcom: validate that it does not throw NotImplementedError
    // (it will throw a ValidationError for a non-.ged file, which is fine)
    const fakeFile = new File(['0 HEAD\n1 GEDC\n2 VERS 5.5.1\n0 TRLR'], 'test.ged', { type: 'text/plain' });
    try {
      await client.gedcom.previewGedcom({ file: fakeFile, mode: 'overwrite' });
    } catch (err) {
      expect(err).not.toBeInstanceOf(NotImplementedError);
    }

    // importGedcom: same minimal file
    try {
      await client.gedcom.importGedcom({ file: fakeFile, mode: 'overwrite' });
    } catch (err) {
      expect(err).not.toBeInstanceOf(NotImplementedError);
    }

    // Import media is materialized through the durable item API; the removed
    // upload-by-mediaId compatibility surface is intentionally not part of the client.
    expect(client.gedcom.materializeImportMedia).toBeTypeOf('function');
  });

  // ── Cases ─────────────────────────────────────────────────────────────────

  it('creates and lists cases', async () => {
    const client = new LocalDataClient();
    const c = await client.cases.create({ Title: 'Research Doe family', Status: 'in_progress' });
    expect(c.Id).toBeGreaterThan(0);
    expect(c.Title).toBe('Research Doe family');

    const { cases, count } = await client.cases.list();
    expect(count).toBe(1);
    expect(cases[0].Title).toBe('Research Doe family');
  });

  it('gets a case by id', async () => {
    const client = new LocalDataClient();
    const created = await client.cases.create({ Title: 'Find ancestors' });
    const fetched = await client.cases.get(created.Id);
    expect(fetched.Id).toBe(created.Id);
    expect(Array.isArray(fetched.people)).toBe(true);
  });

  it('throws NotFoundError when getting a missing case', async () => {
    const client = new LocalDataClient();
    await expect(client.cases.get(999999)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('updates a case title', async () => {
    const client = new LocalDataClient();
    const c = await client.cases.create({ Title: 'Old title' });
    const updated = await client.cases.update(c.Id, { Title: 'New title' });
    expect(updated.Title).toBe('New title');
  });

  it('removes a case', async () => {
    const client = new LocalDataClient();
    const c = await client.cases.create({ Title: 'To delete' });
    await client.cases.remove(c.Id);
    await expect(client.cases.get(c.Id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('adds a comment to a case', async () => {
    const client = new LocalDataClient();
    const c = await client.cases.create({ Title: 'Commented case' });
    const comment = await client.cases.addComment(c.Id, { body: 'First note' });
    expect(comment.Body).toBe('First note');
  });

  // ── Relationship resolution + list counts (audit #6/#7) ─────────────────────

  it('resolves spouses, children, parents and siblings in a single get', async () => {
    const client = new LocalDataClient();
    const root = await client.people.create({ FirstName: 'Root', LastName: 'Person', BirthDate: '1950' });
    const spouse = await client.people.create({ FirstName: 'Spouse', LastName: 'Person', BirthDate: '1952' });
    const father = await client.people.create({ FirstName: 'Father', LastName: 'Person', BirthDate: '1920' });
    const mother = await client.people.create({ FirstName: 'Mother', LastName: 'Person', BirthDate: '1922' });
    const child1 = await client.people.create({ FirstName: 'Child', LastName: 'One', BirthDate: '1975' });
    const child2 = await client.people.create({ FirstName: 'Child', LastName: 'Two', BirthDate: '1978' });
    const sibling = await client.people.create({ FirstName: 'Sib', LastName: 'Person', BirthDate: '1955' });

    const spouseFam = await client.families.create({ Partner1Id: root.Id, Partner2Id: spouse.Id });
    await client.families.addChild(spouseFam.Id, child1.Id, 'Birth');
    await client.families.addChild(spouseFam.Id, child2.Id, 'Birth');

    const parentFam = await client.families.create({ Partner1Id: father.Id, Partner2Id: mother.Id });
    await client.families.addChild(parentFam.Id, root.Id, 'Birth');
    await client.families.addChild(parentFam.Id, sibling.Id, 'Birth');

    const person = await client.people.get(root.Id);

    // Spouse relation + that family's children, birth-date ordered.
    expect(person.spouses).toHaveLength(1);
    expect(person.spouses![0].person?.Id).toBe(spouse.Id);
    expect(person.spouses![0].children.map((c) => c.Id)).toEqual([child1.Id, child2.Id]);

    // Parents (partner1 = father, partner2 = mother).
    expect(person.parents).toHaveLength(1);
    expect(person.parents![0].father?.Id).toBe(father.Id);
    expect(person.parents![0].mother?.Id).toBe(mother.Id);

    // Siblings: the other children in the parent family, excluding the person.
    expect(person.siblings!.map((s) => s.Id)).toEqual([sibling.Id]);
    expect(person.siblings!.some((s) => s.Id === root.Id)).toBe(false);
  });

  it('computes PartnershipCount and ChildrenCount in the people list', async () => {
    const client = new LocalDataClient();
    const root = await client.people.create({ FirstName: 'Root', LastName: 'Count' });
    const spouse = await client.people.create({ FirstName: 'Spouse', LastName: 'Count' });
    const childA = await client.people.create({ FirstName: 'A', LastName: 'Count' });
    const childB = await client.people.create({ FirstName: 'B', LastName: 'Count' });

    const fam = await client.families.create({ Partner1Id: root.Id, Partner2Id: spouse.Id });
    await client.families.addChild(fam.Id, childA.Id, 'Birth');
    await client.families.addChild(fam.Id, childB.Id, 'Birth');

    const { people } = await client.people.list();
    const byId = (id: number) => people.find((p) => p.Id === id)!;

    // Both partners: one partnership, two children.
    expect(byId(root.Id).PartnershipCount).toBe(1);
    expect(byId(root.Id).ChildrenCount).toBe(2);
    expect(byId(spouse.Id).PartnershipCount).toBe(1);
    expect(byId(spouse.Id).ChildrenCount).toBe(2);
    // A child who is not a partner in any family: both counts zero.
    expect(byId(childA.Id).PartnershipCount).toBe(0);
    expect(byId(childA.Id).ChildrenCount).toBe(0);
  });

  // ── Batched place coordinates (audit #4) ────────────────────────────────────

  it('resolves place coordinates in a single batch lookup', async () => {
    const client = new LocalDataClient();
    await client.people.create({ FirstName: 'P', LastName: 'One', BirthPlace: 'Paris, France', DeathPlace: 'Lyon, France' });
    await client.places.geocodeUpsert({ name: 'Paris, France', latitude: 48.8566, longitude: 2.3522 });
    // Lyon is referenced but left un-geocoded.

    const coords = await client.places.coords(['Paris, France', 'Lyon, France', 'Nowhere']);
    expect(coords['Paris, France']).toEqual({ lat: 48.8566, lng: 2.3522 });
    expect(coords['Lyon, France']).toBeUndefined(); // no coordinates → omitted
    expect(coords['Nowhere']).toBeUndefined();      // not a place at all → omitted
  });

  it('places.coords returns an empty map for no names', async () => {
    const client = new LocalDataClient();
    expect(await client.places.coords([])).toEqual({});
  });

  it('aggregates place-detail event and family counts (no full rows)', async () => {
    const client = new LocalDataClient();
    const p1 = await client.people.create({ FirstName: 'A', LastName: 'X', BirthPlace: 'Rome' });
    const p2 = await client.people.create({ FirstName: 'B', LastName: 'Y', DeathPlace: 'Rome' });
    await client.events.create({ Type: 'RESI', Place: 'Rome', PersonId: p1.Id });
    await client.events.create({ Type: 'RESI', Place: 'Rome', PersonId: p2.Id });
    await client.events.create({ Type: 'OCCU', Place: 'Rome', PersonId: p1.Id });
    await client.families.create({ Partner1Id: p1.Id, Partner2Id: p2.Id, MarriagePlace: 'Rome' });

    const detail = await client.places.detail('Rome');
    expect(detail.people.map((p) => p.Id).sort()).toEqual([p1.Id, p2.Id].sort());
    expect(detail.eventCount).toBe(3);
    expect(detail.familyCount).toBe(1);
    expect(detail.eventCounts.find((e) => e.type === 'RESI')?.count).toBe(2);
    expect(detail.eventCounts.find((e) => e.type === 'OCCU')?.count).toBe(1);
  });

  // ── Tree lookup maps (audit #8) ─────────────────────────────────────────────

  it('builds an ancestors tree, resolving parents via the lookup maps', async () => {
    const client = new LocalDataClient();
    const child = await client.people.create({ FirstName: 'Kid', LastName: 'Z' });
    const father = await client.people.create({ FirstName: 'Dad', LastName: 'Z' });
    const mother = await client.people.create({ FirstName: 'Mom', LastName: 'Z' });
    const fam = await client.families.create({ Partner1Id: father.Id, Partner2Id: mother.Id });
    await client.families.addChild(fam.Id, child.Id, 'Birth');

    const treeData = await client.tree.get({ id: child.Id, mode: 'ancestors' });
    expect(treeData.currentRootId).toBe(child.Id);
    // parents output: partner1 = father, partner2 = mother, in that order.
    expect(treeData.parents.map((p) => p.id)).toEqual([father.Id, mother.Id]);
    // Ancestor mode attaches the parents as the root node's children.
    expect((treeData.tree.children ?? []).map((n) => n.id).sort()).toEqual([father.Id, mother.Id].sort());
  });
});
