import { factPlaceRefs, factPlaceTextColumns, type FactPlaceField } from '@/lib/db/queries/place-links';

interface Exec {
    query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

type RecordTable = 'People' | 'Families' | 'Events';

const PLACE_FIELDS: Record<RecordTable, FactPlaceField[]> = {
    People: ['BirthPlace', 'DeathPlace'],
    Families: ['MarriagePlace'],
    Events: ['Place'],
};

const RECORDS = { People: 'people', Families: 'families', Events: 'events' } as const;

/**
 * Insert a person, family or event the way a save writes one (ADR 0037): place
 * text given as "BirthPlace" and the rest is matched (or created) as a place in the
 * row's tree and stored as references. Returns the row with its built place text.
 */
export async function insertRecord(
    exec: Exec,
    table: RecordTable,
    values: Record<string, unknown>,
): Promise<Record<string, unknown> & { Id: number }> {
    const texts: Partial<Record<FactPlaceField, string | null>> = {};
    const plain: [string, unknown][] = [];
    for (const [column, value] of Object.entries(values)) {
        if ((PLACE_FIELDS[table] as string[]).includes(column)) texts[column as FactPlaceField] = value as string | null;
        else plain.push([`"${column}"`, value]);
    }
    if (Object.keys(texts).length > 0) {
        const treeId = values.TreeId as number;
        const userId = (values.UserId ?? values.OwnerId) as number;
        plain.push(...await factPlaceRefs(exec, treeId, userId, texts));
    }
    const res = await exec.query(
        `INSERT INTO "${table}" (${plain.map(([c]) => c).join(', ')})
         VALUES (${plain.map((_, i) => `$${i + 1}`).join(', ')})
         RETURNING *, ${factPlaceTextColumns(RECORDS[table], `"${table}"`)}`,
        plain.map(([, v]) => v),
    );
    return res.rows[0] as Record<string, unknown> & { Id: number };
}

/** The place text a record's fact shows now, built from its references. */
export async function factPlaceText(exec: Exec, table: RecordTable, id: number, field: FactPlaceField): Promise<string | null> {
    const res = await exec.query(
        `SELECT ${factPlaceTextColumns(RECORDS[table], 'r')} FROM "${table}" r WHERE r."Id" = $1`,
        [id],
    );
    return ((res.rows[0] ?? {}) as Record<string, string | null>)[field] ?? null;
}
