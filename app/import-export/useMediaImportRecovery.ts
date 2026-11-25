'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getDataClient, withWriteBatch } from '@/lib/data';
import { AccessError, NotFoundError, RateLimitError, UnauthorizedError } from '@/lib/data/errors';
import { addInBackground, isJobActive, stopBackgroundJob, useBackgroundJob } from '@/app/components/media/backgroundMedia';
import type { MediaImportItem, MediaImportMaterializationOutcome } from '@/lib/data/types';
import { matchArchiveMediaExact, normalizeArchiveManifest, normalizeArchivePath, type ArchiveMediaEntry } from '@/lib/gedcom/media-match';
import { ALLOWED_EXTENSIONS, contentTypeForExtension } from '@/lib/media/allowed-extensions';
import { bundlePathsByEntry } from '@/lib/gedcom/zip-bundle';

interface MediaArchiveSelection {
  manifest: string[];
  entries: ArchiveMediaEntry<File>[];
}

// Recovery must retain exact paths for recognizable media files even when the
// materializer will reject their format. That records `unsupported_media_type`
// instead of falsely claiming a present file was missing. Destructive overwrite
// preflight remains limited to ALLOWED_EXTENSIONS below.
const RECOVERY_MEDIA_EXTENSIONS: ReadonlySet<string> = new Set([
  ...ALLOWED_EXTENSIONS,
  '.tif',
  '.tiff',
]);

export interface MediaImportRecoveryOptions {
  treeId?: number | null;
  /** Tree selection that produced the initial seed items/archive. */
  initialTreeId?: number | null;
  initialItems?: MediaImportItem[];
  /**
   * Desktop (#207): the photo step runs in the background queue, so it carries on
   * across pages and shows in the top bar. Phones keep the stay-on-page rule.
   */
  background?: boolean;
  /** The job's name in the top-bar list ("Imported photos · Ellison family"). */
  jobLabel?: string;
}

/** What went wrong, as the panel words it. Remove failures say why, not "use the archive" (#859). */
type MediaImportRecoveryError =
  | 'ambiguous_archive'
  | 'generic_error'
  | 'remove_error'
  | 'remove_forbidden'
  | 'remove_rate_limited';

/** The most items one bulk-remove request carries; the server's MAX_MISSING_MEDIA_BATCH. */
const REMOVE_BATCH_SIZE = 100;

export interface MediaImportRecoveryState {
  items: MediaImportItem[];
  busy: boolean;
  error: MediaImportRecoveryError | null;
  progress: { current: number; total: number } | null;
  /** While the hosted upload limit holds the photo step: when it carries on (ms since epoch). */
  waitUntil: number | null;
  /** Files in the last recovery run that were already in the tree and were linked instead of copied (#858). */
  reusedCount: number;
  refresh: () => Promise<MediaImportItem[]>;
  recover: (file: File, importId?: string, seedItems?: MediaImportItem[]) => Promise<void>;
  remove: (itemId: number) => Promise<void>;
  /** Removes many unresolved items in batched requests; ready or gone items are skipped. */
  removeMany: (itemIds: number[]) => Promise<void>;
  /** Stops a running recovery after the file in flight; nothing already saved is undone. */
  stop: () => void;
}

function removeErrorFor(caught: unknown): MediaImportRecoveryError {
  if (caught instanceof AccessError) return 'remove_forbidden';
  if (caught instanceof RateLimitError) return 'remove_rate_limited';
  return 'remove_error';
}

/** Return every safe, non-directory media path in a bundle, regardless of folder. */
export function collectArchiveMediaPaths(names: string[]): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const normalized = normalizeArchivePath(name);
    if (!normalized) continue;
    const dot = normalized.lastIndexOf('.');
    const ext = dot >= 0 ? normalized.slice(dot).toLowerCase() : '';
    if (!ALLOWED_EXTENSIONS.has(ext) || seen.has(normalized)) continue;
    seen.add(normalized);
    paths.push(normalized);
  }
  return paths;
}

function extension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot).toLowerCase() : '';
}

/** Read an archive once and retain the normalized manifest used for exact retry matching. */
async function readMediaArchive(file: File): Promise<MediaArchiveSelection> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(file);
  const files = Object.values(zip.files).filter((entry) => !entry.dir);
  // The import recorded paths relative to the .ged's folder, so match on those (#1006).
  const bundlePaths = bundlePathsByEntry(files.map((entry) => entry.name));
  const manifest = normalizeArchiveManifest([...bundlePaths.values()]);
  const entries: ArchiveMediaEntry<File>[] = [];
  for (const entry of files) {
    if (!RECOVERY_MEDIA_EXTENSIONS.has(extension(entry.name))) continue;
    const normalized = bundlePaths.get(entry.name);
    if (!normalized) continue;
    const blob = await entry.async('blob');
    const basename = normalized.split('/').pop() || 'media';
    entries.push({ archivePath: normalized, file: new File([blob], basename, { type: contentTypeForExtension(extension(normalized)) }) });
  }
  return { manifest, entries };
}

function mergeItems(existing: MediaImportItem[], incoming: MediaImportItem[]): MediaImportItem[] {
  const byId = new Map(existing.map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return Array.from(byId.values()).sort((a, b) => a.id - b.id);
}

function isCurrent(generation: number, treeId: number | null | undefined, currentGeneration: number, currentTreeId: number | null | undefined): boolean {
  return generation === currentGeneration && treeId === currentTreeId;
}

function belongsToScope(itemTreeId: number | null, scopeTreeId: number | null | undefined): boolean {
  // A null scope is resolved by the data client to its default tree. Do not
  // require durable items to carry a null TreeId in that mode.
  return scopeTreeId == null || itemTreeId === scopeTreeId;
}

/** The queue scope of a tree's import photo step, so a reopened panel finds it. */
const importScope = (treeId: number | null | undefined) => `import:${treeId ?? 'default'}`;

export function useMediaImportRecovery({ treeId = null, initialTreeId, initialItems, background = false, jobLabel = '' }: MediaImportRecoveryOptions = {}): MediaImportRecoveryState {
  const seedTreeId = initialTreeId === undefined ? treeId : initialTreeId;
  const [items, setItems] = useState<MediaImportItem[]>(() => initialItems ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MediaImportRecoveryState['error']>(null);
  const [progress, setProgress] = useState<MediaImportRecoveryState['progress']>(null);
  const [reusedCount, setReusedCount] = useState(0);
  const generationRef = useRef(0);
  const treeRef = useRef<number | null | undefined>(treeId);
  const removedRef = useRef<Set<number>>(new Set());
  const discoverySequenceRef = useRef(0);

  // On a phone, leaving the page stops the loop before its next file (#859): a
  // phone browser pauses background tabs, so a hidden loop would only stall. A
  // flag rather than a generation bump, so Strict Mode's remount doesn't end a
  // running loop. On a desktop the loop is a visible background job with Stop
  // (#207), so leaving the page doesn't stop it.
  const mountedRef = useRef(false);
  const job = useBackgroundJob(importScope(treeId));
  const jobActive = job != null && isJobActive(job);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const discover = useCallback(async (
    operationTree: number | null | undefined,
  ): Promise<{ discovered: MediaImportItem[]; sequence: number }> => {
    const sequence = ++discoverySequenceRef.current;
    const client = await getDataClient();
    const discovered = await client.gedcom.listUnresolvedImportMedia(operationTree);
    return { discovered, sequence };
  }, []);

  useEffect(() => {
    generationRef.current += 1;
    discoverySequenceRef.current += 1;
    treeRef.current = treeId;
    removedRef.current = new Set();
    setError(null);
    setProgress(null);
    const seedsBelongToSelection = seedTreeId === treeId;
    setItems(seedsBelongToSelection
      ? (initialItems ?? []).filter((item) => belongsToScope(item.treeId, treeId))
      : []);
    let cancelled = false;
    const generation = generationRef.current;
    void (async () => {
      try {
        if (cancelled) return;
        const result = await discover(treeId);
        if (
          !cancelled
          && isCurrent(generation, treeId, generationRef.current, treeRef.current)
          && result.sequence === discoverySequenceRef.current
        ) {
          setItems((previous) => mergeItems(previous.filter((item) => item.status === 'ready'), result.discovered));
        }
      } catch {
        if (!cancelled && isCurrent(generation, treeId, generationRef.current, treeRef.current)) setError('generic_error');
      }
    })();
    return () => { cancelled = true; };
  }, [discover, initialItems, seedTreeId, treeId]);

  const refresh = useCallback(async (): Promise<MediaImportItem[]> => {
    const generation = generationRef.current;
    const operationTree = treeRef.current;
    const result = await discover(operationTree);
    if (
      isCurrent(generation, operationTree, generationRef.current, treeRef.current)
      && result.sequence === discoverySequenceRef.current
    ) {
      setItems((previous) => mergeItems(previous.filter((item) => !removedRef.current.has(item.id)), result.discovered));
    }
    return result.discovered;
  }, [discover]);

  // Retry from the jobs panel runs the latest recover, with the latest list.
  const recoverRef = useRef<(file: File, importId?: string) => Promise<void>>(async () => {});
  const recover = useCallback(async (file: File, importId?: string, seedItems?: MediaImportItem[]) => {
    const generation = generationRef.current;
    const operationTree = treeRef.current;
    // A discovery started before this recovery is no longer authoritative.
    // Its result must not be allowed to replace a ready outcome written below.
    discoverySequenceRef.current += 1;
    setBusy(true);
    setError(null);
    setProgress(null);
    try {
      const current = (seedItems ?? items).filter((item) => belongsToScope(item.treeId, operationTree));
      const importIds = new Set(current.map((item) => item.importId));
      const targetImportId = importId ?? (importIds.size === 1 ? Array.from(importIds)[0] : undefined);
      if (!targetImportId || !importIds.has(targetImportId)) {
        setError('generic_error');
        return;
      }
      if (seedItems) setItems((previous) => mergeItems(previous, current));
      const archive = await readMediaArchive(file);
      if (!mountedRef.current || !isCurrent(generation, operationTree, generationRef.current, treeRef.current)) return;
      const unresolved = current.filter((item) => item.importId === targetImportId && item.status !== 'ready');
      const exactMatches = unresolved.map((item) => ({ item, file: matchArchiveMediaExact(item, archive.entries) }));
      const missingIds = exactMatches.filter((match) => match.file === null).map((match) => match.item.id);
      const client = await getDataClient();
      const localOutcomes: MediaImportItem[] = [];
      if (missingIds.length > 0) {
        const marked = await client.gedcom.markImportMediaMissing(missingIds, operationTree);
        localOutcomes.push(...marked);
        await refresh();
        if (isCurrent(generation, operationTree, generationRef.current, treeRef.current)) setItems((previous) => mergeItems(previous, marked));
      }
      const matched = exactMatches.filter((match): match is { item: MediaImportItem; file: File } => match.file !== null);
      setProgress({ current: 0, total: matched.length });
      setReusedCount(0);
      let currentProgress = 0;
      const stillHere = () => isCurrent(generation, operationTree, generationRef.current, treeRef.current);
      /** Materializes every matched photo; returns true when it stopped early. */
      const materializeAll = (shouldStop: () => boolean, step: <T>(fn: () => Promise<T>) => Promise<T>, counted: () => void) =>
        // One IndexedDB flush for every photo, not one per photo (#1259).
        withWriteBatch(async (batchClient) => {
          for (const match of matched) {
            if (shouldStop()) return true;
            try {
              const outcome = await step(() => batchClient.gedcom.materializeImportMedia(match.item.id, normalizeArchivePath(match.item.archivePath) ?? match.item.archivePath, match.file, operationTree));
              if (stillHere()) {
                await refresh();
                updateOutcome(outcome);
                if (outcome.item) localOutcomes.push(outcome.item);
                if (outcome.outcome === 'ready' && outcome.reused) setReusedCount((count) => count + 1);
              }
            } catch (caught) {
              // A stop, a lapsed sign-in or a refused tree ends the job; one bad photo doesn't.
              if (background && (caught instanceof UnauthorizedError || (caught instanceof Error && caught.name === 'JobStopped'))) throw caught;
              if (stillHere()) setError('generic_error');
            } finally {
              currentProgress += 1;
              counted();
              if (stillHere()) setProgress({ current: currentProgress, total: matched.length });
            }
          }
          return false;
        });
      let stopped = false;
      if (background && matched.length > 0) {
        await addInBackground({
          kind: 'import',
          label: jobLabel,
          scope: importScope(operationTree),
          total: matched.length,
          describe: () => '',
          // #236: the photos the job hadn't reached, and Retry with the ZIP this tab
          // still holds; photos already added are skipped (only unresolved ones run).
          zipName: file.name,
          notAdded: () => matched.slice(currentProgress).map((m) => ({ name: m.item.archivePath.split('/').pop() || m.item.archivePath })),
          retry: () => { void recoverRef.current(file, targetImportId); },
          run: async ({ added, step, stopped: stopPressed, stop }) => {
            stopped = await materializeAll(() => {
              // Panel Stop bumps the generation, as does moving the panel to another
              // tree: either way the job ends where it is. Leaving the page doesn't.
              if (!stillHere()) stop();
              return stopPressed() || !stillHere();
            }, step, () => added());
          },
        });
      } else {
        stopped = await materializeAll(() => !mountedRef.current || !stillHere(), (fn) => fn(), () => {});
      }
      if (stopped) return;
      if (isCurrent(generation, operationTree, generationRef.current, treeRef.current) && localOutcomes.length > 0) {
        setItems((previous) => mergeItems(previous, localOutcomes));
      }
      // Make the durable list the final authority after all item transitions.
      // This also sequences the last read after any older mount discovery.
      if (isCurrent(generation, operationTree, generationRef.current, treeRef.current)) {
        await refresh();
        if (localOutcomes.length > 0) {
          setItems((previous) => mergeItems(previous, localOutcomes));
        }
      }
    } catch (caught) {
      if (caught instanceof Error && caught.message.includes('duplicate path')) setError('ambiguous_archive');
      else setError('generic_error');
    } finally {
      if (isCurrent(generation, operationTree, generationRef.current, treeRef.current)) {
        setBusy(false);
        setProgress(null);
      }
    }
  // `items` is intentionally read at operation start; callers get a stable operation snapshot.
  }, [background, items, jobLabel, refresh]);
  useEffect(() => { recoverRef.current = recover; }, [recover]);

  function updateOutcome(outcome: MediaImportMaterializationOutcome) {
    const item = outcome.item;
    if (item) setItems((previous) => mergeItems(previous, [item]));
  }

  // A refresh after a remove only tidies the list. Its failure must not make a
  // remove that worked look failed (#859).
  const refreshQuietly = useCallback(async () => {
    try { await refresh(); } catch { /* the next refresh corrects the list */ }
  }, [refresh]);

  const remove = useCallback(async (itemId: number) => {
    const generation = generationRef.current;
    const operationTree = treeRef.current;
    const current = () => isCurrent(generation, operationTree, generationRef.current, treeRef.current);
    setBusy(true);
    setError(null);
    try {
      const client = await getDataClient();
      try {
        await client.gedcom.removeUnresolvedImportMedia(itemId, operationTree);
      } catch (caught) {
        // Already resolved or gone, usually finished by an import still running
        // in the background: the row is stale, so drop it rather than fail.
        if (!(caught instanceof NotFoundError)) throw caught;
      }
      removedRef.current.add(itemId);
      if (current()) setItems((previous) => previous.filter((item) => item.id !== itemId));
      await refreshQuietly();
    } catch (caught) {
      if (current()) setError(removeErrorFor(caught));
    } finally {
      if (current()) setBusy(false);
    }
  }, [refreshQuietly]);

  const removeMany = useCallback(async (itemIds: number[]) => {
    if (itemIds.length === 0) return;
    const generation = generationRef.current;
    const operationTree = treeRef.current;
    const current = () => isCurrent(generation, operationTree, generationRef.current, treeRef.current);
    setBusy(true);
    setError(null);
    try {
      const client = await getDataClient();
      for (let start = 0; start < itemIds.length; start += REMOVE_BATCH_SIZE) {
        if (!current()) return;
        const batch = itemIds.slice(start, start + REMOVE_BATCH_SIZE);
        await client.gedcom.removeUnresolvedImportMediaBatch(batch, operationTree);
        // Every requested id is settled: removed now, or already ready or gone.
        for (const id of batch) removedRef.current.add(id);
        const settled = new Set(batch);
        if (current()) setItems((previous) => previous.filter((item) => !settled.has(item.id)));
      }
    } catch (caught) {
      if (current()) setError(removeErrorFor(caught));
    } finally {
      await refreshQuietly();
      if (current()) setBusy(false);
    }
  }, [refreshQuietly]);

  const stop = useCallback(() => {
    if (job && isJobActive(job)) stopBackgroundJob(job.id);
    generationRef.current += 1;
    setBusy(false);
    setProgress(null);
    void refreshQuietly();
  }, [job, refreshQuietly]);

  // A panel reopened while its tree's photo step runs elsewhere keeps its list
  // current as photos land, and once more when the job ends.
  const jobDone = job?.done ?? 0;
  useEffect(() => {
    if (job == null) return;
    void refreshQuietly();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh on each photo and on the job's end, not on every job field
  }, [jobDone, jobActive]);

  // A panel opened while its tree's photo step runs in the background shows that job.
  const shownProgress = jobActive ? { current: job.done, total: job.total } : progress;
  return {
    items, busy: busy || jobActive, error, progress: shownProgress,
    waitUntil: jobActive && job.status === 'waiting' ? job.waitUntil : null,
    reusedCount, refresh, recover, remove, removeMany, stop,
  };
}
