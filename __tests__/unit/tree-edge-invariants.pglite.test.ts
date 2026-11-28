import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { initializeSchema, type DbExecutor } from '@/lib/db/init-schema';
import { truncateAllTables } from '../setup/pglite-truncate';

const holder = vi.hoisted(() => ({ db: null as PGlite | null, treeId: 0 }));

vi.mock('@/lib/db/connection', () => ({
  query: (text: string, params?: unknown[]) => holder.db!.query(text, params as never[]),
  getClient: async () => ({
    query: (text: string, params?: unknown[]) => holder.db!.query(text, params as never[]),
    release: () => {},
  }),
  closePool: async () => {},
}));
vi.mock('@/lib/db/queries/trees', async (orig) => ({
  ...(await orig<typeof import('@/lib/db/queries/trees')>()),
  resolveTreeScope: async () => ({ treeId: holder.treeId, ownerId: 1, role: 'owner' }),
}));

import { getTreeService } from '@/lib/services/tree';
import { getLayoutMode } from '@/lib/tree/layout/registry';
import { PERSON_CARD_WIDTH, PERSON_CARD_HEIGHT, BAR_CARD_WIDTH, BAR_CARD_HEIGHT } from '@/lib/tree/geometry';
import type { LayoutOutput } from '@/app/components/tree/types';

let db: PGlite;

beforeAll(async () => {
  db = await newEmptyClusterDb();
  holder.db = db;
  await initializeSchema(db as unknown as DbExecutor);
});
afterEach(async () => { await truncateAllTables(db); });

type Sex = 'M' | 'F';
async function seed(people: Record<string, [Sex, number]>, families: [string, string | null, string[]][]) {
  await db.query(`INSERT INTO "Users" ("Id","Email","GoogleId") VALUES (1,'u1@test.local','g-1') ON CONFLICT DO NOTHING`);
  const t = await db.query<{ Id: number }>(`INSERT INTO "Trees" ("OwnerId","Name") VALUES (1,'t') RETURNING "Id"`);
  holder.treeId = t.rows[0].Id;
  const ids: Record<string, number> = {};
  for (const [name, [sex, year]] of Object.entries(people)) {
    const r = await db.query<{ Id: number }>(
      `INSERT INTO "People" ("UserId","TreeId","FirstName","LastName","Sex","BirthDate") VALUES (1,$1,$2,'X',$3,$4) RETURNING "Id"`,
      [holder.treeId, name, sex, String(year)],
    );
    ids[name] = r.rows[0].Id;
  }
  for (const [a, b, kids] of families) {
    const r = await db.query<{ Id: number }>(
      `INSERT INTO "Families" ("UserId","TreeId","Partner1Id","Partner2Id") VALUES (1,$1,$2,$3) RETURNING "Id"`,
      [holder.treeId, ids[a], b ? ids[b] : null],
    );
    for (const k of kids) await db.query(`INSERT INTO "FamilyPerson" VALUES ($1,$2)`, [r.rows[0].Id, ids[k]]);
  }
  return ids;
}

/** Every invariant from #13 over one layout, as a list of human-readable breaches. */
function breaches(out: LayoutOutput, horizontal: boolean, name: (id: number) => string): string[] {
  const w = horizontal ? BAR_CARD_WIDTH : PERSON_CARD_WIDTH;
  const h = horizontal ? BAR_CARD_HEIGHT : PERSON_CARD_HEIGHT;
  const found: string[] = [];
  const label = (id: string) => id.replace(/person-(\d+)/, (_, n) => `person-${name(Number(n))}`);
  const seen = new Map<string, number>();
  for (const n of out.nodes) seen.set(n.id, (seen.get(n.id) ?? 0) + 1);
  for (const [id, c] of seen) if (c > 1) found.push(`duplicate node id ${label(id)} x${c}`);
  const byId = new Map(out.nodes.map((n) => [n.id, n]));
  const edgeIds = new Set<string>();
  for (const e of out.edges) {
    if (edgeIds.has(e.id)) found.push(`duplicate edge id ${label(e.id)}`);
    edgeIds.add(e.id);
    if (!byId.has(e.source)) found.push(`edge ${label(e.id)} source missing`);
    if (!byId.has(e.target)) found.push(`edge ${label(e.id)} target missing`);
  }
  for (let i = 0; i < out.nodes.length; i++) for (let j = i + 1; j < out.nodes.length; j++) {
    const a = out.nodes[i].position, b = out.nodes[j].position;
    if (Math.abs(a.x - b.x) < w && Math.abs(a.y - b.y) < h) found.push(`overlap ${label(out.nodes[i].id)} / ${label(out.nodes[j].id)}`);
  }
  for (const e of out.edges.filter((x) => x.type === 'spouse')) {
    const s = byId.get(e.source), t = byId.get(e.target);
    if (s && t && (horizontal ? s.position.x !== t.position.x : s.position.y !== t.position.y)) found.push(`spouse edge ${label(e.id)} not on one row`);
  }
  // A person drawn more than once as a main card: one full card, every other main
  // card a repeat that points at a full card of the same person (#13). (A spouse
  // beside each of two partners is a full card beside each.)
  const mains = new Map<number, typeof out.nodes>();
  for (const n of out.nodes) if (!n.data.isSpouse) mains.set(n.data.person.id, [...(mains.get(n.data.person.id) ?? []), n]);
  for (const [pid, list] of mains) {
    const full = list.filter((n) => !n.data.repeatOf);
    if (full.length > 1) found.push(`${name(pid)} has ${full.length} full main cards`);
  }
  for (const n of out.nodes) {
    if (!n.data.repeatOf) continue;
    const target = byId.get(n.data.repeatOf);
    if (!target || target.data.repeatOf || target.data.person.id !== n.data.person.id) found.push(`${label(n.id)} points at ${n.data.repeatOf}`);
  }
  return found;
}

const MODES = ['descendants', 'ancestors', 'focus'] as const;

/** Runs every mode and orientation from one root; returns the layouts and any breaches. */
async function check(ids: Record<string, number>, rootName: string) {
  const name = (id: number) => Object.entries(ids).find(([, v]) => v === id)?.[0] ?? String(id);
  const problems: string[] = [];
  const layouts: Record<string, LayoutOutput> = {};
  for (const mode of MODES) {
    const data = await getTreeService({ id: ids[rootName], mode, requestedTreeId: null, requestedOwnerId: null, currentUserId: 1 });
    for (const orientation of (mode === 'focus' ? ['vertical'] : ['vertical', 'horizontal']) as ('vertical' | 'horizontal')[]) {
      const out = getLayoutMode(mode).compute({ tree: data.tree, focusTrees: data.focusTrees, orientation });
      layouts[`${mode}/${orientation}`] = out;
      for (const b of breaches(out, orientation === 'horizontal', name)) problems.push(`${mode}/${orientation} from ${rootName}: ${b}`);
    }
  }
  return { problems, layouts };
}

const repeatsOf = (out: LayoutOutput, personId: number) =>
  out.nodes.filter((n) => n.data.person.id === personId && n.data.repeatOf).length;

describe('tree edge invariants in unusual family shapes (#13)', () => {
  it('two brothers marry the same woman in turn: she stands in full beside each', async () => {
    const ids = await seed(
      { Pa: ['M', 1850], Ma: ['F', 1852], B1: ['M', 1875], B2: ['M', 1878], W: ['F', 1880], C1: ['M', 1900], C2: ['F', 1910] },
      [['Pa', 'Ma', ['B1', 'B2']], ['B1', 'W', ['C1']], ['B2', 'W', ['C2']]],
    );
    const fromPa = await check(ids, 'Pa');
    expect(fromPa.problems).toEqual([]);
    const desc = fromPa.layouts['descendants/vertical'];
    expect(desc.nodes.filter((n) => n.data.person.id === ids.W).map((n) => n.data.repeatOf)).toEqual([undefined, undefined]);
    // Each brother's line to W goes to the card beside him, and each child comes
    // down from its own mother's card.
    const spouseEdge = (b: number) => desc.edges.find((e) => e.type === 'spouse' && e.source === `person-${b}`)!;
    expect(spouseEdge(ids.B1).target).not.toBe(spouseEdge(ids.B2).target);
    const into = (c: number) => desc.edges.find((e) => e.target === `person-${c}`)!;
    expect(into(ids.C1).source).toBe(spouseEdge(ids.B1).target);
    expect(into(ids.C2).source).toBe(spouseEdge(ids.B2).target);
    expect((await check(ids, 'C2')).problems).toEqual([]);
  });

  it('first cousins marry (pedigree collapse)', async () => {
    const ids = await seed(
      { G: ['M', 1800], GW: ['F', 1802], A: ['M', 1825], AW: ['F', 1826], B: ['F', 1828], BH: ['M', 1824], X: ['M', 1850], Y: ['F', 1852], Z: ['M', 1875] },
      [['G', 'GW', ['A', 'B']], ['A', 'AW', ['X']], ['BH', 'B', ['Y']], ['X', 'Y', ['Z']]],
    );
    const fromG = await check(ids, 'G');
    expect(fromG.problems).toEqual([]);
    expect(repeatsOf(fromG.layouts['descendants/vertical'], ids.Z)).toBe(1);
    const fromZ = await check(ids, 'Z');
    expect(fromZ.problems).toEqual([]);
    // The shared great-grandparents are drawn in full once and repeated once.
    expect(repeatsOf(fromZ.layouts['ancestors/vertical'], ids.G)).toBe(1);
    expect(repeatsOf(fromZ.layouts['ancestors/vertical'], ids.GW)).toBe(1);
    expect((await check(ids, 'X')).problems).toEqual([]);
  });

  it('three marriages with children from each, plus a childless one', async () => {
    const ids = await seed(
      { H: ['M', 1840], W1: ['F', 1842], W2: ['F', 1845], W3: ['F', 1850], W4: ['F', 1855], K1: ['M', 1862], K2: ['F', 1866], K3: ['M', 1870], K4: ['F', 1872] },
      [['H', 'W1', ['K1']], ['H', 'W2', ['K2', 'K3']], ['H', 'W3', ['K4']], ['H', 'W4', []]],
    );
    const fromH = await check(ids, 'H');
    expect(fromH.problems).toEqual([]);
    expect(fromH.layouts['descendants/vertical'].nodes.some((n) => n.data.repeatOf)).toBe(false);
    expect((await check(ids, 'K3')).problems).toEqual([]);
  });

  it('half-siblings through the mother, both husbands in the tree', async () => {
    const ids = await seed(
      { M: ['F', 1860], H1: ['M', 1858], H2: ['M', 1859], S1: ['M', 1880], S2: ['F', 1890], S2H: ['M', 1888], GK: ['M', 1915] },
      [['H1', 'M', ['S1']], ['H2', 'M', ['S2']], ['S2H', 'S2', ['GK']]],
    );
    expect((await check(ids, 'M')).problems).toEqual([]);
    expect((await check(ids, 'GK')).problems).toEqual([]);
  });

  it('a child recorded in two families (adoptive and birth parents)', async () => {
    const ids = await seed(
      { BF: ['M', 1880], BM: ['F', 1882], AF: ['M', 1870], AM: ['F', 1872], Kid: ['M', 1905], Sib: ['F', 1903] },
      [['BF', 'BM', ['Kid', 'Sib']], ['AF', 'AM', ['Kid']]],
    );
    expect((await check(ids, 'Kid')).problems).toEqual([]);
    expect((await check(ids, 'BF')).problems).toEqual([]);
  });

  it('a man marries his brother’s daughter (a spouse who is also a descendant)', async () => {
    const ids = await seed(
      { P: ['M', 1800], PW: ['F', 1802], S: ['M', 1825], SW: ['F', 1826], D: ['F', 1850], U: ['M', 1830], K: ['M', 1870] },
      [['P', 'PW', ['S', 'U']], ['S', 'SW', ['D']], ['U', 'D', ['K']]],
    );
    const fromP = await check(ids, 'P');
    expect(fromP.problems).toEqual([]);
    // K's full card is the one with his own line of descent; the other is a repeat.
    expect(repeatsOf(fromP.layouts['descendants/vertical'], ids.K)).toBe(1);
  });
});
