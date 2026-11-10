import { Pool } from 'pg';
import type { DbExecutor } from '@/lib/db/queries/media-links';
import {
    formatMediaLinkAuditReport,
    getMediaLinkAuditExitCode,
    runMediaLinkAudit,
} from '@/scripts/audit-media-links';

async function main(): Promise<void> {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL environment variable is not set');

    const pool = new Pool({ connectionString });
    const exec: DbExecutor = { query: (text, params) => pool.query(text, params) };
    let exitCode: 0 | 1 = 0;
    try {
        for (const report of await runMediaLinkAudit(exec)) {
            console.log(formatMediaLinkAuditReport(report));
            if (getMediaLinkAuditExitCode(report.issues) === 1) exitCode = 1;
        }
    } finally {
        await pool.end();
    }
    process.exitCode = exitCode;
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
