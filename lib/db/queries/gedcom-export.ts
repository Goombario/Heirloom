import { query } from '@/lib/db/connection';
import type { Family, GedcomEvent, Media, MediaImportItem, Person } from '@/lib/db/schema';
import { factPlaceTextColumns } from '@/lib/db/queries/place-links';

/**
 * Batched read statements for GEDCOM export. Every fetch is a single
 * TreeId-scoped query for the whole tree; the export service groups the rows
 * in memory (see `lib/services/gedcom-export.ts`). This replaces the former
 * per-person / per-family N+1 loops in the route handler.
 */

/**
 * A family row as read for export. `SELECT *` also returns the legacy
 * `HusbandId`/`WifeId` columns (absent from the `Family` type but present in the
 * table); the export groups spouse families on them, exactly as the old route's
 * `WHERE "HusbandId" = $1` / `WHERE "WifeId" = $1` queries did.
 */
export type ExportFamilyRow = Family & { HusbandId: number | null; WifeId: number | null };

/** All people in the tree, in the export's canonical order. */
export async function getPeopleForExport(treeId: number): Promise<Person[]> {
    const result = await query(
        `SELECT p.*, ${factPlaceTextColumns('people', 'p')} FROM "People" p WHERE p."TreeId" = $1 ORDER BY p."LastName", p."FirstName", p."Id"`,
        [treeId]
    );
    return result.rows as Person[];
}

/** All families in the tree. `ORDER BY "Id"` gives a stable order for the
 *  spouse-family grouping (the old per-person queries were unordered). */
export async function getFamiliesForExport(treeId: number): Promise<ExportFamilyRow[]> {
    const result = await query(
        `SELECT f.*, ${factPlaceTextColumns('families', 'f')} FROM "Families" f WHERE f."TreeId" = $1 ORDER BY f."Id"`,
        [treeId]
    );
    return result.rows as ExportFamilyRow[];
}

/** Family rows tagged with the child that links them (`FamilyPerson`), for the
 *  per-person `familiesAsChild` grouping. */
export async function getFamilyChildLinksForExport(
    treeId: number
): Promise<(Family & { ChildrenId: number })[]> {
    const result = await query(
        `SELECT f.*, ${factPlaceTextColumns('families', 'f')}, fp."ChildrenId" FROM "Families" f
         INNER JOIN "FamilyPerson" fp ON f."Id" = fp."FamiliesAsChildId"
         WHERE f."TreeId" = $1
         ORDER BY fp."ChildrenId", f."Id"`,
        [treeId]
    );
    return result.rows as (Family & { ChildrenId: number })[];
}

/** Child people tagged with their parent-family id, relationship to each partner and link
 *  passthrough, for the per-family `children` grouping. Ordered by birth date
 *  within each family, matching the old per-family query. */
export async function getFamilyChildrenForExport(
    treeId: number
): Promise<(Person & { Partner1Relationship?: string; Partner2Relationship?: string; FamcRawGedcom: string | null; ChilRawGedcom: string | null; FamiliesAsChildId: number })[]> {
    const result = await query(
        `SELECT p.*, ${factPlaceTextColumns('people', 'p')}, fp."Partner1Relationship", fp."Partner2Relationship", fp."FamcRawGedcom", fp."ChilRawGedcom", fp."FamiliesAsChildId" FROM "People" p
         INNER JOIN "FamilyPerson" fp ON p."Id" = fp."ChildrenId"
         WHERE p."TreeId" = $1
         ORDER BY fp."FamiliesAsChildId", p."BirthDate"`,
        [treeId]
    );
    return result.rows as (Person & { Partner1Relationship?: string; Partner2Relationship?: string; FamcRawGedcom: string | null; ChilRawGedcom: string | null; FamiliesAsChildId: number })[];
}

/** Every event in the tree, date-ordered. The service buckets by `PersonId`
 *  (individual events) and `FamilyId` (family events); date order is preserved
 *  within each bucket. */
export async function getEventsForExport(treeId: number): Promise<GedcomEvent[]> {
    const result = await query(
        `SELECT e.*, ${factPlaceTextColumns('events', 'e')} FROM "Events" e WHERE e."TreeId" = $1 ORDER BY e."Date"`,
        [treeId]
    );
    return result.rows as GedcomEvent[];
}

/** Every media row in the tree. One fetch serves person media (bucketed by
 *  `PersonId`), the inline-OBJE media list, and the library-media sidecar. */
export async function getMediaForExport(treeId: number): Promise<Media[]> {
    const result = await query(
        'SELECT * FROM "Media" WHERE "TreeId" = $1 ORDER BY "Id"',
        [treeId]
    );
    return result.rows as Media[];
}

/** Durable import state used by export preflight. Includes ready rows because
 * the shared core also needs to distinguish a ready row with missing bytes. */
export async function getMediaImportItemsForExport(treeId: number): Promise<MediaImportItem[]> {
    const result = await query(
        'SELECT * FROM "MediaImportItem" WHERE "TreeId" = $1 ORDER BY "Id"',
        [treeId],
    );
    return result.rows.map((row) => ({
        id: Number(row.Id),
        importId: String(row.ImportId),
        documentMediaId: String(row.DocumentMediaId),
        treeId: Number(row.TreeId),
        mediaId: Number(row.MediaId),
        archivePath: String(row.ArchivePath),
        originalFilename: String(row.OriginalFilename),
        status: row.Status as MediaImportItem['status'],
        failureCode: (row.FailureCode as MediaImportItem['failureCode']) ?? null,
        skipFaceCapture: Number(row.SkipFaceCapture) === 1,
    }));
}

/** MediaBlob bytes paired with their tree-scoped Media row for local export. */
export interface MediaBlobExportRow {
    Id: number;
    Data: Uint8Array | null;
}

/** Read local media bytes without allowing rows from another tree into export. */
export async function getMediaBlobsForExport(treeId: number): Promise<MediaBlobExportRow[]> {
    const result = await query(
        `SELECT m."Id", b."Data"
           FROM "Media" m LEFT JOIN "MediaBlob" b ON b."MediaId" = m."Id"
          WHERE m."TreeId" = $1 ORDER BY m."Id"`,
        [treeId],
    );
    return result.rows as MediaBlobExportRow[];
}
