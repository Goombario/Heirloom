import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { newEmptyClusterDb } from '../setup/pglite-snapshot';
import { initializeSchema, type DbExecutor } from '@/lib/db/init-schema';

/**
 * v24 remediation (#394): a parser bug copied the header's `1 GEDC / 2 FORM
 * LINEAGE-LINKED` into every Places."Form", so affected databases launder a
 * meaningless `3 FORM LINEAGE-LINKED` into every export. This clears it.
 *
 * The risk being guarded is over-reach, not under-reach: the UPDATE is
 * irreversible, so a legitimate jurisdiction must survive it untouched.
 */
async function boot(forms: Array<string | null>): Promise<{ db: PGlite; executor: DbExecutor }> {
  const db = await newEmptyClusterDb();
  const executor: DbExecutor = { query: (text, params) => db.query(text, params) };
  await initializeSchema(executor);
  await db.query(`INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES (1, 'a@b.c', 'g1')`);
  await db.query(`INSERT INTO "Trees" ("Id", "OwnerId", "Name") VALUES (1, 1, 'T')`);
  for (const [i, form] of forms.entries()) {
    await db.query(
      `INSERT INTO "Places" ("Id","UserId","TreeId","Name","Form") VALUES ($1,1,1,$2,$3)`,
      [i + 1, `Place ${i + 1}`, form],
    );
  }
  return { db, executor };
}

async function forms(db: PGlite): Promise<Array<string | null>> {
  const r = await db.query<{ Form: string | null }>(`SELECT "Form" FROM "Places" ORDER BY "Id"`);
  return r.rows.map((x) => x.Form);
}

describe('Places."Form" LINEAGE-LINKED remediation (v24, #394)', () => {
  it('nulls the bogus value and leaves real jurisdictions untouched', async () => {
    const { db, executor } = await boot([
      'LINEAGE-LINKED',   // the bug
      'City',             // legitimate
      'City, County',     // legitimate, multi-part
      null,               // already clear
    ]);
    await initializeSchema(executor);
    expect(await forms(db)).toEqual([null, 'City', 'City, County', null]);
    await db.close();
  });

  // Equality-scoped, not a LIKE. A jurisdiction that merely CONTAINS the string
  // (or differs in case) is not the bug and must survive — an over-broad match
  // here destroys data with no way back.
  it('does not match on substring or case variants', async () => {
    const { db, executor } = await boot([
      'LINEAGE-LINKED, County',
      'lineage-linked',
      'Not LINEAGE-LINKED',
    ]);
    await initializeSchema(executor);
    expect(await forms(db)).toEqual(['LINEAGE-LINKED, County', 'lineage-linked', 'Not LINEAGE-LINKED']);
    await db.close();
  });

  it('is idempotent — repeated init changes nothing further', async () => {
    const { db, executor } = await boot(['LINEAGE-LINKED', 'City']);
    await initializeSchema(executor);
    const once = await forms(db);
    await initializeSchema(executor);
    await initializeSchema(executor);
    expect(await forms(db)).toEqual(once);
    expect(once).toEqual([null, 'City']);
    await db.close();
  });
});
