'use client';

import type { LatestRelease } from '@/lib/updates';

/**
 * The desktop shell's side of an update (#24): taking the backup into Downloads,
 * and the Windows in-app install. Every Tauri module is loaded on demand, so the
 * web and static builds never fetch them.
 */

/** "auto": Windows with the updater set up, so Update now installs. "manual": open the release page instead. */
export type InstallMode = 'auto' | 'manual';

/** What the updater plugin hands back for a found update (only the parts used here). */
interface FoundUpdate {
    version: string;
    download(onEvent?: (e: { event: string; data?: { contentLength?: number; chunkLength?: number } }) => void): Promise<void>;
    install(): Promise<void>;
}

let found: FoundUpdate | null = null;

const onWindows = () => typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent);

/**
 * Whether this install can update itself to `latest`. Only Windows can, and only
 * in a build that carries the updater's signing key: elsewhere the plugin isn't
 * there and the check throws. The update it finds must be the release the
 * dialog names, or the app sends people to the release page instead.
 */
export async function detectInstallMode(latest: LatestRelease): Promise<InstallMode> {
    if (!onWindows()) return 'manual';
    try {
        const { check } = await import('@tauri-apps/plugin-updater');
        const update = (await check()) as FoundUpdate | null;
        if (update && update.version.replace(/^v/, '') === latest.version) {
            found = update;
            return 'auto';
        }
    } catch { /* no updater in this build */ }
    return 'manual';
}

/** A backup of every tree, saved to Downloads by the desktop shell. Resolves to the file name. */
export async function saveBackupToDownloads(): Promise<string> {
    const [{ dumpDatabaseLogical }, { invoke }] = await Promise.all([
        import('@/lib/db/connection.pglite'),
        import('@tauri-apps/api/core'),
    ]);
    const blob = await dumpDatabaseLogical();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const name = `heirloom-backup-${new Date().toISOString().slice(0, 10)}.hlbak`;
    return await invoke<string>('save_backup_to_downloads', bytes, { headers: { 'x-name': name } });
}

/** Downloads the update found by `detectInstallMode`, reporting bytes as they arrive. */
export async function downloadUpdate(onProgress: (got: number, total: number | null) => void): Promise<void> {
    if (!found) throw new Error('No update to download');
    let got = 0;
    let total: number | null = null;
    await found.download((e) => {
        if (e.event === 'Started') total = e.data?.contentLength ?? null;
        if (e.event === 'Progress') got += e.data?.chunkLength ?? 0;
        onProgress(got, total);
    });
}

/** Installs the downloaded update and restarts. On Windows the installer closes the app itself. */
export async function installAndRestart(): Promise<void> {
    if (!found) throw new Error('No update to install');
    await found.install();
    const { relaunch } = await import('@tauri-apps/plugin-process');
    await relaunch();
}
