import type { DbExecutor } from './init-schema';
import { liftCitationLink } from '../gedcom/citation-link';

/**
 * Lifts the first link line (`_LINK`, `_URL` or `WWW`) out of each citation's
 * passthrough into `Citation."Url"` (#1024, ADR 0025), with the same helper the
 * import uses, so a tree imported before the column existed neither loses its
 * links nor exports them twice.
 *
 * Runs until it has finished once (see initializeSchema). Run after that, it
 * would lift a citation's second link line once someone had cleared the first.
 * Each write is guarded on the row still being as read, so two servers starting
 * together, or a run after one that failed partway, can't lift a citation twice.
 */
export async function backfillCitationLinks(db: DbExecutor): Promise<number> {
  const res = await db.query(
    `SELECT "Id", "RawGedcom" FROM "Citation"
     WHERE "Url" IS NULL
       AND ("RawGedcom" LIKE '%LINK%' OR "RawGedcom" LIKE '%URL%' OR "RawGedcom" LIKE '%WWW%')`,
  );
  let lifted = 0;
  for (const row of res.rows as Array<{ Id: number; RawGedcom: string }>) {
    const { url, rest } = liftCitationLink(row.RawGedcom.split('\n'));
    if (url === null) continue;
    await db.query(
      `UPDATE "Citation" SET "Url" = $2, "RawGedcom" = $3
       WHERE "Id" = $1 AND "Url" IS NULL AND "RawGedcom" = $4`,
      [row.Id, url, rest.length ? rest.join('\n') : null, row.RawGedcom],
    );
    lifted++;
  }
  return lifted;
}
