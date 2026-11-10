import {
    inspectMediaLinkIntegrity,
    type DbExecutor,
} from '@/lib/db/queries/media-links';
import type { MediaLinkIntegrityIssue } from '@/lib/db/schema';

export interface MediaLinkAuditReport {
    treeId: number;
    totalLinks: number;
    primaryLinks: number;
    issues: MediaLinkIntegrityIssue[];
}

function sortIssues(issues: MediaLinkIntegrityIssue[]): MediaLinkIntegrityIssue[] {
    return [...issues].sort((a, b) => (
        a.mediaId - b.mediaId
        || a.ownerTable.localeCompare(b.ownerTable)
        || (a.ownerId ?? -1) - (b.ownerId ?? -1)
        || a.kind.localeCompare(b.kind)
    ));
}

/** Produce stable, machine-readable output for one tree's read-only audit. */
export function formatMediaLinkAuditReport(report: MediaLinkAuditReport): string {
    return JSON.stringify({
        treeId: report.treeId,
        totalLinks: report.totalLinks,
        primaryLinks: report.primaryLinks,
        issues: sortIssues(report.issues),
    });
}

export function getMediaLinkAuditExitCode(issues: MediaLinkIntegrityIssue[]): 0 | 1 {
    return issues.length > 0 ? 1 : 0;
}

interface LinkCounts {
    totalLinks: number;
    primaryLinks: number;
}

async function inspectTree(
    treeId: number,
    exec: DbExecutor,
): Promise<MediaLinkAuditReport> {
    const counts = await exec.query(
        `SELECT COUNT(*)::int AS "totalLinks",
                COUNT(*) FILTER (
                    WHERE l."OwnerTable" = 'People' AND l."IsPrimary" = 1
                )::int AS "primaryLinks"
           FROM "MediaLink" l
           JOIN "Media" m ON m."Id" = l."MediaId"
          WHERE m."TreeId" = $1`,
        [treeId],
    );
    const row = counts.rows[0] as LinkCounts;
    const integrity = await inspectMediaLinkIntegrity(treeId, exec);
    return {
        treeId,
        totalLinks: row.totalLinks,
        primaryLinks: row.primaryLinks,
        issues: integrity.issues,
    };
}

export async function runMediaLinkAudit(exec: DbExecutor): Promise<MediaLinkAuditReport[]> {
    const trees = await exec.query(`SELECT "Id" FROM "Trees" ORDER BY "Id"`);
    const reports: MediaLinkAuditReport[] = [];
    for (const row of trees.rows as Array<{ Id: number }>) {
        reports.push(await inspectTree(row.Id, exec));
    }
    return reports;
}
