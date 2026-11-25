import { query } from '@/lib/db/connection';
import { factPlaceTextColumns } from './place-links';
import { primaryPhotoJoin } from './media-tags';

/**
 * The reads behind advanced search on the People list (#247). Each loads one
 * slice of a tree; the service loads only the slices its query's fields need and
 * evaluates the conditions (lib/search/evaluate-people.ts).
 */

export interface SearchPersonRow {
    Id: number;
    FirstName: string | null;
    LastName: string | null;
    Sex: string | null;
    BirthDate: string | null;
    DeathDate: string | null;
    BirthPlace: string | null;
    DeathPlace: string | null;
    BirthPlaceId: number | null;
    DeathPlaceId: number | null;
    IsDeceased: number | null;
    CreatedAt: string | Date | null;
    UpdatedAt: string | Date | null;
    HasPhoto: boolean;
}

export async function loadSearchPeople(treeId: number): Promise<SearchPersonRow[]> {
    const res = await query(
        `SELECT p."Id", p."FirstName", p."LastName", p."Sex", p."BirthDate", p."DeathDate",
                ${factPlaceTextColumns('people', 'p')}, p."BirthPlaceId", p."DeathPlaceId",
                p."IsDeceased", p."CreatedAt", p."UpdatedAt", (m."Id" IS NOT NULL) AS "HasPhoto"
           FROM "People" p
           ${primaryPhotoJoin('p', 'p."TreeId"', 'm')}
          WHERE p."TreeId" = $1`,
        [treeId],
    );
    return res.rows as SearchPersonRow[];
}

/** Every other name a person carries (married names, aliases, nicknames). */
export async function loadSearchNames(treeId: number): Promise<Array<{ PersonId: number; Name: string }>> {
    const res = await query(
        `SELECT nv."PersonId", nv."Name" FROM "NameVariant" nv WHERE nv."TreeId" = $1`,
        [treeId],
    );
    return res.rows as Array<{ PersonId: number; Name: string }>;
}

export interface SearchFamilyRow {
    Id: number;
    Partner1Id: number | null;
    Partner2Id: number | null;
    MarriageDate: string | null;
}

/** Partnerships, and which children each has. */
export async function loadSearchFamilies(treeId: number): Promise<{ families: SearchFamilyRow[]; children: Array<{ FamilyId: number; ChildId: number }> }> {
    const [families, children] = await Promise.all([
        query(
            `SELECT f."Id", COALESCE(f."Partner1Id", f."HusbandId") AS "Partner1Id",
                    COALESCE(f."Partner2Id", f."WifeId") AS "Partner2Id", f."MarriageDate"
               FROM "Families" f WHERE f."TreeId" = $1`,
            [treeId],
        ),
        query(
            `SELECT fp."FamiliesAsChildId" AS "FamilyId", fp."ChildrenId" AS "ChildId"
               FROM "FamilyPerson" fp JOIN "Families" f ON f."Id" = fp."FamiliesAsChildId"
              WHERE f."TreeId" = $1`,
            [treeId],
        ),
    ]);
    return { families: families.rows as SearchFamilyRow[], children: children.rows as Array<{ FamilyId: number; ChildId: number }> };
}

/** Event types: a person's own, and a family's (which count for both partners). */
export async function loadSearchEvents(treeId: number): Promise<Array<{ PersonId: number | null; FamilyId: number | null; Type: string }>> {
    const res = await query(
        `SELECT e."PersonId", e."FamilyId", e."Type" FROM "Events" e WHERE e."TreeId" = $1`,
        [treeId],
    );
    return res.rows as Array<{ PersonId: number | null; FamilyId: number | null; Type: string }>;
}

/** Places and the place each sits inside, for "is in" (a place and everything inside it). */
export async function loadSearchPlaces(treeId: number): Promise<Array<{ Id: number; Name: string; ParentId: number | null }>> {
    const res = await query(
        `SELECT pl."Id", pl."Name", pl."ParentId" FROM "Places" pl WHERE pl."TreeId" = $1`,
        [treeId],
    );
    return res.rows as Array<{ Id: number; Name: string; ParentId: number | null }>;
}

/**
 * Which sources each person's facts cite: the person record, birth, death, name,
 * their other names and their own events.
 */
export async function loadSearchCitations(treeId: number): Promise<Array<{ PersonId: number; SourceId: number }>> {
    const res = await query(
        `SELECT c."FactId" AS "PersonId", c."SourceId" FROM "Citation" c
          WHERE c."TreeId" = $1 AND c."FactTable" IN ('People', 'PersonBirth', 'PersonDeath', 'PersonName')
         UNION
         SELECT e."PersonId", c."SourceId" FROM "Citation" c JOIN "Events" e ON e."Id" = c."FactId"
          WHERE c."TreeId" = $1 AND c."FactTable" = 'Events' AND e."PersonId" IS NOT NULL
         UNION
         SELECT nv."PersonId", c."SourceId" FROM "Citation" c JOIN "NameVariant" nv ON nv."Id" = c."FactId"
          WHERE c."TreeId" = $1 AND c."FactTable" = 'NameVariant'`,
        [treeId],
    );
    return res.rows as Array<{ PersonId: number; SourceId: number }>;
}

/** The research cases each person is part of. */
export async function loadSearchCases(treeId: number): Promise<Array<{ PersonId: number; CaseId: number }>> {
    const res = await query(
        `SELECT cp."PersonId", cp."CaseId" FROM "CasePerson" cp JOIN "Cases" c ON c."Id" = cp."CaseId"
          WHERE c."TreeId" = $1`,
        [treeId],
    );
    return res.rows as Array<{ PersonId: number; CaseId: number }>;
}

/** The text of each note on a person, theirs or on one of their facts. */
export async function loadSearchNotes(treeId: number): Promise<Array<{ PersonId: number; Text: string }>> {
    const res = await query(
        `SELECT nl."OwnerId" AS "PersonId", n."Text" FROM "NoteLink" nl JOIN "Note" n ON n."Id" = nl."NoteId"
          WHERE n."TreeId" = $1 AND nl."OwnerTable" = 'People'
         UNION ALL
         SELECT e."PersonId", n."Text" FROM "NoteLink" nl JOIN "Note" n ON n."Id" = nl."NoteId"
           JOIN "Events" e ON e."Id" = nl."OwnerId"
          WHERE n."TreeId" = $1 AND nl."OwnerTable" = 'Events' AND e."PersonId" IS NOT NULL`,
        [treeId],
    );
    return res.rows as Array<{ PersonId: number; Text: string }>;
}
