/**
 * Put a row an audit snapshot kept back into its table, under its old id, inside
 * an open transaction. Only columns the table still has are written, so a
 * snapshot taken before a column was dropped still restores (#1229).
 */

type Exec = { query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }> };

/** The tables a snapshot restore may write; the name is interpolated, so it is a closed list. */
type SnapshotTable = 'Places' | 'PlaceName';

async function tableColumns(exec: Exec, table: SnapshotTable): Promise<Set<string>> {
    const res = await exec.query(`SELECT column_name FROM information_schema.columns WHERE table_name = $1`, [table]);
    return new Set((res.rows as { column_name: string }[]).map((r) => r.column_name));
}

/** Insert `row` with `overrides` applied (a scope column the caller vouches for). */
export async function insertSnapshotRow(
    exec: Exec,
    table: SnapshotTable,
    row: Record<string, unknown>,
    overrides: Record<string, unknown> = {},
): Promise<void> {
    const columns = await tableColumns(exec, table);
    const values = { ...row, ...overrides };
    const cols = Object.keys(values).filter((c) => columns.has(c));
    await exec.query(
        `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(', ')})
         VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
        cols.map((c) => values[c]),
    );
}
