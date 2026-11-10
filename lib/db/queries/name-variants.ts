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
