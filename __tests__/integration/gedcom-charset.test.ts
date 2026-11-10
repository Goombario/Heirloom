import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { query } from '@/lib/db/connection';
import { importGedcomService } from '@/lib/services/gedcom';

const dbAvailable = !!process.env.DATABASE_URL;
const d = dbAvailable ? describe : describe.skip;

// Dedicated, otherwise-unused user id — integration tests run in parallel.
const CHARSET_USER = 987659;

function bytes(...parts: (string | number)[]): Uint8Array {
  const arr: number[] = [];
  for (const p of parts) {
    if (typeof p === 'number') arr.push(p);
    else for (let i = 0; i < p.length; i++) arr.push(p.charCodeAt(i));
  }
  return new Uint8Array(arr);
}

d('ANSEL charset import (Slice 0b)', () => {
  // Multi-tree: the import resolves this user's default tree, and "Trees"
  // FK's "Users" — so the synthetic user id needs a real Users row.
  beforeAll(async () => {
    await query(
      'INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES ($1, $2, $3) ON CONFLICT ("Id") DO NOTHING',
      [CHARSET_USER, `gedcom-charset-${CHARSET_USER}@test.local`, `google-${CHARSET_USER}`],
    );
  });

  afterEach(async () => {
    await query('DELETE FROM "People" WHERE "UserId" = $1', [CHARSET_USER]);
  });

  it('imports an ANSEL file with accented names intact (no mojibake)', async () => {
    // ANSEL: acute(0xE2)+e = é ; tilde(0xE4)+n = ñ
    const ansel = bytes(
      '0 HEAD\n1 CHAR ANSEL\n0 @I1@ INDI\n1 NAME Jos', 0xe2, 'e /Mu', 0xe4, 'noz/\n0 TRLR\n',
    );
    const file = new File([ansel as unknown as BlobPart], 'family_tree.ged', { type: 'text/plain' });
    await importGedcomService({ file, mode: 'overwrite', currentUserId: CHARSET_USER });

    const r = await query(
      'SELECT "FirstName", "LastName" FROM "People" WHERE "UserId" = $1 LIMIT 1',
      [CHARSET_USER]
    );
    expect(r.rows[0]).toMatchObject({ FirstName: 'José', LastName: 'Muñoz' });
  });
});
