import { listAllReferencedMediaFilePaths } from '@/lib/db/queries/media';
import { getDataDir } from '@/lib/data-dir';
import { requireAdmin, type MembersCaller } from '@/lib/services/members';
import { sweepOrphanMedia } from '@/scripts/sweep-orphan-media.mjs';

/**
 * The scheduled orphan media check (#946, decided 2026-10-18: dry run only). The
 * hosted server runs `scripts/sweep-orphan-media.mjs` without `--apply` soon after
 * it starts and once a day after that, logs the counts, and shows the latest
 * result to admins on the Members page. Deleting stays a manual step after the
 * dry run is reviewed (#888), so nothing here can remove a file.
 */

export interface OrphanMediaCheck {
    checkedAt: string;
    /** Unreferenced originals and thumbnails older than the grace period. */
    files: number;
    bytes: number;
    /** Symlinks and other entries the sweep refuses to touch. */
    skipped: number;
    graceHours: number;
}

const FIRST_CHECK_DELAY_MS = 5 * 60_000;
const CHECK_INTERVAL_MS = 24 * 3_600_000;

// One schedule and one result per server process, kept across dev reloads.
const state = globalThis as typeof globalThis & {
    __orphanMediaCheck?: { scheduled: boolean; latest: OrphanMediaCheck | null; running: Promise<OrphanMediaCheck> | null };
};
function checkState() {
    state.__orphanMediaCheck ??= { scheduled: false, latest: null, running: null };
    return state.__orphanMediaCheck;
}

/** Run one dry run over the data dir. Concurrent callers share the run in flight. */
export function runOrphanMediaCheck(): Promise<OrphanMediaCheck> {
    const current = checkState();
    current.running ??= (async () => {
        try {
            const report = await sweepOrphanMedia({
                dataDir: getDataDir(),
                apply: false,
                listReferencedFilePaths: listAllReferencedMediaFilePaths,
            });
            const { originals, thumbnails, skipped } = report.totals;
            const result: OrphanMediaCheck = {
                checkedAt: new Date().toISOString(),
                files: originals.orphans + thumbnails.orphans,
                bytes: originals.orphanBytes + thumbnails.orphanBytes,
                skipped,
                graceHours: report.graceHours,
            };
            current.latest = result;
            console.info('Orphan media check', { category: 'orphan_media_check', ...result });
            return result;
        } finally {
            current.running = null;
        }
    })();
    return current.running;
}

/**
 * Start the daily dry run. Called once from `instrumentation.ts` on the hosted
 * Node server; a second call is a no-op. Timers are unref'd so they never hold
 * the process open, and a failed run is logged and retried on the next tick.
 */
export function scheduleOrphanMediaCheck(): void {
    const current = checkState();
    if (current.scheduled) return;
    current.scheduled = true;
    const tick = () => {
        runOrphanMediaCheck().catch((error: unknown) => {
            console.error('Orphan media check failed', {
                category: 'orphan_media_check_failed',
                message: error instanceof Error ? error.message : String(error),
            });
        });
    };
    setTimeout(() => {
        tick();
        setInterval(tick, CHECK_INTERVAL_MS).unref();
    }, FIRST_CHECK_DELAY_MS).unref();
}

/** For the Members page: the latest result, running a first check if none has finished. Admin only. */
export async function getOrphanMediaCheckService(caller: MembersCaller): Promise<{ check: OrphanMediaCheck }> {
    await requireAdmin(caller);
    return { check: checkState().latest ?? await runOrphanMediaCheck() };
}
