import type { DbExecutor } from './init-schema';
import { liftNameParts } from '../gedcom/name-parts';

/**
 * Lifts the first `NPFX`, `SPFX` and `NSFX` out of each person's primary-name passthrough
 * into their own columns (#37, ADR 0053), with the same helper the import uses, so a tree
 * imported before the columns existed shows them and doesn't export them twice. Where the
 * first or last name also carries the piece ("Dr Johann"), it is taken off, as on import.
 *
 * Runs until it has finished once (see initializeSchema). Each write is guarded on the
 * row still being as read, so two servers starting together can't lift a line twice.
 */
export async function backfillNameParts(db: DbExecutor): Promise<number> {
  const res = await db.query(
    `SELECT "Id", "FirstName", "LastName", "NameRawGedcom" FROM "People"
     WHERE "NamePrefix" IS NULL AND "SurnamePrefix" IS NULL AND "NameSuffix" IS NULL
       AND ("NameRawGedcom" LIKE '%NPFX%' OR "NameRawGedcom" LIKE '%SPFX%' OR "NameRawGedcom" LIKE '%NSFX%')`,
  );
  let lifted = 0;
  for (const row of res.rows as Array<{ Id: number; FirstName: string | null; LastName: string | null; NameRawGedcom: string }>) {
    const parts = liftNameParts(row.NameRawGedcom.split('\n'), row);
    if (parts.NamePrefix === null && parts.SurnamePrefix === null && parts.NameSuffix === null) continue;
    await db.query(
      `UPDATE "People" SET "NamePrefix" = $2, "SurnamePrefix" = $3, "NameSuffix" = $4,
         "FirstName" = $5, "LastName" = $6, "NameRawGedcom" = $7
       WHERE "Id" = $1 AND "NamePrefix" IS NULL AND "SurnamePrefix" IS NULL AND "NameSuffix" IS NULL
         AND "NameRawGedcom" = $8`,
      [row.Id, parts.NamePrefix, parts.SurnamePrefix, parts.NameSuffix, parts.FirstName, parts.LastName,
        parts.rest.length ? parts.rest.join('\n') : null, row.NameRawGedcom],
    );
    lifted++;
  }
  return lifted;
}
