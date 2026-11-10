/**
 * Planner statistics (#1268). Postgres plans every query from the row counts
 * `ANALYZE` stores. Hosted Postgres refreshes them through autovacuum, but
 * PGlite (the static and desktop builds) has no autovacuum: a tree imported
 * there was never analyzed, so the planner assumed each table held a couple of
 * dozen rows and picked nested loops. On the 4,834-person fixture that made the
 * People list query take 1.4 s instead of 0.2 s.
 */

/** Tables whose row counts drive the plans of the list, tree and detail reads. */
const ANALYZED_TABLES = [
  'People', 'Families', 'FamilyPerson', 'Events', 'Citation', 'NameVariant',
  'Media', 'MediaLink', 'MediaTag', 'Places', 'PlaceName', 'Sources', 'Note', 'NoteLink',
] as const;

export const ANALYZE_SQL = `ANALYZE ${ANALYZED_TABLES.map((t) => `"${t}"`).join(', ')}`;

/** Below this many people, any plan is fast enough that stale stats don't matter. */
const STALE_CHECK_MIN_PEOPLE = 500;

/**
 * Whether `People` has grown or shrunk past what the planner last saw: never
 * analyzed (`reltuples` is -1), or off by more than half either way. Cheap: a
 * catalog lookup and an index-only count.
 */
export function plannerStatsAreStale(reltuples: number, people: number): boolean {
  if (people < STALE_CHECK_MIN_PEOPLE) return false;
  if (reltuples < 0) return true;
  return people > reltuples * 2 || people < reltuples / 2;
}

/** Run with any query function, so the PGlite boot path can call it before the pool exists. */
export async function refreshPlannerStatsIfStale(
  run: (text: string) => Promise<{ rows: unknown[] }>,
): Promise<boolean> {
  const res = await run(
    `SELECT (SELECT reltuples FROM pg_class WHERE oid = '"People"'::regclass)::float8 AS reltuples,
            (SELECT COUNT(*) FROM "People")::int AS people`,
  );
  const row = res.rows[0] as { reltuples: number; people: number } | undefined;
  if (!row || !plannerStatsAreStale(Number(row.reltuples), Number(row.people))) return false;
  await run(ANALYZE_SQL);
  return true;
}
