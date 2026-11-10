'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
    markBatchDuplicates, applyTreeMatches, distinctHashes,
    type DuplicateInfo,
} from '@/app/components/upload/duplicate-scan';
import { getDataClient } from '@/lib/data';
import { hashBytes } from '@/lib/media/content-hash';
import { createUploadPreview } from '@/lib/media/upload-preview';
import { classifyUpload, PDF_CONTENT_TYPE } from '@/lib/media/allowed-extensions';

export interface UploadRow {
    id: string;
    file: File;
    /** The picked file, or its drawn first page; '' for a document until it is drawn. */
    preview: string;
    /** A PDF (#510): it previews as its first page and can't be a portrait. */
    document: boolean;
    /** SHA-256 of the original bytes; null until the scan reaches this row. */
    hash: string | null;
    /** Why this row is flagged, or null when it is not (#592). */
    duplicate: DuplicateInfo | null;
    /**
     * The library copy this file is already stored as (#1204). Set only when the
     * batch swaps duplicates: the row then stands for that copy and never uploads.
     */
    libraryId: number | null;
    /** Whether this row is picked. A file picked twice arrives false. */
    selected: boolean;
    primary: boolean;
    /** Uploaded in this batch: a green tick until the modal closes. */
    done: boolean;
}

/**
 * The new files half of Add media (#1204, from the #592 upload batch): rows, their
 * previews, and the duplicate scan. With `swapDuplicates` a file the tree already
 * holds stays ticked and becomes that library item (`libraryId`), so it is attached
 * instead of stored twice; without it (the Library page, which has nothing to attach
 * to) the file arrives unticked, as before. A file picked twice in one batch always
 * arrives unticked.
 */
export function useUploadBatch({ treeId, swapDuplicates }: { treeId: number | null; swapDuplicates: boolean }) {
    const [rows, setRows] = useState<UploadRow[]>([]);
    /** Non-null only while a duplicate scan is in flight. */
    const [scan, setScan] = useState<{ done: number; total: number } | null>(null);
    const rowsRef = useRef<UploadRow[]>([]);
    const liveRowIdsRef = useRef(new Set<string>());
    const liveUrlsRef = useRef(new Set<string>());
    const scanRunningRef = useRef(false);
    const rowSeqRef = useRef(0);
    rowsRef.current = rows;

    const revokeUrl = useCallback((url: string) => {
        if (!liveUrlsRef.current.delete(url)) return;
        URL.revokeObjectURL(url);
    }, []);

    useEffect(() => {
        const liveRowIds = liveRowIdsRef.current;
        const liveUrls = liveUrlsRef.current;
        return () => {
            liveRowIds.clear();
            for (const url of liveUrls) revokeUrl(url);
            liveUrls.clear();
        };
    }, [revokeUrl]);

    const update = useCallback((fn: (prev: UploadRow[]) => UploadRow[]) => {
        rowsRef.current = fn(rowsRef.current);
        setRows(fn);
    }, []);

    /**
     * Hash every un-hashed row, then flag repeats within the batch and files the
     * tree already holds. Wrapped end to end: on ANY failure every row stays picked
     * and uploads exactly as it did before the guard existed. A broken check must
     * never cost the user an upload.
     */
    const runScan = useCallback(async () => {
        if (scanRunningRef.current) return;
        scanRunningRef.current = true;
        try {
            while (true) {
                // Hashes are tracked locally rather than read back out of state:
                // `setRows` does not resolve before the next await, so a re-read of
                // the ref here would see rows that have not been re-rendered yet.
                const pending = rowsRef.current.filter(r => r.hash === null);
                if (pending.length === 0) break;
                setScan({ done: 0, total: pending.length });

                // Sequential and awaited so the event loop stays free between files:
                // a hundred-photo batch must not freeze the grid it is describing.
                for (let i = 0; i < pending.length; i++) {
                    const row = pending[i];
                    const bytes = new Uint8Array(await row.file.arrayBuffer());
                    const hash = await hashBytes(bytes);
                    rowsRef.current = rowsRef.current.map(r => (r.id === row.id ? { ...r, hash } : r));
                    setRows(prev => prev.map(r => (r.id === row.id ? { ...r, hash } : r)));

                    const preview = await createUploadPreview(bytes, row.document ? PDF_CONTENT_TYPE : row.file.type);
                    if (preview) {
                        const previewUrl = URL.createObjectURL(preview);
                        liveUrlsRef.current.add(previewUrl);
                        const current = rowsRef.current.find(r => r.id === row.id);
                        if (!current || !liveRowIdsRef.current.has(row.id) || current.file !== row.file) {
                            revokeUrl(previewUrl);
                        } else {
                            const supersededUrl = current.preview;
                            rowsRef.current = rowsRef.current.map(r => (
                                r.id === row.id ? { ...r, preview: previewUrl } : r
                            ));
                            setRows(prev => prev.map(r => (
                                r.id === row.id && r.file === row.file ? { ...r, preview: previewUrl } : r
                            )));
                            revokeUrl(supersededUrl);
                        }
                    }
                    setScan({ done: i + 1, total: pending.length });
                }

                const hashed = rowsRef.current.map(r => ({ id: r.id, hash: r.hash }));
                const batchFlags = markBatchDuplicates(hashed);

                const client = await getDataClient();
                const matches = await client.media.findDuplicates(distinctHashes(hashed), treeId);
                const treeFlags = applyTreeMatches(hashed, matches);
                const mediaIdByHash = new Map(matches.map(m => [m.hash, m.mediaId]));

                update(prev => prev.map(r => {
                    // A repeat within the batch outranks a tree match when swapping: the
                    // first copy already stands for the library item. Otherwise "you
                    // already have this" is the more useful of the two explanations.
                    if (batchFlags[r.id] && (swapDuplicates || !treeFlags[r.id])) {
                        return r.duplicate ? r : { ...r, duplicate: { kind: 'in-batch', title: null }, selected: false };
                    }
                    const tree = treeFlags[r.id];
                    if (!tree) return r;
                    if (r.duplicate) return r;
                    if (!swapDuplicates) return { ...r, duplicate: tree, selected: false };
                    return { ...r, duplicate: tree, libraryId: mediaIdByHash.get(r.hash ?? '') ?? null, primary: false };
                }));
            }
        } catch {
            // Deliberately silent: the guard is an optimisation, and its failure
            // is not something the user did or can act on. Everything stays
            // picked, so the batch behaves exactly as it did pre-#592.
        } finally {
            scanRunningRef.current = false;
            setScan(null);
        }
    }, [revokeUrl, treeId, swapDuplicates, update]);

    const addFiles = useCallback((files: FileList | readonly File[] | null) => {
        if (!files || files.length === 0) return;
        const next: UploadRow[] = Array.from(files).map(file => {
            const id = `r${rowSeqRef.current++}`;
            // A browser can't show a PDF in an <img>; its tile waits for the drawn page.
            const isDocument = classifyUpload(file.name, file.type) === 'pdf';
            const preview = isDocument ? '' : URL.createObjectURL(file);
            liveRowIdsRef.current.add(id);
            if (preview) liveUrlsRef.current.add(preview);
            return { id, file, preview, document: isDocument, hash: null, duplicate: null, libraryId: null, selected: true, primary: false, done: false };
        });
        update(prev => [...prev, ...next]);
        // Scan the array we just built, not state — state is not readable yet.
        void runScan();
    }, [runScan, update]);

    const toggle = useCallback((id: string) => {
        update(prev => prev.map(r => (r.id === id && !r.done ? { ...r, selected: !r.selected } : r)));
    }, [update]);

    const setPrimary = useCallback((id: string | null) => {
        update(prev => prev.map(r => ({ ...r, primary: r.id === id && !r.document && r.libraryId == null })));
    }, [update]);

    const markDone = useCallback((id: string) => {
        update(prev => prev.map(r => (r.id === id ? { ...r, done: true, selected: false } : r)));
    }, [update]);

    /** Clear: unticks every new file that hasn't gone up; they stay in the batch to re-tick. */
    const unselectAll = useCallback(() => {
        update(prev => prev.map(r => (r.done ? r : { ...r, selected: false, primary: false })));
    }, [update]);

    return { rows, rowsRef, scanning: scan != null, addFiles, toggle, setPrimary, markDone, unselectAll };
}
