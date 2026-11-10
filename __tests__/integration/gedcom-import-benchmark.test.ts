import { describe, it, expect, afterAll, vi } from 'vitest';
import { POST } from '@/app/api/import/gedcom/route';

// Bypass in-memory rate limiter
vi.mock('@/lib/rate-limit', () => ({
    rateLimit: vi.fn(() => ({ success: true, remaining: 99 })),
}));

import { NextRequest } from 'next/server';
import { readFileSync, statSync, existsSync } from 'fs';
import { parseResponse } from '../setup/test-helpers';
import { cleanupTestData, hasTestDatabase } from '../setup/db-helpers';

// Local perf benchmark. Point at any large .ged via GEDCOM_BENCH_FILE; without
// it (as in CI) this skips.
const GEDCOM_PATH = process.env.GEDCOM_BENCH_FILE ?? '';

// Needs both a test DB (Postgres backend) and the benchmark file present.
const describeIf = hasTestDatabase() && existsSync(GEDCOM_PATH) ? describe : describe.skip;

describeIf('BENCHMARK /api/import/gedcom on large file', () => {
    afterAll(async () => {
        await cleanupTestData();
    });

    it('imports the benchmark file and reports timing', async () => {
        const bytes = readFileSync(GEDCOM_PATH);
        const sizeKB = (statSync(GEDCOM_PATH).size / 1024).toFixed(1);

        const formData = new FormData();
        formData.append('file', new File([bytes], 'benchmark.ged', { type: 'text/plain' }));
        const req = new NextRequest('http://localhost:3000/api/import/gedcom?mode=overwrite', {
            method: 'POST',
            body: formData,
        });

        const start = performance.now();
        const res = await POST(req);
        const elapsedMs = performance.now() - start;

        const data = await parseResponse<Record<string, unknown>>(res);

        console.log('\n===== GEDCOM IMPORT BENCHMARK =====');
        console.log(`File:        ${GEDCOM_PATH} (${sizeKB} KB)`);
        console.log(`HTTP status: ${res.status}`);
        console.log(`Elapsed:     ${elapsedMs.toFixed(0)} ms (${(elapsedMs / 1000).toFixed(2)} s)`);
        console.log(`Result:      ${JSON.stringify(data)}`);
        console.log('===================================\n');

        expect(res.status).toBe(200);
    }, 300_000);
});
