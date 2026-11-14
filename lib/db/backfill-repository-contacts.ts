import type { DbExecutor } from './init-schema';
import { liftRepositoryContacts } from '../gedcom/repository-contacts';

/**
 * Lifts the first `WWW`, `PHON` and `EMAIL` out of each repository's passthrough
 * into its own columns (#40, ADR 0049), with the same helper the import uses, so a
 * tree imported before the columns existed neither hides them nor exports them twice.
 *
 * Runs until it has finished once (see initializeSchema). Each write is guarded on the
 * row still being as read, so two servers starting together can't lift a line twice.
 */
export async function backfillRepositoryContacts(db: DbExecutor): Promise<number> {
  const res = await db.query(
    `SELECT "Id", "RawGedcom" FROM "Repository"
     WHERE "Website" IS NULL AND "Phone" IS NULL AND "Email" IS NULL
       AND ("RawGedcom" LIKE '%WWW%' OR "RawGedcom" LIKE '%PHON%' OR "RawGedcom" LIKE '%EMAIL%')`,
  );
  let lifted = 0;
  for (const row of res.rows as Array<{ Id: number; RawGedcom: string }>) {
    const { Website, Phone, Email, rest } = liftRepositoryContacts(row.RawGedcom.split('\n'));
    if (Website === null && Phone === null && Email === null) continue;
    await db.query(
      `UPDATE "Repository" SET "Website" = $2, "Phone" = $3, "Email" = $4, "RawGedcom" = $5
       WHERE "Id" = $1 AND "Website" IS NULL AND "Phone" IS NULL AND "Email" IS NULL AND "RawGedcom" = $6`,
      [row.Id, Website, Phone, Email, rest.length ? rest.join('\n') : null, row.RawGedcom],
    );
    lifted++;
  }
  return lifted;
}
