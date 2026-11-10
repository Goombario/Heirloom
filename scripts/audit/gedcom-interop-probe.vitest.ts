// GEDCOM interop probe (#810, #869). A measurement, not a test: it imports every
// file in test-data/vendor/manifest.json (fetched by fetch-vendor-gedcoms.mjs)
// into PGlite and writes test-data/vendor/report.json:
//
//   - the import result, warnings and stored counts (overwrite mode);
//   - the data checks per rule, and the duplicate check, on the imported tree;
//   - a merge of the same file into that tree, which should change nothing, and
//     when it does, a sample of the rows it added (mergeAgain.added);
//   - our with-media export's .ged re-imported into a second tree, with its counts;
//   - every tag path (INDI.BIRT.DATE …) the export has fewer of than the input.
//
//   npm run audit:gedcom-interop            # every file
//   INTEROP_ONLY=gedcom-go npm run audit:gedcom-interop   # files whose path contains it
//   INTEROP_SAVE_EXPORTS=1 …                # also keep each export in test-data/vendor/exports/
//
// It only reads public sample files; the report stays in the gitignored folder.
import { describe, it, beforeAll, afterAll, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import JSZip from 'jszip';
import { newEmptyClusterDb } from '../../__tests__/setup/pglite-snapshot';
import { query, __setTestDb } from '@/lib/db/connection.pglite';
import { importGedcomService } from '@/lib/services/gedcom';
import { exportGedcomService } from '@/lib/services/gedcom-export';
import { listDataChecksService } from '@/lib/services/data-checks';
import { getLikelyDuplicates } from '@/lib/db/queries/data-quality';
import { resolveDefaultTree } from '@/lib/db/queries/trees';
import { decodeGedcom } from '@/lib/gedcom/charset';

vi.mock('@/lib/db/connection', async () => await import('@/lib/db/connection.pglite'));

const ROOT = join(process.cwd(), 'test-data/vendor');
const MANIFEST = join(ROOT, 'manifest.json');

interface ManifestFile { file: string; vendor: string; kind: string; note: string }

const TABLES = ['People', 'Families', 'FamilyPerson', 'Events', 'NameVariant', 'Sources', 'Citation', 'Repository', 'Note', 'NoteLink', 'Media', 'MediaImportItem', 'Places'] as const;
const USER_A = 810001;
const USER_B = 810002;

let db: PGlite;
let treeA: number;
let treeB: number;

/** Tag-path counts, e.g. "INDI.BIRT.DATE" → 12. Xrefs and values are ignored; CONC/CONT folded away. */
function tagPaths(text: string): Map<string, number> {
    const counts = new Map<string, number>();
    const stack: string[] = [];
    for (const raw of text.split(/\r\n|\r|\n/)) {
        const m = raw.replace(/^﻿/, '').trim().match(/^(\d+)\s+(?:@[^@]+@\s+)?(\S+)/);
        if (!m) continue;
        const level = Number(m[1]);
        const tag = m[2].toUpperCase();
        if (tag === 'CONC' || tag === 'CONT') continue;
        stack.length = level;
        stack[level] = tag;
        const path = stack.join('.');
        counts.set(path, (counts.get(path) ?? 0) + 1);
    }
    return counts;
}

async function clear(treeId: number) {
    for (const table of ['Cases', 'Families', 'People', 'Note', 'Sources', 'Repository', 'Media', 'Places']) {
        await query(`DELETE FROM "${table}" WHERE "TreeId" = $1`, [treeId]);
    }
}

async function counts(treeId: number): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const t of TABLES) {
        const sql = t === 'FamilyPerson'
            ? `SELECT count(*)::int AS n FROM "FamilyPerson" fp JOIN "Families" f ON f."Id" = fp."FamiliesAsChildId" WHERE f."TreeId" = $1`
            : t === 'NameVariant'
                ? `SELECT count(*)::int AS n FROM "NameVariant" v JOIN "People" p ON p."Id" = v."PersonId" WHERE p."TreeId" = $1`
                : t === 'NoteLink'
                    ? `SELECT count(*)::int AS n FROM "NoteLink" l JOIN "Note" n ON n."Id" = l."NoteId" WHERE n."TreeId" = $1`
                    : `SELECT count(*)::int AS n FROM "${t}" WHERE "TreeId" = $1`;
        try {
            out[t] = ((await query(sql, [treeId])).rows[0] as { n: number }).n;
        } catch {
            out[t] = -1;
        }
    }
    const facts = await query(
        `SELECT count(*) FILTER (WHERE btrim(COALESCE("BirthDate", '')) <> '' OR "BirthPlaceId" IS NOT NULL)::int AS births,
                count(*) FILTER (WHERE btrim(COALESCE("DeathDate", '')) <> '' OR "DeathPlaceId" IS NOT NULL)::int AS deaths
           FROM "People" WHERE "TreeId" = $1`,
        [treeId],
    );
    Object.assign(out, facts.rows[0]);
    return out;
}

function sourceCounts(paths: Map<string, number>) {
    let citations = 0;
    let inlineNotes = 0;
    const custom = new Set<string>();
    for (const [p, n] of paths) {
        const parts = p.split('.');
        if (parts[0] === 'HEAD') continue;
        if (parts.length > 1 && parts.at(-1) === 'SOUR') citations += n;
        if (parts.length > 1 && parts.at(-1) === 'NOTE') inlineNotes += n;
        for (const t of parts) if (t.startsWith('_')) custom.add(t);
    }
    return {
        INDI: paths.get('INDI') ?? 0, FAM: paths.get('FAM') ?? 0, SOUR: paths.get('SOUR') ?? 0,
        REPO: paths.get('REPO') ?? 0, NOTE: paths.get('NOTE') ?? 0, OBJE: paths.get('OBJE') ?? 0,
        citations, inlineNotes, customTags: [...custom].sort(),
    };
}

// Tables a second merge can grow, all keyed by "Id" and scoped by "TreeId".
const ADDED_TABLES = ['People', 'Families', 'Events', 'NameVariant', 'Sources', 'Citation', 'Repository', 'Note', 'Media', 'Places'] as const;
const ADDED_SAMPLE = 5;
const NOISE = new Set(['UserId', 'OwnerId', 'TreeId', 'CreatedAt', 'UpdatedAt', 'SearchName']);

type MaxIds = Record<(typeof ADDED_TABLES)[number], number>;

async function maxIds(treeId: number): Promise<MaxIds> {
    const out = {} as MaxIds;
    for (const t of ADDED_TABLES) {
        out[t] = ((await query(`SELECT COALESCE(MAX("Id"), 0)::int AS m FROM "${t}" WHERE "TreeId" = $1`, [treeId])).rows[0] as { m: number }).m;
    }
    return out;
}

async function childLinks(treeId: number): Promise<Set<string>> {
    const rows = (await query(
        `SELECT fp."ChildrenId" AS c, fp."FamiliesAsChildId" AS f FROM "FamilyPerson" fp
           JOIN "Families" f ON f."Id" = fp."FamiliesAsChildId" WHERE f."TreeId" = $1`,
        [treeId],
    )).rows as Array<{ c: number; f: number }>;
    return new Set(rows.map((r) => `${r.c}:${r.f}`));
}

/** The row a citation's FactTable/FactId points at, as a table whose max Id we know. */
const FACT_OWNER: Record<string, keyof MaxIds> = {
    People: 'People', PersonName: 'People', PersonBirth: 'People', PersonDeath: 'People',
    Families: 'Families', Events: 'Events', NameVariant: 'NameVariant',
};

/**
 * What a second merge added: per table, how many rows and the first few, with
 * empty and bookkeeping columns dropped and long text cut. `_onExisting` marks a
 * row hung on a record that was already there before the merge, which is the
 * usual sign of two records the file keeps apart being folded into one (#960).
 */
async function addedByMerge(treeId: number, before: MaxIds, linksBefore: Set<string>) {
    const added: Record<string, { count: number; sample: Array<Record<string, unknown>> }> = {};
    const onExisting = (table: keyof MaxIds, id: unknown) => typeof id === 'number' && id <= before[table];
    for (const t of ADDED_TABLES) {
        const count = ((await query(`SELECT COUNT(*)::int AS n FROM "${t}" WHERE "TreeId" = $1 AND "Id" > $2`, [treeId, before[t]])).rows[0] as { n: number }).n;
        if (!count) continue;
        const rows = (await query(`SELECT * FROM "${t}" WHERE "TreeId" = $1 AND "Id" > $2 ORDER BY "Id" LIMIT ${ADDED_SAMPLE}`, [treeId, before[t]])).rows as Array<Record<string, unknown>>;
        added[t] = {
            count,
            sample: rows.map((r) => {
                const out: Record<string, unknown> = {};
                for (const [k, v] of Object.entries(r)) {
                    if (v === null || v === '' || NOISE.has(k)) continue;
                    out[k] = typeof v === 'string' && v.length > 120 ? `${v.slice(0, 117)}...` : v;
                }
                const owner = t === 'Citation' ? FACT_OWNER[r.FactTable as string] : undefined;
                if ((owner && onExisting(owner, r.FactId)) || onExisting('People', r.PersonId) || onExisting('Families', r.FamilyId)) {
                    out._onExisting = true;
                }
                return out;
            }),
        };
    }
    const links = [...await childLinks(treeId)].filter((l) => !linksBefore.has(l));
    if (links.length) {
        added.FamilyPerson = {
            count: links.length,
            sample: links.slice(0, ADDED_SAMPLE).map((l) => {
                const [child, family] = l.split(':').map(Number);
                return { ChildrenId: child, FamiliesAsChildId: family, ...(onExisting('Families', family) ? { _onExisting: true } : {}) };
            }),
        };
    }
    return added;
}

/** Paths the export has fewer of than the input; the ones a re-import can't get back. */
function lostPaths(input: Map<string, number>, exported: Map<string, number>) {
    const lost: Record<string, { in: number; out: number }> = {};
    for (const [p, n] of input) {
        if (p.startsWith('HEAD') || p.startsWith('TRLR') || p.startsWith('SUBM') || p.startsWith('SUBN')) continue;
        const out = exported.get(p) ?? 0;
        if (out < n) lost[p] = { in: n, out };
    }
    return lost;
}

async function dataChecks(userId: number) {
    const result = await listDataChecksService({ requestedTreeId: null, requestedOwnerId: null, currentUserId: userId });
    const names = new Map(result.people.map((p) => [p.Id, `${p.FirstName ?? ''} ${p.LastName ?? ''}`.trim()]));
    const byRule: Record<string, number> = {};
    for (const p of result.problems) byRule[p.rule] = (byRule[p.rule] ?? 0) + 1;
    const detail = result.problems.map((p) => ({
        rule: p.rule,
        person: names.get(p.personId) ?? `#${p.personId}`,
        related: p.relatedPersonIds.map((id) => names.get(id) ?? `#${id}`),
        facts: p.facts.map((f) => `${f.type}${f.personId != null && f.personId !== p.personId ? `(${names.get(f.personId) ?? f.personId})` : ''}=${f.date}`),
    }));
    return { byRule, detail };
}

const manifest: { files: ManifestFile[] } = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : { files: [] };
/** Pointer lines whose xref no `0 @X@` record in the file defines. */
function danglingPointers(content: string): number {
    const lines = content.split(/\r?\n/);
    const defined = new Set(lines.map((line) => /^0 (@[^@\s]+@) /.exec(line)?.[1]).filter(Boolean));
    return lines.filter((line) => {
        const pointer = /^[1-9]\d* \S+ (@[^@#\s][^@\s]*@)$/.exec(line.trim())?.[1];
        return pointer !== undefined && !defined.has(pointer);
    }).length;
}

const only = process.env.INTEROP_ONLY;
// Only paths inside test-data/vendor/: test-data/ also holds private family exports.
const files = manifest.files.filter((f) => !isAbsolute(f.file) && !f.file.split(/[/\\]/).includes('..') && (!only || f.file.includes(only)));
const report: Record<string, unknown> = {};

beforeAll(async () => {
    db = await newEmptyClusterDb();
    __setTestDb(db);
    for (const id of [USER_A, USER_B]) {
        await query('INSERT INTO "Users" ("Id", "Email", "GoogleId") VALUES ($1, $2, $3)', [id, `interop-${id}@test.local`, `interop-${id}`]);
    }
    treeA = await resolveDefaultTree(USER_A);
    treeB = await resolveDefaultTree(USER_B);
});

afterAll(async () => {
    const out = join(ROOT, only ? `report-${only.replace(/\W+/g, '_')}.json` : 'report.json');
    if (files.length) writeFileSync(out, JSON.stringify(report, null, 2));
    __setTestDb(null);
    await db?.close();
});

describe.skipIf(!files.length)('GEDCOM interop probe', () => {
    for (const entry of files) {
        it(entry.file, async () => {
            let bytes = new Uint8Array(readFileSync(join(ROOT, entry.file)));
            const text = decodeGedcom(bytes);
            const inPaths = tagPaths(text);
            const row: Record<string, unknown> = { vendor: entry.vendor, kind: entry.kind, source: sourceCounts(inPaths) };
            report[entry.file] = row;
            await clear(treeA);
            await clear(treeB);

            const t0 = performance.now();
            try {
                const result = await importGedcomService({ file: new File([bytes], 'tree.ged'), mode: 'overwrite', currentUserId: USER_A });
                row.import = {
                    ms: Math.round(performance.now() - t0),
                    people: result.peopleCount, families: result.familiesCount, sources: result.sourcesCount,
                    citations: result.citationsCount, preserved: result.preservedCount, skipped: result.skippedCount,
                    media: result.mediaItems.length, warnings: result.warnings,
                };
            } catch (err) {
                row.import = { error: (err as Error).message };
                // A refused media path blocks the whole file (#810). Measure the rest
                // of it anyway, without its FILE lines, and say so in the report.
                if (!/unsafe or empty media FILE path/.test((err as Error).message)) return;
                bytes = new TextEncoder().encode(text.split(/\r\n|\r|\n/).filter((l) => !/^\s*\d+\s+FILE\b/.test(l)).join('\n'));
                const retry = await importGedcomService({ file: new File([bytes], 'tree.ged'), mode: 'overwrite', currentUserId: USER_A });
                row.import = {
                    error: (err as Error).message, retriedWithoutFileLines: true,
                    people: retry.peopleCount, families: retry.familiesCount, sources: retry.sourcesCount,
                    citations: retry.citationsCount, preserved: retry.preservedCount, skipped: retry.skippedCount,
                    media: retry.mediaItems.length, warnings: retry.warnings,
                };
            }
            row.stored = await counts(treeA);
            row.checks = await dataChecks(USER_A);
            row.duplicates = (await getLikelyDuplicates(treeA)).pairs.length;

            try {
                const idsBefore = await maxIds(treeA);
                const linksBefore = await childLinks(treeA);
                const merge = await importGedcomService({ file: new File([bytes], 'tree.ged'), mode: 'merge', currentUserId: USER_A });
                const afterMerge = await counts(treeA);
                const changed = Object.fromEntries(Object.entries(afterMerge)
                    .filter(([k, v]) => v !== (row.stored as Record<string, number>)[k])
                    .map(([k, v]) => [k, { before: (row.stored as Record<string, number>)[k], after: v }]));
                row.mergeAgain = { matchedPeople: merge.matchedPeopleCount, matchedFamilies: merge.matchedFamiliesCount, changed, warnings: merge.warnings };
                if (Object.keys(changed).length) (row.mergeAgain as Record<string, unknown>).added = await addedByMerge(treeA, idsBefore, linksBefore);
            } catch (err) {
                row.mergeAgain = { error: (err as Error).message };
            }

            // Round trip from the overwrite import, not the merged tree.
            await clear(treeA);
            await importGedcomService({ file: new File([bytes], 'tree.ged'), mode: 'overwrite', currentUserId: USER_A });
            // With media: a .ged-only export strips every OBJE by design, while the
            // bundle keeps each reference's FILE text (#958). Only the .ged is read.
            const exported = await exportGedcomService({ requestedTreeId: treeA, requestedOwnerId: null, currentUserId: USER_A, includeMedia: true, mediaPolicy: 'omit-unresolved' });
            if (exported.kind !== 'zip') {
                row.roundTrip = { error: `export kind ${exported.kind}` };
                return;
            }
            const zip = await JSZip.loadAsync(exported.buffer);
            const gedName = Object.keys(zip.files).find((name) => name.endsWith('.ged'));
            if (!gedName) {
                row.roundTrip = { error: 'export bundle has no .ged' };
                return;
            }
            const exportedContent = await zip.file(gedName)!.async('string');
            if (exported.preflight.omittedTotal) row.exportOmittedMedia = exported.preflight.byReason;
            row.lostOnExport = lostPaths(inPaths, tagPaths(exportedContent));
            // #979: a pointer to an xref the export doesn't define names nothing.
            const danglingInExport = danglingPointers(exportedContent);
            if (danglingInExport) row.danglingInExport = danglingInExport;
            if (process.env.INTEROP_SAVE_EXPORTS) {
                mkdirSync(join(ROOT, 'exports'), { recursive: true });
                writeFileSync(join(ROOT, 'exports', entry.file.replace(/\//g, '__')), exportedContent);
            }
            try {
                await importGedcomService({ file: new File([exportedContent], 'tree.ged'), mode: 'overwrite', currentUserId: USER_B });
                const reimported = await counts(treeB);
                const stored = row.stored as Record<string, number>;
                row.roundTrip = {
                    changed: Object.fromEntries(Object.entries(reimported).filter(([k, v]) => v !== stored[k]).map(([k, v]) => [k, { first: stored[k], reimport: v }])),
                };
            } catch (err) {
                row.roundTrip = { error: (err as Error).message };
            }
        });
    }
});
