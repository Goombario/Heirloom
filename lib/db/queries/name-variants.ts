import { query } from '@/lib/db/connection';

export interface NameVariant {
    Id: number;
    OwnerId: number;
    PersonId: number;
    Type: string;
    Name: string;
    FromDate: string | null;
    ToDate: string | null;
    CreatedAt: string;
    IsPrimary: number;
}

/** All name variants for a tree (used by GEDCOM export). */
export async function getAllNameVariants(treeId: number): Promise<NameVariant[]> {
    const result = await query(
        `SELECT * FROM "NameVariant" WHERE "TreeId" = $1 ORDER BY "Id" ASC`,
        [treeId]
    );
    return result.rows as NameVariant[];
}

/** A tree's name variants for the tree cards' second line, preferred first per person. */
export async function getTreeCardNameVariants(
    treeId: number
): Promise<Array<Pick<NameVariant, 'PersonId' | 'Type' | 'Name' | 'IsPrimary'>>> {
    const result = await query(
        `SELECT "PersonId", "Type", "Name", "IsPrimary" FROM "NameVariant"
         WHERE "TreeId" = $1
         ORDER BY "PersonId", "IsPrimary" DESC, "Id"`,
        [treeId]
    );
    return result.rows as Array<Pick<NameVariant, 'PersonId' | 'Type' | 'Name' | 'IsPrimary'>>;
}
