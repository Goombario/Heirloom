// Table snapshots and their comparison, shared by the hosted and static upgrade
// checks (#811). A snapshot is every public table's rows, in a form that survives
// JSON: timestamps as ISO instants, bytes as a sha256, bigints as strings.
import { createHash } from 'node:crypto';

export type Rows = Record<string, unknown>[];
export type Snapshot = Record<string, Rows>;
type Query = (sql: string) => Promise<Rows>;

function plain(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return `sha256:${createHash('sha256').update(value).digest('hex')}`;
  if (typeof value === 'bigint') return String(value);
  if (Array.isArray(value)) return value.map(plain);
  return value;
}

export async function snapshotTables(query: Query): Promise<Snapshot> {
  const tables = (await query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`))
    .map((r) => r.tablename as string);
  const out: Snapshot = {};
  for (const table of tables) {
    out[table] = (await query(`SELECT * FROM "${table}"`)).map((row) =>
      Object.fromEntries(Object.entries(row).map(([k, v]) => [k, plain(v)])));
  }
  return out;
}

export interface Comparison {
  /** Rows or tables gone: the upgrade lost data. */
  lost: string[];
  /** Values in a column the old schema had that now differ: a migration rewrote them. Review. */
  changed: string[];
  /** Added tables and columns, with the non-null rows a backfill filled in. */
  added: string[];
  unchanged: number;
}

const key = (row: Record<string, unknown>, columns: string[]) => JSON.stringify(columns.map((c) => row[c]));

/** Compare two snapshots on the columns the older one had. `_SchemaMeta` is the version and is skipped. */
export function compareSnapshots(before: Snapshot, after: Snapshot): Comparison {
  const result: Comparison = { lost: [], changed: [], added: [], unchanged: 0 };
  for (const table of Object.keys(after).sort()) {
    if (!(table in before)) result.added.push(`table ${table} (${after[table].length} rows)`);
  }
  for (const table of Object.keys(before).sort()) {
    if (table === '_SchemaMeta') continue;
    const old = before[table];
    const now = after[table];
    if (!now) { result.lost.push(`table ${table} (${old.length} rows)`); continue; }
    if (now.length < old.length) result.lost.push(`${table}: ${old.length} → ${now.length} rows`);
    else if (now.length > old.length) result.changed.push(`${table}: ${old.length} → ${now.length} rows`);

    const oldColumns = Object.keys(old[0] ?? now[0] ?? {});
    const newColumns = Object.keys(now[0] ?? {}).filter((c) => !oldColumns.includes(c));
    for (const column of newColumns) {
      const filled = now.filter((r) => r[column] != null).length;
      result.added.push(`${table}."${column}" (${filled} of ${now.length} rows non-null)`);
    }

    const a = old.map((r) => key(r, oldColumns)).sort();
    const b = now.map((r) => key(r, oldColumns)).sort();
    if (JSON.stringify(a) === JSON.stringify(b)) { result.unchanged++; continue; }
    if (!oldColumns.includes('Id')) { result.changed.push(`${table}: rows differ (no "Id" to pair them)`); continue; }
    const byId = new Map(now.map((r) => [r.Id, r]));
    const columns = new Map<string, number>();
    for (const r of old) {
      const n = byId.get(r.Id);
      if (!n) continue;
      for (const c of oldColumns) if (JSON.stringify(r[c]) !== JSON.stringify(n[c])) columns.set(c, (columns.get(c) ?? 0) + 1);
    }
    for (const [c, n] of columns) result.changed.push(`${table}."${c}": ${n} rows`);
  }
  return result;
}

export function printComparison(label: string, c: Comparison): void {
  console.log(`\n${label}: ${c.unchanged} tables unchanged`);
  for (const [heading, lines] of [['LOST', c.lost], ['Changed (review)', c.changed], ['Added', c.added]] as const) {
    if (lines.length) console.log(`  ${heading}:\n${lines.map((l) => `    ${l}`).join('\n')}`);
  }
}
