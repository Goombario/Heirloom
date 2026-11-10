import { afterEach, describe, expect, it } from 'vitest';
import { POST as CREATE_PERSON } from '@/app/api/people/route';
import { PUT as UPDATE_PERSON } from '@/app/api/people/[id]/route';
import { GET as SEARCH_PEOPLE } from '@/app/api/people/search/route';
import { POST as CREATE_VARIANT } from '@/app/api/people/[id]/name-variants/route';
import { POST as CREATE_FAMILY } from '@/app/api/families/route';
import { GET as SEARCH_FAMILIES } from '@/app/api/families/search/route';
import { createRequest, parseResponse } from '../../setup/test-helpers';
import { cleanupTestData, hasTestDatabase } from '../../setup/db-helpers';

/**
 * #792 (task audit FR-4): search matched with plain ILIKE, so "Etienne" found no
 * Étienne and "Белозерова" (е for ё, as most Russians type it) found nobody.
 * Names are now folded into a stored generated column and the query is folded
 * with the same function. The PGlite twin is search-fold.pglite.test.ts.
 */
const describeIf = hasTestDatabase() ? describe : describe.skip;

async function createPerson(FirstName: string, LastName: string): Promise<number> {
  const res = await CREATE_PERSON(createRequest('http://localhost:3000/api/people', {
    method: 'POST', body: { FirstName, LastName },
  }));
  return (await parseResponse<{ person: { Id: number } }>(res)).person.Id;
}

async function searchNames(q: string): Promise<string[]> {
  const res = await SEARCH_PEOPLE(createRequest(`http://localhost:3000/api/people/search?q=${encodeURIComponent(q)}`));
  expect(res.status).toBe(200);
  const { people } = await parseResponse<{ people: { FirstName: string; LastName: string }[] }>(res);
  return people.map(p => `${p.FirstName} ${p.LastName}`).sort();
}

describeIf('accent- and ё-insensitive people search (#792)', () => {
  afterEach(async () => { await cleanupTestData(); });

  it('finds accented and ё names from plain, accented and differently-cased queries', async () => {
    await createPerson('Étienne', 'Lefèvre');
    await createPerson('Ксения', 'Белозёрова');
    await createPerson('Etienne', 'Fontaine');

    expect(await searchNames('Etienne')).toEqual(['Etienne Fontaine', 'Étienne Lefèvre']);
    expect(await searchNames('lefevre')).toEqual(['Étienne Lefèvre']);
    expect(await searchNames('Белозерова')).toEqual(['Ксения Белозёрова']);
    expect(await searchNames('ксения белозерова')).toEqual(['Ксения Белозёрова']);
    // The accented query still matches, and still matches the unaccented name too.
    expect(await searchNames('Étienne')).toEqual(['Etienne Fontaine', 'Étienne Lefèvre']);
    expect(await searchNames('ÉTIENNE LEFÈVRE')).toEqual(['Étienne Lefèvre']);
  });

  it('keeps the folded name current when a name is edited, and folds name variants', async () => {
    const id = await createPerson('Anne', 'Martin');
    await UPDATE_PERSON(
      createRequest(`http://localhost:3000/api/people/${id}`, { method: 'PUT', body: { FirstName: 'Anne', LastName: 'Brûlé' } }),
      { params: Promise.resolve({ id: String(id) }) },
    );
    expect(await searchNames('brule')).toEqual(['Anne Brûlé']);
    expect(await searchNames('martin')).toEqual([]);

    await CREATE_VARIANT(
      createRequest(`http://localhost:3000/api/people/${id}/name-variants`, { method: 'POST', body: { Type: 'Alias', Name: 'Anne Sørensen-Hébert' } }),
      { params: Promise.resolve({ id: String(id) }) },
    );
    expect(await searchNames('hebert')).toEqual(['Anne Brûlé']);
  });
});

/**
 * #849: a literal "%" or "_" in a search was a LIKE wildcard, so "_" matched
 * everyone. The PGlite twin, which also covers sources, cases and the audit
 * log's label search, is in search-fold.pglite.test.ts.
 */
describeIf('LIKE wildcards in people and family search (#849)', () => {
  afterEach(async () => { await cleanupTestData(); });

  async function searchFamilyIds(q: string): Promise<number[]> {
    const res = await SEARCH_FAMILIES(createRequest(`http://localhost:3000/api/families/search?q=${encodeURIComponent(q)}`));
    expect(res.status).toBe(200);
    const { families } = await parseResponse<{ families: { Id: number }[] }>(res);
    return families.map(f => f.Id);
  }

  it('matches a literal % or _ only, and still folds accents', async () => {
    const under = await createPerson('Anne_Marie', 'Du%Pont');
    const plain = await createPerson('Annemarie', 'Dupont');
    await createPerson('Étienne', 'Lefèvre');

    expect(await searchNames('_')).toEqual(['Anne_Marie Du%Pont']);
    expect(await searchNames('%')).toEqual(['Anne_Marie Du%Pont']);
    expect(await searchNames('Etienne')).toEqual(['Étienne Lefèvre']);

    const family = async (Partner1Id: number) => (await parseResponse<{ family: { Id: number } }>(await CREATE_FAMILY(
      createRequest('http://localhost:3000/api/families', { method: 'POST', body: { Partner1Id } }),
    ))).family.Id;
    const underFamily = await family(under);
    await family(plain);
    expect(await searchFamilyIds('_')).toEqual([underFamily]);
  });
});
