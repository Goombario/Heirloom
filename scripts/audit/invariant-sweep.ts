// Read-only invariant sweep (#864): the tree-scoping and linking invariants the
// schema doesn't enforce, checked on a real database. Runs on Postgres and
// PGlite through the same `DbExecutor`; `invariant-sweep-cli.ts` is the entry.
//
// Two kinds of finding:
// - a **violation** is data that should never exist (a link into another tree,
//   an owner column that disagrees with the tree, a reference to a row that was
//   never deleted through the app). The CLI exits non-zero on any.
// - a **strand** is a row left pointing at a parent that the app deleted and
//   audited. Deletes keep these on purpose so a revert can bring the parent back
//   with its original id (`lib/db/queries/person-dependents.ts`). They are
//   reported, not failed; #881 decides their retention.
//
// Enforced by the schema, so not swept: one primary name / note / photo per
// owner (partial unique indexes), MediaBlob → Media and Citation → Sources
// (foreign keys). Files on disk that no Media row references are swept by
// `scripts/sweep-orphan-media.mjs` (#860).

import { FACT_TABLES, LINK_OWNER_TABLES, MEDIA_OWNER_TABLES } from '@/lib/db/fact-tables';

export interface DbExecutor {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

interface SweepFinding {
  check: string;
  count: number;
  /** Up to five ids of offending rows (the row's own id, or the missing parent's). */
  sample: number[];
}

export interface SweepReport {
  violations: SweepFinding[];
  strands: SweepFinding[];
}

/** The AuditLog entity type a delete of each parent table records (null: never audited). */
const AUDITED_AS: Record<string, string | null> = {
  People: 'person',
  Families: 'family',
  Events: 'event',
  Media: 'media',
  Cases: 'case',
  Sources: 'source',
  Places: 'place',
  NameVariant: 'namevariant',
  CaseComments: null,
  CaseFindings: null,
  Repository: null,
};

/** `Citation."FactTable"` (lib/db/fact-tables.ts) → the table whose row the FactId names. */
const FACT_BACKING: Record<string, string> = {
  [FACT_TABLES.PEOPLE]: 'People',
  [FACT_TABLES.PERSON_BIRTH]: 'People',
  [FACT_TABLES.PERSON_DEATH]: 'People',
  [FACT_TABLES.PERSON_NAME]: 'People',
  [FACT_TABLES.FAMILIES]: 'Families',
  [FACT_TABLES.FAMILY_MARRIAGE]: 'Families',
  [FACT_TABLES.EVENTS]: 'Events',
  [FACT_TABLES.NAME_VARIANT]: 'NameVariant',
  [FACT_TABLES.CASES]: 'Cases',
  [FACT_TABLES.CASE_COMMENTS]: 'CaseComments',
  [FACT_TABLES.CASE_FINDINGS]: 'CaseFindings',
};

/** The owner vocabularies of the two polymorphic link tables. */
const LINK_OWNERS: Array<[link: 'NoteLink' | 'MediaLink', parent: string, key: string, owners: string[]]> = [
  ['NoteLink', 'Note', 'NoteId', Object.values(LINK_OWNER_TABLES)],
  ['MediaLink', 'Media', 'MediaId', Object.values(MEDIA_OWNER_TABLES)],
];

/** The tree of row `o` in `table`; CaseComments carries no TreeId of its own. */
// Journal entries and case findings (#58) belong to a tree through their case.
const treeOf = (table: string, alias: string): string => table === 'CaseComments' || table === 'CaseFindings'
  ? `(SELECT ca."TreeId" FROM "Cases" ca WHERE ca."Id" = ${alias}."CaseId")`
  : `${alias}."TreeId"`;

/** Tables whose legacy owner column must equal the tree's owner. */
const OWNER_COLUMNS: Record<string, string> = {
  People: 'UserId',
  Families: 'UserId',
  Events: 'UserId',
  Media: 'UserId',
  Cases: 'UserId',
  Places: 'UserId',
  Citation: 'OwnerId',
  NameVariant: 'OwnerId',
  PendingShares: 'OwnerId',
  Note: 'OwnerId',
  Sources: 'OwnerId',
  Repository: 'OwnerId',
};

/** Tree-scoped tables whose TreeId may legitimately be null. */
const NULLABLE_TREE = new Set(['AuditLog']);

const SAMPLE = 5;

const stranded = (entity: string | null, idExpr: string): string => entity
  ? `EXISTS (SELECT 1 FROM "AuditLog" a WHERE a."Action" = 'delete' AND a."EntityType" = '${entity}' AND a."EntityId" = ${idExpr})`
  : 'FALSE';

const quoted = (names: string[]): string => names.map((n) => `'${n}'`).join(', ');

interface Check {
  name: string;
  /** Selects `"Id"` (int) and `"Stranded"` (bool) per offending row. */
  sql: string;
}

function checks(treeScoped: string[]): Check[] {
  const out: Check[] = [];
  const missing = (name: string, from: string, idExpr: string, parent: string, entity: string | null, where = 'TRUE') => out.push({
    name,
    sql: `SELECT ${idExpr} AS "Id", ${stranded(entity, idExpr)} AS "Stranded"
            FROM ${from}
           WHERE ${idExpr} IS NOT NULL AND ${where}
             AND NOT EXISTS (SELECT 1 FROM "${parent}" p WHERE p."Id" = ${idExpr})`,
  });
  const violation = (name: string, sql: string) => out.push({ name, sql: `SELECT x."Id", FALSE AS "Stranded" FROM (${sql}) x` });

  // Missing parents: a strand when the app audited the parent's delete.
  missing('event_person_missing', '"Events" e', 'e."PersonId"', 'People', 'person');
  missing('event_family_missing', '"Events" e', 'e."FamilyId"', 'Families', 'family');
  missing('child_link_family_missing', '"FamilyPerson" fp', 'fp."FamiliesAsChildId"', 'Families', 'family');
  missing('child_link_child_missing', '"FamilyPerson" fp', 'fp."ChildrenId"', 'People', 'person');
  for (const slot of ['Partner1Id', 'Partner2Id', 'HusbandId', 'WifeId']) {
    missing(`partner_${slot}_missing`, '"Families" f', `f."${slot}"`, 'People', 'person');
  }
  for (const [label, table] of Object.entries(FACT_BACKING)) {
    missing(`citation_fact_missing_${label}`, '"Citation" c', 'c."FactId"', table, AUDITED_AS[table], `c."FactTable" = '${label}'`);
  }
  for (const [link, , , owners] of LINK_OWNERS) {
    for (const table of owners) {
      missing(`${link}_owner_missing_${table}`, `"${link}" l`, 'l."OwnerId"', table, AUDITED_AS[table], `l."OwnerTable" = '${table}'`);
    }
  }

  // Vocabularies.
  violation('citation_unknown_fact_table',
    `SELECT "Id" FROM "Citation" WHERE "FactTable" NOT IN (${quoted(Object.keys(FACT_BACKING))})`);
  for (const [link, , key, owners] of LINK_OWNERS) {
    violation(`${link}_unknown_owner_table`,
      `SELECT "${key}" AS "Id" FROM "${link}" WHERE "OwnerTable" NOT IN (${quoted(owners)})`);
  }

  // Cross-tree links.
  violation('cross_tree_event_person',
    `SELECT e."Id" FROM "Events" e JOIN "People" p ON p."Id" = e."PersonId" WHERE e."TreeId" IS DISTINCT FROM p."TreeId"`);
  violation('cross_tree_event_family',
    `SELECT e."Id" FROM "Events" e JOIN "Families" f ON f."Id" = e."FamilyId" WHERE e."TreeId" IS DISTINCT FROM f."TreeId"`);
  violation('cross_tree_child_link',
    `SELECT fp."FamiliesAsChildId" AS "Id" FROM "FamilyPerson" fp
       JOIN "Families" f ON f."Id" = fp."FamiliesAsChildId" JOIN "People" c ON c."Id" = fp."ChildrenId"
      WHERE f."TreeId" IS DISTINCT FROM c."TreeId"`);
  violation('cross_tree_partner',
    `SELECT f."Id" FROM "Families" f JOIN "People" p
         ON p."Id" IN (f."Partner1Id", f."Partner2Id", f."HusbandId", f."WifeId")
      WHERE f."TreeId" IS DISTINCT FROM p."TreeId"`);
  violation('cross_tree_citation_source',
    `SELECT c."Id" FROM "Citation" c JOIN "Sources" s ON s."Id" = c."SourceId" WHERE c."TreeId" IS DISTINCT FROM s."TreeId"`);
  for (const [label, table] of Object.entries(FACT_BACKING)) {
    violation(`cross_tree_citation_fact_${label}`,
      `SELECT c."Id" FROM "Citation" c JOIN "${table}" o ON o."Id" = c."FactId"
        WHERE c."FactTable" = '${label}' AND c."TreeId" IS DISTINCT FROM ${treeOf(table, 'o')}`);
  }
  for (const [link, parent, key, owners] of LINK_OWNERS) {
    for (const table of owners) {
      violation(`cross_tree_${link}_${table}`,
        `SELECT l."${key}" AS "Id" FROM "${link}" l
           JOIN "${parent}" n ON n."Id" = l."${key}" JOIN "${table}" o ON o."Id" = l."OwnerId"
          WHERE l."OwnerTable" = '${table}' AND n."TreeId" IS DISTINCT FROM ${treeOf(table, 'o')}`);
    }
  }
  violation('cross_tree_media_tag',
    `SELECT t."Id" FROM "MediaTag" t JOIN "Media" m ON m."Id" = t."MediaId" JOIN "People" p ON p."Id" = t."PersonId"
      WHERE m."TreeId" IS DISTINCT FROM p."TreeId"`);
  violation('cross_tree_name_variant',
    `SELECT nv."Id" FROM "NameVariant" nv JOIN "People" p ON p."Id" = nv."PersonId" WHERE nv."TreeId" IS DISTINCT FROM p."TreeId"`);

  // Tree scoping and the legacy owner columns.
  for (const [table, ownerColumn] of Object.entries(OWNER_COLUMNS)) {
    violation(`owner_tree_drift_${table}`,
      `SELECT x."Id" FROM "${table}" x JOIN "Trees" t ON t."Id" = x."TreeId" WHERE x."${ownerColumn}" IS DISTINCT FROM t."OwnerId"`);
  }
  for (const table of treeScoped) {
    const id = table === 'TreeSharing' ? '"TreeId"' : '"Id"';
    if (!NULLABLE_TREE.has(table)) violation(`null_tree_id_${table}`, `SELECT ${id} AS "Id" FROM "${table}" WHERE "TreeId" IS NULL`);
    violation(`missing_tree_${table}`,
      `SELECT x.${id} AS "Id" FROM "${table}" x WHERE x."TreeId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Trees" t WHERE t."Id" = x."TreeId")`);
  }

  // Family shape and duplicates.
  violation('partner_column_drift',
    `SELECT "Id" FROM "Families"
      WHERE ("Partner1Id" IS NOT NULL AND "HusbandId" IS NOT NULL AND "Partner1Id" <> "HusbandId")
         OR ("Partner2Id" IS NOT NULL AND "WifeId" IS NOT NULL AND "Partner2Id" <> "WifeId")`);
  violation('empty_family',
    `SELECT f."Id" FROM "Families" f
      WHERE COALESCE(f."Partner1Id", f."HusbandId") IS NULL AND COALESCE(f."Partner2Id", f."WifeId") IS NULL
        AND NOT EXISTS (SELECT 1 FROM "FamilyPerson" fp WHERE fp."FamiliesAsChildId" = f."Id")`);
  violation('duplicate_name_variant',
    `SELECT MIN("Id") AS "Id" FROM "NameVariant" GROUP BY "PersonId", "TreeId", "Type", "Name" HAVING COUNT(*) > 1`);
  return out;
}

async function treeScopedTables(exec: DbExecutor): Promise<string[]> {
  const result = await exec.query(
    `SELECT table_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'TreeId' AND table_name IN (
        SELECT table_name FROM information_schema.columns
         WHERE table_schema = 'public' AND column_name = 'Id'
        UNION SELECT 'TreeSharing')
      ORDER BY 1`,
  );
  return (result.rows as Array<{ table_name: string }>).map((r) => r.table_name);
}

/** Run every check. Read-only. */
export async function runInvariantSweep(exec: DbExecutor): Promise<SweepReport> {
  const report: SweepReport = { violations: [], strands: [] };
  for (const check of checks(await treeScopedTables(exec))) {
    const rows = (await exec.query(check.sql)).rows as Array<{ Id: number; Stranded: boolean }>;
    for (const isStrand of [false, true]) {
      const hits = rows.filter((r) => Boolean(r.Stranded) === isStrand);
      if (hits.length === 0) continue;
      (isStrand ? report.strands : report.violations).push({
        check: check.name,
        count: hits.length,
        sample: hits.slice(0, SAMPLE).map((r) => Number(r.Id)),
      });
    }
  }
  return report;
}

export function formatSweepReport(report: SweepReport): string {
  return JSON.stringify(report, null, 2);
}

export function sweepExitCode(report: SweepReport): 0 | 1 {
  return report.violations.length > 0 ? 1 : 0;
}
