import { describe, it, expect, afterEach, vi } from 'vitest';
import JSZip from 'jszip';
import { GET as EXPORT_GEDCOM } from '@/app/api/export/gedcom/route';

// Bypass the 10-per-15-min export rate limit.
vi.mock('@/lib/rate-limit', () => ({
    rateLimit: vi.fn(() => ({ success: true, remaining: 99 })),
}));

import { NextRequest } from 'next/server';
import { TEST_USER } from '../../setup/test-helpers';
import { cleanupTestData, hasTestDatabase } from '../../setup/db-helpers';
import { query } from '@/lib/db/connection';
import { resolveDefaultTree } from '@/lib/db/queries/trees';
import { insertRecord } from '../../setup/fact-places';

const describeIf = hasTestDatabase() ? describe : describe.skip;

/**
 * Regression cover for the exportGedcomService extraction (cleanup-audit item 3):
 * the per-person / per-family N+1 loops were replaced with batched whole-tree
 * reads grouped in memory. This seeds one family (husband/wife/child), a
 * person-level event, and a person-level media row, then asserts every grouped
 * relation still lands in the GEDCOM — FAMS/FAMC on the individuals, HUSB/WIFE/
 * CHIL on the family, and the person event. Plain GEDCOM deliberately carries
 * no multimedia records; bundled-export coverage exercises media packaging.
 */
describeIf('GEDCOM export — batched relation assembly', () => {
    afterEach(async () => {
        await cleanupTestData();
    });

    async function insertPerson(treeId: number, first: string, last: string): Promise<number> {
        const res = await query(
            `INSERT INTO "People" ("UserId", "TreeId", "FirstName", "LastName") VALUES ($1, $2, $3, $4) RETURNING "Id"`,
            [TEST_USER.id, treeId, first, last]
        );
        return (res.rows[0] as { Id: number }).Id;
    }

  it('emits FAMS/FAMC/HUSB/WIFE/CHIL plus person event without plain-GED media', async () => {
        const treeId = await resolveDefaultTree(TEST_USER.id);

        const husbandId = await insertPerson(treeId, 'Hubertexport', 'Sireexport');
        const wifeId = await insertPerson(treeId, 'Wilhelminaexport', 'Sireexport');
        const childId = await insertPerson(treeId, 'Cadetexport', 'Sireexport');

        // Family with BOTH the modern Partner columns (drive HUSB/WIFE emission)
        // and the legacy Husband/Wife columns (drive the person→FAMS grouping),
        // mirrored exactly as the app writes them.
        const famRes = await query(
            `INSERT INTO "Families"
                ("UserId", "TreeId", "Partner1Id", "Partner2Id", "HusbandId", "WifeId", "Type")
             VALUES ($1, $2, $3, $4, $3, $4, 'Marriage') RETURNING "Id"`,
            [TEST_USER.id, treeId, husbandId, wifeId]
        );
        const familyId = (famRes.rows[0] as { Id: number }).Id;

        await query(
            `INSERT INTO "FamilyPerson" ("FamiliesAsChildId", "ChildrenId") VALUES ($1, $2)`,
            [familyId, childId]
        );

        // Person-level event with a distinctive place (exercises person.events).
        await insertRecord({ query }, 'Events', { UserId: TEST_USER.id, TreeId: treeId, Type: 'OCCU', Description: 'Blacksmithexport', Place: 'Forgetownexport', PersonId: husbandId });

        // Person-level media (exercises person.media → a level-1 OBJE).
        await query(
            `WITH inserted AS (
               INSERT INTO "Media" ("UserId", "TreeId", "Title", "FilePath", "Format")
               VALUES ($1, $2, 'Portraitexport', 'portrait_export.jpg', 'JPG')
               RETURNING "Id"
             )
             INSERT INTO "MediaLink" ("MediaId", "OwnerTable", "OwnerId")
             SELECT "Id", 'People', $3 FROM inserted`,
            [TEST_USER.id, treeId, husbandId]
        );

        const res = await EXPORT_GEDCOM(
            new NextRequest(`http://localhost:3000/api/export/gedcom?treeId=${treeId}`)
        );
        expect(res.status).toBe(200);

        // A Response body can only be consumed once — read raw bytes rather
        // than `res.text()`, because `res.text()`/TextDecoder (default
        // `ignoreBOM: false`) strips a leading BOM that matches the target
        // encoding, per the WHATWG Encoding spec. That's confirmed by hand:
        // `arrayBuffer()` on this same response shows `EF BB BF` at the
        // front, but `.text()` on it yields `'0'` as the first char — the BOM
        // genuinely reaches the wire, a decoded string just can never observe
        // it. So we assert the BOM on raw bytes, then derive the rest of this
        // test's string assertions from those same bytes via TextDecoder
        // (with `ignoreBOM: true` so the leading marker doesn't leak into the
        // `gedcom` string used below).
        const buf = new Uint8Array(await res.arrayBuffer());

        // UTF-8 BOM (Q8) — applied in the export service so the zipped copy
        // carries it too, not just this plain response.
        expect(Array.from(buf.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
        expect(new TextDecoder().decode(buf).replace(/^﻿/, '').startsWith('0 HEAD')).toBe(true);

        const gedcom = new TextDecoder('utf-8', { ignoreBOM: true }).decode(buf);

        // All three people present.
        expect(gedcom).toContain('Hubertexport');
        expect(gedcom).toContain('Wilhelminaexport');
        expect(gedcom).toContain('Cadetexport');

        // Family record with both spouses and the child.
        expect(gedcom).toContain('1 HUSB');
        expect(gedcom).toContain('1 WIFE');
        expect(gedcom).toContain('1 CHIL');

        // Spouse + child links back on the individuals.
        expect(gedcom).toContain('1 FAMS');
        expect(gedcom).toContain('1 FAMC');

        // Person event grouped correctly.
        expect(gedcom).toContain('Blacksmithexport');
        expect(gedcom).toContain('2 PLAC Forgetownexport');

        // Plain GED has no byte bundle, so it intentionally emits no multimedia
        // records or pointers (the zip path packages included media separately).
        expect(gedcom).not.toContain('portrait_export.jpg');
        expect(gedcom).not.toContain('Portraitexport');
        expect(gedcom).not.toMatch(/^\d+ OBJE(?: |$)/m);
  });

  it('assigns tied-name people and their xrefs in Id order', async () => {
    const treeId = await resolveDefaultTree(TEST_USER.id);
    const firstId = await insertPerson(treeId, 'Same', 'Name');
    const secondId = await insertPerson(treeId, 'Same', 'Name');

    const response = await EXPORT_GEDCOM(new NextRequest(
      `http://localhost:3000/api/export/gedcom?treeId=${treeId}`,
    ));
    expect(response.status).toBe(200);
    const gedcom = new TextDecoder('utf-8', { ignoreBOM: true }).decode(
      new Uint8Array(await response.arrayBuffer()),
    );
    const firstXref = gedcom.indexOf(`0 @I${firstId === Math.min(firstId, secondId) ? 1 : 2}@ INDI`);
    const secondXref = gedcom.indexOf(`0 @I${secondId === Math.min(firstId, secondId) ? 1 : 2}@ INDI`);
    expect(firstXref).toBeGreaterThanOrEqual(0);
    expect(secondXref).toBeGreaterThan(firstXref);
  });

  it('preflights missing hosted media, blocks silently incomplete export, and reports exact override omissions', async () => {
        const treeId = await resolveDefaultTree(TEST_USER.id);
        const personId = await insertPerson(treeId, 'Preflight', 'Export');
        await query(
            `WITH inserted AS (
               INSERT INTO "Media" ("UserId", "TreeId", "Title", "FilePath", "Format")
               VALUES ($1, $2, 'Missing hosted bytes', 'not-on-disk-task8.jpg', 'JPG')
               RETURNING "Id"
             )
             INSERT INTO "MediaLink" ("MediaId", "OwnerTable", "OwnerId")
             SELECT "Id", 'People', $3 FROM inserted`,
            [TEST_USER.id, treeId, personId],
        );

        const preflightResponse = await EXPORT_GEDCOM(new NextRequest(
            `http://localhost:3000/api/export/gedcom?treeId=${treeId}&preflight=true&includeMedia=true`,
        ));
        expect(preflightResponse.status).toBe(200);
        const preflight = await preflightResponse.json() as Record<string, unknown>;
        expect(preflight).toEqual({
            canExport: false,
            omittedTotal: 1,
            byReason: {
                pending: 0,
                missing: 0,
                failed: 0,
                backing_missing: 1,
                legacy_materialization_unknown: 0,
            },
        });
        expect(JSON.stringify(preflight)).not.toMatch(/Missing hosted|not-on-disk|task8|Id|Path|xref/);

        const blockedResponse = await EXPORT_GEDCOM(new NextRequest(
            `http://localhost:3000/api/export/gedcom?treeId=${treeId}&includeMedia=true`,
        ));
        expect(blockedResponse.status).toBe(409);
        expect(await blockedResponse.json()).toMatchObject({ preflight });

        const overrideResponse = await EXPORT_GEDCOM(new NextRequest(
            `http://localhost:3000/api/export/gedcom?treeId=${treeId}&includeMedia=true&mediaPolicy=omit-unresolved`,
        ));
        expect(overrideResponse.status).toBe(200);
        const zip = await JSZip.loadAsync(await overrideResponse.arrayBuffer());
        const report = zip.file('missing-media-report.json');
        expect(report).toBeTruthy();
        expect(JSON.parse(await report!.async('string'))).toEqual({
            version: 1,
            omitted: {
                total: 1,
                byReason: {
                    pending: 0,
                    missing: 0,
                    failed: 0,
                    backing_missing: 1,
                    legacy_materialization_unknown: 0,
                },
            },
            staleMediaPointers: 0,
        });
        expect(zip.file('media/')).toBeNull();
        expect((await zip.file('family_tree.ged')!.async('string'))).not.toContain('not-on-disk-task8.jpg');
  });

  it('produces byte-identical hosted zip exports with fixed archive metadata', async () => {
    const treeId = await resolveDefaultTree(TEST_USER.id);
    await insertPerson(treeId, 'Stable', 'Archive');

    const first = await EXPORT_GEDCOM(new NextRequest(
      `http://localhost:3000/api/export/gedcom?treeId=${treeId}&includeMedia=true`,
    ));
    const second = await EXPORT_GEDCOM(new NextRequest(
      `http://localhost:3000/api/export/gedcom?treeId=${treeId}&includeMedia=true`,
    ));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const firstBytes = Buffer.from(await first.arrayBuffer());
    const secondBytes = Buffer.from(await second.arrayBuffer());
    expect(firstBytes).toEqual(secondBytes);

    const zip = await JSZip.loadAsync(firstBytes);
    const cases = JSON.parse(await zip.file('cases.json')!.async('string')) as Record<string, unknown>;
    expect(cases).not.toHaveProperty('exported_at');
    const dates = Object.values(zip.files).map((entry) => entry.date.getTime());
    expect(new Set(dates).size).toBe(1);
  });
});
