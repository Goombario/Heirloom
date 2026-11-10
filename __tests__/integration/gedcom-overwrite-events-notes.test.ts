import { describe, it, expect, afterEach, vi } from 'vitest';
import { POST } from '@/app/api/import/gedcom/route';

// Bypass in-memory rate limiter
vi.mock('@/lib/rate-limit', () => ({
    rateLimit: vi.fn(() => ({ success: true, remaining: 99 })),
}));

import { NextRequest } from 'next/server';
import { parseResponse, TEST_USER } from '../setup/test-helpers';
import { cleanupTestData, hasTestDatabase } from '../setup/db-helpers';
import { query } from '@/lib/db/connection';

const describeIf = hasTestDatabase() ? describe : describe.skip;

// A person with an OCCU event (person-event → Events row, PersonId set) carrying
// a NOTE, a family with a DIV event (family-event → Events row, FamilyId set),
// and a family-level NOTE. If batched Events/Note/NoteLink RETURNING order ever
// failed to match VALUES order, the event↔owner or note↔owner correlation would
// break — asserted here by identity, scoped through this run's own entity ids so
// leftover Note/NoteLink rows from prior runs can't mask a regression.
const GEDCOM = `0 HEAD
1 GEDC
2 VERS 5.5.1
0 @I1@ INDI
1 NAME Alpha /Root/
1 SEX M
1 OCCU Blacksmith
2 DATE 1880
2 NOTE Worked in the village forge
0 @I2@ INDI
1 NAME Beta /Root/
1 SEX F
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 DIV
2 DATE 1890
1 NOTE Family lore here
0 TRLR`;

function req(gedcom: string, mode = 'overwrite') {
    const formData = new FormData();
    formData.append('file', new File([gedcom], 'test.ged', { type: 'text/plain' }));
    return new NextRequest(`http://localhost:3000/api/import/gedcom?mode=${mode}`, {
        method: 'POST',
        body: formData,
    });
}

function reqWithMedia(gedcom: string, mediaJson: string, mode = 'overwrite') {
    const formData = new FormData();
    formData.append('file', new File([gedcom], 'test.ged', { type: 'text/plain' }));
    formData.append('mediaJson', mediaJson);
    return new NextRequest(`http://localhost:3000/api/import/gedcom?mode=${mode}`, {
        method: 'POST',
        body: formData,
    });
}

// A photo attached to a PERSON EVENT (OBJE under OCCU), plus a face tag on that
// photo. Because overwrite defers event media to the batched flush, the tag
// resolution pass must run after it — otherwise the basename is unknown and the
// tag is silently dropped (regression guard for the events-batching ordering).
const GEDCOM_EVENT_PHOTO = `0 HEAD
1 GEDC
2 VERS 5.5.1
0 @I1@ INDI
1 NAME Alpha /Root/
1 SEX M
1 OCCU Blacksmith
2 OBJE
3 FILE forge.jpg
4 FORM jpeg
0 @I2@ INDI
1 NAME Beta /Root/
1 SEX F
0 TRLR`;

// The note text(s) linked to a given owner, scoped to this run's owner id.
async function linkedNoteTexts(ownerTable: string, ownerId: number): Promise<string[]> {
    const { rows } = await query(
        `SELECT n."Text" FROM "Note" n
         JOIN "NoteLink" nl ON nl."NoteId" = n."Id"
         WHERE nl."OwnerTable" = $1 AND nl."OwnerId" = $2`,
        [ownerTable, ownerId]
    );
    return (rows as Array<{ Text: string }>).map((r) => r.Text);
}

describeIf('overwrite import wires events + their notes correctly (batch guard)', () => {
    afterEach(async () => {
        await cleanupTestData();
    });

    it('attaches each event to the right owner and each note to the right owner', async () => {
        const res = await POST(req(GEDCOM));
        expect(res.status).toBe(200);
        const data = await parseResponse<{ peopleCount: number; familiesCount: number }>(res);
        expect(data.peopleCount).toBe(2);
        expect(data.familiesCount).toBe(1);

        const { rows: people } = await query(
            'SELECT "Id", "FirstName" FROM "People" WHERE "UserId" = $1', [TEST_USER.id]
        );
        const byName = new Map((people as Array<{ Id: number; FirstName: string }>).map((p) => [p.FirstName, p.Id]));
        const alpha = byName.get('Alpha')!;

        const { rows: famRows } = await query('SELECT "Id" FROM "Families" WHERE "UserId" = $1', [TEST_USER.id]);
        const familyId = (famRows as Array<{ Id: number }>)[0].Id;

        // OCCU event → PersonId=Alpha, FamilyId null.
        const { rows: occuRows } = await query(
            `SELECT "Id","PersonId","FamilyId" FROM "Events" WHERE "UserId" = $1 AND "Type" = 'OCCU'`,
            [TEST_USER.id]
        );
        const occu = occuRows as Array<{ Id: number; PersonId: number | null; FamilyId: number | null }>;
        expect(occu).toHaveLength(1);
        expect(occu[0].PersonId).toBe(alpha);
        expect(occu[0].FamilyId).toBeNull();

        // DIV event → FamilyId=family, PersonId null.
        const { rows: divRows } = await query(
            `SELECT "Id","PersonId","FamilyId" FROM "Events" WHERE "UserId" = $1 AND "Type" = 'DIV'`,
            [TEST_USER.id]
        );
        const div = divRows as Array<{ Id: number; PersonId: number | null; FamilyId: number | null }>;
        expect(div).toHaveLength(1);
        expect(div[0].FamilyId).toBe(familyId);
        expect(div[0].PersonId).toBeNull();

        // The person-event note links to the OCCU event (and nowhere else).
        expect(await linkedNoteTexts('Events', occu[0].Id)).toEqual(['Worked in the village forge']);
        // The family-level note links to the family.
        expect(await linkedNoteTexts('Families', familyId)).toEqual(['Family lore here']);
    });

    it('keeps a face tag on a person-event photo (deferred event media must register before tag resolution)', async () => {
        const mediaJson = JSON.stringify({
            version: 2,
            libraryMedia: [],
            // Tag Beta's face on the photo attached to Alpha's OCCU event.
            tags: [{ file: 'forge.jpg', person: '@I2@', region: [10, 20, 30, 40], primary: false }],
        });
        const res = await POST(reqWithMedia(GEDCOM_EVENT_PHOTO, mediaJson));
        expect(res.status).toBe(200);
        const data = await parseResponse<{ tagsCount: number }>(res);
        expect(data.tagsCount).toBe(1);

        const { rows: beta } = await query(
            `SELECT "Id" FROM "People" WHERE "UserId" = $1 AND "FirstName" = 'Beta'`, [TEST_USER.id]
        );
        const betaId = (beta as Array<{ Id: number }>)[0].Id;
        // The event photo's Media row is tagged to Beta.
        const { rows: tagRows } = await query(
            `SELECT mt."Id" FROM "MediaTag" mt
             JOIN "Media" m ON m."Id" = mt."MediaId"
             WHERE mt."PersonId" = $1 AND m."UserId" = $2`,
            [betaId, TEST_USER.id]
        );
        expect((tagRows as unknown[]).length).toBe(1);
    });
});
