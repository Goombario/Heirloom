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

// Four people + one family with two children. If a batched insert's RETURNING
// order ever fails to match the VALUES order, the id->xref correlation breaks
// and spouses/children get wired to the wrong People rows — which this asserts
// against by name.
const GEDCOM = `0 HEAD
1 GEDC
2 VERS 5.5.1
0 @I1@ INDI
1 NAME Alpha /Root/
1 SEX M
0 @I2@ INDI
1 NAME Beta /Root/
1 SEX F
0 @I3@ INDI
1 NAME Gamma /Root/
1 SEX M
0 @I4@ INDI
1 NAME Delta /Root/
1 SEX F
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 CHIL @I3@
1 CHIL @I4@
1 MARR
2 DATE 1 JAN 1900
0 TRLR`;

function req(gedcom: string, mode = 'overwrite') {
    const formData = new FormData();
    formData.append('file', new File([gedcom], 'test.ged', { type: 'text/plain' }));
    return new NextRequest(`http://localhost:3000/api/import/gedcom?mode=${mode}`, {
        method: 'POST',
        body: formData,
    });
}

describeIf('overwrite import wires relationships correctly (batch guard)', () => {
    afterEach(async () => {
        await cleanupTestData();
    });

    it('maps spouses and children to the right People rows', async () => {
        const res = await POST(req(GEDCOM));
        expect(res.status).toBe(200);
        const data = await parseResponse<{ peopleCount: number; familiesCount: number }>(res);
        expect(data.peopleCount).toBe(4);
        expect(data.familiesCount).toBe(1);

        // Resolve each person's Id by name so we assert on identity, not order.
        const { rows: people } = await query(
            'SELECT "Id", "FirstName" FROM "People" WHERE "UserId" = $1',
            [TEST_USER.id]
        );
        const byName = new Map((people as Array<{ Id: number; FirstName: string }>).map((p) => [p.FirstName, p.Id]));
        const alpha = byName.get('Alpha')!;
        const beta = byName.get('Beta')!;
        const gamma = byName.get('Gamma')!;
        const delta = byName.get('Delta')!;
        expect([alpha, beta, gamma, delta].every((id) => typeof id === 'number')).toBe(true);

        // Spouse wiring: husband=Alpha, wife=Beta.
        const { rows: famRows } = await query(
            'SELECT "Id", "HusbandId", "WifeId" FROM "Families" WHERE "UserId" = $1',
            [TEST_USER.id]
        );
        const fam = famRows as Array<{ Id: number; HusbandId: number; WifeId: number }>;
        expect(fam).toHaveLength(1);
        expect(fam[0].HusbandId).toBe(alpha);
        expect(fam[0].WifeId).toBe(beta);

        // Child wiring: Gamma and Delta linked to that family, nobody else.
        const { rows: linkRows } = await query(
            'SELECT "ChildrenId", "FamiliesAsChildId" FROM "FamilyPerson" WHERE "FamiliesAsChildId" = $1',
            [fam[0].Id]
        );
        const childIds = (linkRows as Array<{ ChildrenId: number }>).map((l) => l.ChildrenId).sort((a, b) => a - b);
        expect(childIds).toEqual([gamma, delta].sort((a, b) => a - b));
    });
});
