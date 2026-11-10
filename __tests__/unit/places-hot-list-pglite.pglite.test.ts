import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { initializeSchema, type DbExecutor } from '@/lib/db/init-schema';

const holder = vi.hoisted(() => ({ db: null as PGlite | null }));
vi.mock('@/lib/db/connection', () => ({
  query: (text: string, params?: unknown[]) => holder.db!.query(text, params as never[]),
  getClient: () => { throw new Error('not used by the hot-list query'); },
  closePool: async () => {},
}));

import { getTopPlacesByRecordCount, getRecordsForPlace } from '@/lib/db/queries/places';
import { insertRecord } from '../setup/fact-places';

const USER = 1;
const TREE = 1;

/**
 * The dashboard "Places hot list" and the place detail page must agree: the row
 * says "N entries" and links to a page listing those records. They disagreed
 * because the hot-list query counted only birth/death/event and omitted a
 * family's MarriagePlace, which `getRecordsForPlace` has always included.
 */

describe('getTopPlacesByRecordCount on PGlite', () => {
  beforeAll(async () => {
    const db = await newEmptyClusterDb();
    const executor: DbExecutor = { query: (text, params) => db.query(text, params) };
    await initializeSchema(executor);
    await db.query(`INSERT INTO "Users" ("Id","Email","GoogleId") VALUES (${USER},'a@b.c','g1')`);
    await db.query(`INSERT INTO "Trees" ("Id","OwnerId","Name") VALUES (${TREE},${USER},'My Tree')`);
    holder.db = db;
  });
  afterEach(async () => {
    await holder.db!.query(`DELETE FROM "Events" WHERE "UserId" = ${USER}`);
    await holder.db!.query(`DELETE FROM "Families" WHERE "UserId" = ${USER}`);
    await holder.db!.query(`DELETE FROM "People" WHERE "UserId" = ${USER}`);
    // Gazetteer rows too — the roll-up reads them, so a leftover parent would
    // change a later test's counts.
    await holder.db!.query(`DELETE FROM "Places" WHERE "UserId" = ${USER}`);
  });

  it('counts a marriage place, matching what the place detail page lists', async () => {
    const db = holder.db!;
    await insertRecord(db, 'People', { UserId: USER, TreeId: TREE, FirstName: 'Ada', BirthPlace: 'Warsaw' });
    await insertRecord(db, 'Families', { UserId: USER, TreeId: TREE, MarriagePlace: 'Warsaw' });

    const [top] = await getTopPlacesByRecordCount(TREE, 5);
    const records = await getRecordsForPlace('Warsaw', TREE);

    expect(top.place_name).toBe('Warsaw');
    expect(Number(top.person_count)).toBe(records.length);
    expect(Number(top.person_count)).toBe(2);
  });

  it('counts a person born AND died in one place once, like the detail page', async () => {
    const db = holder.db!;
    await insertRecord(db, 'People', { Id: 50, UserId: USER, TreeId: TREE, FirstName: 'Bo', BirthPlace: 'Lodz', DeathPlace: 'Lodz' });
    await insertRecord(db, 'Events', { UserId: USER, TreeId: TREE, PersonId: 50, Type: 'RESI', Place: 'Lodz' });

    const [top] = await getTopPlacesByRecordCount(TREE, 5);
    const records = await getRecordsForPlace('Lodz', TREE);

    // getRecordsForPlace lists the birth and the death as separate rows; the
    // detail page's "N records" counts DISTINCT people + events + families, so
    // this is 1 person + 1 event, not 3.
    expect(records.length).toBe(3);
    expect(Number(top.person_count)).toBe(2);
  });

  it('is scoped to the tree and orders by count', async () => {
    const db = holder.db!;
    await db.query(`INSERT INTO "Trees" ("Id","OwnerId","Name") VALUES (2,${USER},'Other')`);
    await insertRecord(db, 'People', { UserId: USER, TreeId: TREE, FirstName: 'Cy', BirthPlace: 'Krakow' });
    await insertRecord(db, 'People', { UserId: USER, TreeId: TREE, FirstName: 'Di', BirthPlace: 'Gdansk' });
    await insertRecord(db, 'People', { UserId: USER, TreeId: TREE, FirstName: 'Ed', DeathPlace: 'Gdansk' });
    // Another tree's records must not leak into this tree's hot list.
    await insertRecord(db, 'People', { UserId: USER, TreeId: 2, FirstName: 'Fay', BirthPlace: 'Krakow' });

    const rows = await getTopPlacesByRecordCount(TREE, 5);

    expect(rows.map((r) => r.place_name)).toEqual(['Gdansk', 'Krakow']);
    expect(Number(rows[0].person_count)).toBe(2);
    expect(Number(rows[1].person_count)).toBe(1);
  });

  it('honours the limit', async () => {
    const db = holder.db!;
    for (const name of ['A', 'B', 'C']) {
      await insertRecord(db, 'People', { UserId: USER, TreeId: TREE, FirstName: 'P', BirthPlace: name });
    }
    const rows = await getTopPlacesByRecordCount(TREE, 2);
    expect(rows).toHaveLength(2);
  });

  it('rolls a parent place up over its gazetteer descendants', async () => {
    const db = holder.db!;
    await db.query(`INSERT INTO "Places" ("Id","UserId","TreeId","Name") VALUES (900,${USER},${TREE},'Kent')`);
    await db.query(`INSERT INTO "Places" ("Id","UserId","TreeId","Name","ParentId") VALUES (901,${USER},${TREE},'Dover',900)`);
    await insertRecord(db, 'People', { UserId: USER, TreeId: TREE, FirstName: 'Ada', BirthPlace: 'Kent' });
    await insertRecord(db, 'People', { UserId: USER, TreeId: TREE, FirstName: 'Bo', BirthPlace: 'Dover' });
    await insertRecord(db, 'People', { UserId: USER, TreeId: TREE, FirstName: 'Cy', BirthPlace: 'Dover' });

    const rows = await getTopPlacesByRecordCount(TREE, 5);
    const dover = rows.find((r) => r.place_name === 'Dover');

    // Kent rolls up to 3, but Dover (2 of its own) is the specific answer and Kent
    // is suppressed behind it.
    expect(rows.map((r) => r.place_name)).not.toContain('Kent');
    expect(Number(dover!.person_count)).toBe(2);
  });

  it('reports own_count on every row, and suppresses a parent even when it has records of its own', async () => {
    const db = holder.db!;
    await db.query(`INSERT INTO "Places" ("Id","UserId","TreeId","Name") VALUES (910,${USER},${TREE},'Dover')`);
    await db.query(`INSERT INTO "Places" ("Id","UserId","TreeId","Name","ParentId") VALUES (911,${USER},${TREE},'Buckland',910)`);
    await insertRecord(db, 'People', { Id: 60, UserId: USER, TreeId: TREE, FirstName: 'Ada', BirthPlace: 'Dover' });
    await insertRecord(db, 'Events', { UserId: USER, TreeId: TREE, PersonId: 60, Type: 'RESI', Place: 'Buckland' });

    const rows = await getTopPlacesByRecordCount(TREE, 5);

    // Dover rolls to 2 (its own record + Buckland's), but Buckland OWNS a record,
    // so Buckland is the more specific answer and Dover is suppressed behind it —
    // the same rule that keeps countries out of the top five. A consequence worth
    // stating: a surviving row's rolled total therefore always equals its own
    // count, so no row can read "incl. sub-places" (decision 2026-07-27).
    expect(rows.map((r) => r.place_name)).toEqual(['Buckland']);
    expect(Number(rows[0].person_count)).toBe(1);
    expect(Number(rows[0].own_count)).toBe(1);
  });

  it('counts a place a save created bare, with no pin or parent', async () => {
    const db = holder.db!;
    await insertRecord(db, 'People', { UserId: USER, TreeId: TREE, FirstName: 'Ada', BirthPlace: 'Nowhere-in-particular' });

    const [top] = await getTopPlacesByRecordCount(TREE, 5);

    expect(top.place_name).toBe('Nowhere-in-particular');
    expect(Number(top.person_count)).toBe(1);
    expect(Number(top.own_count)).toBe(1);
  });

  it('terminates on a ParentId cycle', async () => {
    const db = holder.db!;
    await db.query(`INSERT INTO "Places" ("Id","UserId","TreeId","Name") VALUES (920,${USER},${TREE},'A')`);
    await db.query(`INSERT INTO "Places" ("Id","UserId","TreeId","Name","ParentId") VALUES (921,${USER},${TREE},'B',920)`);
    await db.query(`UPDATE "Places" SET "ParentId" = 921 WHERE "Id" = 920`);
    await insertRecord(db, 'People', { UserId: USER, TreeId: TREE, FirstName: 'Ada', BirthPlace: 'B' });

    const rows = await getTopPlacesByRecordCount(TREE, 5);

    expect(rows.length).toBeGreaterThan(0);
  });
});
