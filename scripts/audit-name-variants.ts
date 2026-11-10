import { Pool } from 'pg';

/**
 * Read-only report on NameVariant rows that look like they were produced by one
 * of two fixed defects. It DELETES NOTHING and writes nothing — it exists so a
 * human can look at real family data and decide, because neither signature can
 * be cleaned up safely by a rule.
 *
 *   npm run audit:names            # against .env.local
 *   npm run audit:names:test       # against the throwaway test db
 *
 * Two signatures:
 *
 *  1. DUPLICATE VARIANTS — several rows sharing (PersonId, Type, Name, dates).
 *     Produced by #398, where the GEDCOM line path and the sources.json loop
 *     each inserted the same row, doubling nickname lists on every round trip.
 *     These are mostly SELF-HEALING: under ADR 0009 a variant is identified by
 *     its value, so the next export -> import collapses them onto one row and
 *     merges their citations. Listed anyway, because until you round-trip they
 *     are still visible in NamesPanel.
 *
 *  2. SHARED VARIANTS — the same (Type, Name) on several different people.
 *     The signature of #474, where "Save & add another" carried one person's
 *     nickname onto every later person in the session. Ordered by CreatedAt so
 *     an unattended leak shows up as a BURST of near-identical timestamps across
 *     unrelated people — that clustering, not the repetition itself, is the
 *     tell. This one cannot be auto-cleaned: a genuinely shared name (a family
 *     nickname, a repeated maiden name) is indistinguishable by value alone.
 */

async function main() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        console.error('DATABASE_URL is not set. Check the env file the npm script points at.');
        process.exit(1);
    }

    const pool = new Pool({ connectionString });
    try {
        // ── 1. Duplicates on one person ──────────────────────────────────────
        const duplicates = await pool.query(`
            SELECT nv."TreeId",
                   nv."PersonId",
                   COALESCE(p."FirstName", '') || ' ' || COALESCE(p."LastName", '') AS "person",
                   nv."Type",
                   nv."Name",
                   COUNT(*)::int AS "copies",
                   MIN(nv."Id")::int AS "keepId",
                   STRING_AGG(nv."Id"::text, ', ' ORDER BY nv."Id") AS "allIds"
              FROM "NameVariant" nv
              LEFT JOIN "People" p ON p."Id" = nv."PersonId"
             GROUP BY nv."TreeId", nv."PersonId", p."FirstName", p."LastName",
                      nv."Type", nv."Name", nv."FromDate", nv."ToDate"
            HAVING COUNT(*) > 1
             ORDER BY COUNT(*) DESC, nv."PersonId"
        `);

        console.log('\n=== 1. Duplicate variants on the same person (#398 signature) ===');
        if (duplicates.rows.length === 0) {
            console.log('None.');
        } else {
            console.table(duplicates.rows);
            const extra = duplicates.rows.reduce(
                (sum: number, r: { copies: number }) => sum + (r.copies - 1),
                0,
            );
            console.log(
                `${duplicates.rows.length} duplicated value(s), ${extra} redundant row(s).\n` +
                'These collapse by themselves on the next GEDCOM export -> import (ADR 0009).',
            );
        }

        // ── 2. Same variant across different people ──────────────────────────
        const shared = await pool.query(`
            WITH shared AS (
                SELECT "TreeId", "Type", "Name"
                  FROM "NameVariant"
                 GROUP BY "TreeId", "Type", "Name"
                HAVING COUNT(DISTINCT "PersonId") > 1
            )
            SELECT nv."TreeId",
                   nv."Type",
                   nv."Name",
                   nv."PersonId",
                   COALESCE(p."FirstName", '') || ' ' || COALESCE(p."LastName", '') AS "person",
                   nv."IsPrimary",
                   nv."CreatedAt"
              FROM "NameVariant" nv
              JOIN shared s
                ON s."TreeId" IS NOT DISTINCT FROM nv."TreeId"
               AND s."Type" = nv."Type"
               AND s."Name" = nv."Name"
              LEFT JOIN "People" p ON p."Id" = nv."PersonId"
             ORDER BY nv."TreeId", nv."Type", nv."Name", nv."CreatedAt"
        `);

        console.log('\n=== 2. Same variant on several people (#474 leak signature) ===');
        if (shared.rows.length === 0) {
            console.log('None.');
        } else {
            console.table(shared.rows);
            console.log(
                'Look for a BURST of near-identical CreatedAt values across unrelated people —\n' +
                'that is the unattended leak. Repetition alone is legitimate (a family nickname,\n' +
                'a repeated maiden name), which is why nothing here is deleted automatically.\n' +
                'Rows with IsPrimary=1 matter most: those change the displayed name (ADR 0001).',
            );
        }

        console.log('\nRead-only report. Nothing was modified.\n');
    } finally {
        await pool.end();
    }
}

main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
});
