import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { query } from '@/lib/db/connection';
import { importGedcomService } from '@/lib/services/gedcom';
import { getFamilyService } from '@/lib/services/families';
import { clearFamilyPhotoService, setFamilyPhotoService } from '@/lib/services/media';
import { getMediaGalleryForOwner } from '@/lib/db/queries/media-links';
import { revertAuditEntries } from '@/lib/db/queries/audit';
import { resolveDefaultTree } from '@/lib/db/queries/trees';
import { ValidationError } from '@/lib/validation';

const dbAvailable = !!process.env.DATABASE_URL;
const d = dbAvailable ? describe : describe.skip;

// A dedicated, otherwise-unused user id keeps this suite apart from the others.
const PHOTO_USER = 987671;

const GED = [
  '0 HEAD',
  '0 @I1@ INDI', '1 NAME Johan /Lind/', '1 FAMS @F1@',
  '0 @I2@ INDI', '1 NAME Kristina /Berg/', '1 FAMS @F1@',
  '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@', '1 OBJE @O1@', '1 OBJE @O2@',
  '0 @O1@ OBJE', '1 FILE wedding.jpg', '2 FORM jpeg', '2 TITL Wedding', '1 _PRIM @F1@',
  '0 @O2@ OBJE', '1 FILE farm.jpg', '2 FORM jpeg', '2 TITL Farm',
  '0 TRLR',
].join('\n');

d('The family photo (#119, ADR 0047)', () => {
  let treeId: number;
  const ctx = () => ({ requestedTreeId: treeId, requestedOwnerId: null, currentUserId: PHOTO_USER });

  beforeAll(async () => {
    await query(
      'INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES ($1, $2, $3) ON CONFLICT ("Id") DO NOTHING',
      [PHOTO_USER, `family-photo-${PHOTO_USER}@test.local`, `google-${PHOTO_USER}`],
    );
    treeId = await resolveDefaultTree(PHOTO_USER);
  });

  afterEach(async () => {
    await query('DELETE FROM "AuditLog" WHERE "UserId" = $1', [PHOTO_USER]);
    await query('DELETE FROM "Media" WHERE "UserId" = $1', [PHOTO_USER]);
    await query('DELETE FROM "Families" WHERE "UserId" = $1', [PHOTO_USER]);
    await query('DELETE FROM "People" WHERE "UserId" = $1', [PHOTO_USER]);
  });

  const imported = async () => {
    await importGedcomService({ file: new File([GED], 'family_tree.ged', { type: 'text/plain' }), mode: 'overwrite', currentUserId: PHOTO_USER });
    const familyId = (await query('SELECT "Id" FROM "Families" WHERE "TreeId" = $1 LIMIT 1', [treeId])).rows[0].Id as number;
    const byTitle = async (title: string) => (await query('SELECT "Id" FROM "Media" WHERE "TreeId" = $1 AND "Title" = $2', [treeId, title])).rows[0].Id as number;
    return { familyId, wedding: await byTitle('Wedding'), farm: await byTitle('Farm') };
  };
  const photoOf = async (familyId: number) => (await getFamilyService({ id: familyId, ...ctx() })).photo?.Id ?? null;

  it('imports `_PRIM @F…@` as the family photo', async () => {
    const { familyId, wedding } = await imported();
    expect(await photoOf(familyId)).toBe(wedding);
    const gallery = await getMediaGalleryForOwner('Families', familyId, treeId);
    expect(gallery.filter((m) => m.IsFamilyPhoto).map((m) => m.Id)).toEqual([wedding]);

  });

  it('keeps one family photo, audits each choice, and Undo brings the earlier one back', async () => {
    const { familyId, wedding, farm } = await imported();
    const { auditIds } = await setFamilyPhotoService({ ...ctx(), mediaId: farm, familyId });
    expect(await photoOf(familyId)).toBe(farm);
    const primaries = await query(
      `SELECT "MediaId" FROM "MediaLink" WHERE "OwnerTable" = 'Families' AND "OwnerId" = $1 AND "IsPrimary" = 1`, [familyId]);
    expect(primaries.rows).toEqual([{ MediaId: farm }]);

    const entry = await query('SELECT "Changes", "EntityLabel" FROM "AuditLog" WHERE "Id" = $1', [auditIds[0]]);
    expect(entry.rows[0].Changes).toEqual({
      summary: { kind: 'family_photo' }, familyId, fields: { FamilyPhotoMediaId: { old: wedding, new: farm } },
    });
    expect(entry.rows[0].EntityLabel).toBe('Family photo — Johan Lind & Kristina Berg');

    await revertAuditEntries(auditIds, treeId, PHOTO_USER, PHOTO_USER);
    expect(await photoOf(familyId)).toBe(wedding);
  });

  it('clears only the current photo, and a stale clear changes nothing', async () => {
    const { familyId, wedding, farm } = await imported();
    expect((await clearFamilyPhotoService({ ...ctx(), mediaId: farm, familyId })).auditIds).toEqual([]);
    expect(await photoOf(familyId)).toBe(wedding);
    const { auditIds } = await clearFamilyPhotoService({ ...ctx(), mediaId: wedding, familyId });
    expect(auditIds).toHaveLength(1);
    expect(await photoOf(familyId)).toBeNull();
    // The photo stays with the family.
    expect((await getMediaGalleryForOwner('Families', familyId, treeId)).map((m) => m.Id).sort()).toEqual([wedding, farm].sort());
  });

  it('refuses a PDF, and never makes a marriage photo the family photo', async () => {
    const { familyId, farm } = await imported();
    await query(`UPDATE "Media" SET "ContentType" = 'application/pdf' WHERE "Id" = $1`, [farm]);
    await expect(setFamilyPhotoService({ ...ctx(), mediaId: farm, familyId })).rejects.toBeInstanceOf(ValidationError);
    await query(`INSERT INTO "MediaLink" ("MediaId", "OwnerTable", "OwnerId", "OwnerFact") VALUES ($1, 'Families', $2, 'Marriage')`, [farm, familyId]);
    await expect(query(
      `UPDATE "MediaLink" SET "IsPrimary" = 1 WHERE "MediaId" = $1 AND "OwnerFact" = 'Marriage'`, [farm],
    )).rejects.toThrow(/medialink_primary_record_level/);
  });
});
