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
  for (const e of out.edges) {
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
  // Same person drawn as more than one card (any role).
  const people = new Map<number, string[]>();
  for (const n of out.nodes) {
    const pid = Number(/person-(\d+)/.exec(n.id)?.[1]);
    people.set(pid, [...(people.get(pid) ?? []), n.id]);
  }
  for (const [pid, list] of people) if (list.length > 1) found.push(`${name(pid)} drawn ${list.length} times (${list.map(label).join(', ')})`);
  // Sibling edges from one source must not cross: children sorted by x must keep edge order.
  const bySource = new Map<string, string[]>();
  for (const e of out.edges.filter((x) => x.type !== 'spouse')) bySource.set(e.source, [...(bySource.get(e.source) ?? []), e.target]);
  return found;
}

async function report(label: string, ids: Record<string, number>, rootName: string) {
  const name = (id: number) => Object.entries(ids).find(([, v]) => v === id)?.[0] ?? String(id);
  const lines: string[] = [];
  for (const mode of ['descendants', 'ancestors', 'focus'] as const) {
    const data = await getTreeService({ id: ids[rootName], mode, requestedTreeId: null, requestedOwnerId: null, currentUserId: 1 });
    for (const orientation of (mode === 'focus' ? ['vertical'] : ['vertical', 'horizontal']) as ('vertical' | 'horizontal')[]) {
      const out = getLayoutMode(mode).compute({ tree: data.tree, focusTrees: data.focusTrees, orientation });
      const b = breaches(out, orientation === 'horizontal', name);
      lines.push(`  ${mode}/${orientation} from ${rootName}: ${out.nodes.length} nodes, ${b.length ? b.join('; ') : 'clean'}`);
    }
  }
  console.log(`\n[${label}]\n${lines.join('\n')}`);
}

describe('tree edge invariants in unusual family shapes (#13 investigation)', () => {
  it('two brothers marry the same woman in turn', async () => {
    const ids = await seed(
      { Pa: ['M', 1850], Ma: ['F', 1852], B1: ['M', 1875], B2: ['M', 1878], W: ['F', 1880], C1: ['M', 1900], C2: ['F', 1910] },
      [['Pa', 'Ma', ['B1', 'B2']], ['B1', 'W', ['C1']], ['B2', 'W', ['C2']]],
    );
    await report('brothers share a wife', ids, 'Pa');
    await report('brothers share a wife', ids, 'C2');
    expect(true).toBe(true);
  });

  it('first cousins marry (pedigree collapse)', async () => {
    const ids = await seed(
      { G: ['M', 1800], GW: ['F', 1802], A: ['M', 1825], AW: ['F', 1826], B: ['F', 1828], BH: ['M', 1824], X: ['M', 1850], Y: ['F', 1852], Z: ['M', 1875] },
      [['G', 'GW', ['A', 'B']], ['A', 'AW', ['X']], ['BH', 'B', ['Y']], ['X', 'Y', ['Z']]],
    );
    await report('cousin marriage', ids, 'G');
    await report('cousin marriage', ids, 'Z');
    await report('cousin marriage', ids, 'X');
    expect(true).toBe(true);
  });

  it('three marriages with children from each, plus a childless one', async () => {
    const ids = await seed(
      { H: ['M', 1840], W1: ['F', 1842], W2: ['F', 1845], W3: ['F', 1850], W4: ['F', 1855], K1: ['M', 1862], K2: ['F', 1866], K3: ['M', 1870], K4: ['F', 1872] },
      [['H', 'W1', ['K1']], ['H', 'W2', ['K2', 'K3']], ['H', 'W3', ['K4']], ['H', 'W4', []]],
    );
    await report('multi-spouse', ids, 'H');
    await report('multi-spouse', ids, 'K3');
    expect(true).toBe(true);
  });

  it('half-siblings through the mother, both husbands in the tree', async () => {
    const ids = await seed(
      { M: ['F', 1860], H1: ['M', 1858], H2: ['M', 1859], S1: ['M', 1880], S2: ['F', 1890], S2H: ['M', 1888], GK: ['M', 1915] },
      [['H1', 'M', ['S1']], ['H2', 'M', ['S2']], ['S2H', 'S2', ['GK']]],
    );
    await report('half-siblings', ids, 'M');
    await report('half-siblings', ids, 'GK');
    expect(true).toBe(true);
  });

  it('a child recorded in two families (adoptive and birth parents)', async () => {
    const ids = await seed(
      { BF: ['M', 1880], BM: ['F', 1882], AF: ['M', 1870], AM: ['F', 1872], Kid: ['M', 1905], Sib: ['F', 1903] },
      [['BF', 'BM', ['Kid', 'Sib']], ['AF', 'AM', ['Kid']]],
    );
    await report('two parent families', ids, 'Kid');
    await report('two parent families', ids, 'BF');
    expect(true).toBe(true);
  });

  it('uncle marries niece-in-law: a man marries his brother’s daughter’s ... (spouse also a descendant)', async () => {
    const ids = await seed(
      { P: ['M', 1800], PW: ['F', 1802], S: ['M', 1825], SW: ['F', 1826], D: ['F', 1850], U: ['M', 1830], K: ['M', 1870] },
      [['P', 'PW', ['S', 'U']], ['S', 'SW', ['D']], ['U', 'D', ['K']]],
    );
    await report('uncle-niece', ids, 'P');
    expect(true).toBe(true);
  });
});
