// Invariant sweep CLI (#864). Read-only; exits 1 when any violation is found.
//
//   npm run audit:invariants                         # Postgres at DATABASE_URL
//   npm run audit:invariants -- --hlbak backup.hlbak # a local backup, in PGlite
//
// The .hlbak mode restores the backup into a throwaway in-memory PGlite, so it
// sweeps a static or desktop user's data without touching any live database.
import { readFile } from 'node:fs/promises';
import { formatSweepReport, runInvariantSweep, sweepExitCode, type DbExecutor } from './invariant-sweep';

async function withExecutor<T>(fn: (exec: DbExecutor) => Promise<T>): Promise<T> {
    const flag = process.argv.indexOf('--hlbak');
    if (flag >= 0) {
        const file = process.argv[flag + 1];
        if (!file) throw new Error('--hlbak needs a file path');
        const { PGlite } = await import('@electric-sql/pglite');
        const { logicalToDatadir } = await import('@/lib/db/connection.pglite');
        const datadir = await logicalToDatadir(new Blob([new Uint8Array(await readFile(file))]));
        const db = await PGlite.create({ loadDataDir: datadir });
        try {
            return await fn({ query: (text, params) => db.query(text, params) });
        } finally {
            await db.close();
        }
    }
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL environment variable is not set (or pass --hlbak <file>)');
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString });
    try {
        return await fn({ query: (text, params) => pool.query(text, params) });
    } finally {
        await pool.end();
    }
}

async function main(): Promise<void> {
    const report = await withExecutor(runInvariantSweep);
    console.log(formatSweepReport(report));
    process.exitCode = sweepExitCode(report);
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
