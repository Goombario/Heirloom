'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { getDataClient } from '@/lib/data';
import { RateLimitError } from '@/lib/data/errors';
import { ValidationError } from '@/lib/validation';
import { useTree } from '@/app/contexts/TreeContext';
import { useActiveTreeName } from '@/app/hooks/useActiveTreeName';
import { useUnsavedChangesGuard } from '@/app/components/UnsavedChangesProvider';
import type { GedcomImportStep } from '@/lib/gedcom/import-steps';
import type { GedcomDryRunResponse, SpreadsheetDryRunResponse, SpreadsheetImportResponse, SkippedRecord, TreeCounts, MediaImportItem, MediaExportPreflight, ExportArtifact, GedcomExportOptions } from '@/lib/data/types';
import { findMissingMedia, findMissingMediaRefs, normalizeArchivePath, type ArchiveMediaEntry } from '@/lib/gedcom/media-match';
import { contentTypeForExtension } from '@/lib/media/allowed-extensions';
import { gateOverwriteImport, type NamedCounts } from '@/lib/gedcom/overwrite-gate';
import { MAX_GEDCOM_BYTES, capInMegabytes } from '@/lib/import-limits';
import { BUNDLE_SIDECARS, openGedcomZip, readBundleFile, type GedcomZipError } from '@/lib/gedcom/zip-bundle';
import type { ImportResultSummary } from './MediaImportRecovery';
import { collectArchiveMediaPaths } from './useMediaImportRecovery';
import { useDocumentTitle } from '@/app/hooks/useDocumentTitle';
import { useIsMobile } from '@/app/hooks/useIsMobile';
import { showChangeToast } from '@/app/components/ui';
import { MobileImportExport, type MobileImportExportProps } from './MobileImportExport';
import { DesktopImportExport } from './desktop/DesktopImportExport';

type GedcomImportResult = ImportResultSummary;

interface MediaExportPreflightState {
    treeId: number | null;
    preflight: MediaExportPreflight;
}

export default function ImportExportPage() {
    const [file, setFile] = useState<File | null>(null);
    // No mode is pre-selected: Overwrite is destructive, so the user has to pick one
    // before Preview or Import will run (FL-1).
    const [mode, setMode] = useState<'overwrite' | 'merge' | null>(null);
    const [loading, setLoading] = useState(false);
    const [importProgress, setImportProgress] = useState<{ current: number; total: number } | null>(null);
    const [result, setResult] = useState<GedcomImportResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [dryRunPreview, setDryRunPreview] = useState<GedcomDryRunResponse | null>(null);
    // Sidecars found beside the .ged in a zip, shown in the preview (#883); null for a bare .ged.
    const [previewSidecars, setPreviewSidecars] = useState<string[] | null>(null);
    const [previewing, setPreviewing] = useState(false);
    // The tree the open Overwrite confirmation describes (undefined = closed). A
    // tree switch while it's open must not confirm an overwrite of the new tree.
    const [confirmOverwriteTree, setConfirmOverwriteTree] = useState<number | null | undefined>(undefined);
    // Counts of the tree an overwrite would replace, for the warning copy — read
    // from the database at confirm time, not from the parsed file. Null = nothing
    // worth naming (unreadable, or no people/families to name).
    const [existingCounts, setExistingCounts] = useState<NamedCounts | null>(null);
    const [checkingTree, setCheckingTree] = useState(false);
    const [exportBusy, setExportBusy] = useState(false);
    const [exportError, setExportError] = useState<string | null>(null);
    const [mediaExportPreflight, setMediaExportPreflight] = useState<MediaExportPreflightState | null>(null);
    const [recoverySeed, setRecoverySeed] = useState<{
        treeId: number | null;
        items: MediaImportItem[];
        archive: File | null;
    } | null>(null);
    // The live counts of the tree this page imports into, keyed by tree so a tree
    // switch never shows the previous tree's counts. They name what an overwrite
    // replaces, and an empty tree gets no warning (FR-2). `counts: null` = the read
    // failed, which keeps the warning (without numbers).
    const [treeCounts, setTreeCounts] = useState<{ treeId: number | null; counts: TreeCounts | null } | null>(null);
    const [importStep, setImportStep] = useState<GedcomImportStep | null>(null);
    const [duplicateReport, setDuplicateReport] = useState<{ treeId: number | null; count: number } | null>(null);
    // The data checks' count over the target tree once the import completes (FR-3, #835).
    const [checksReport, setChecksReport] = useState<{ treeId: number | null; count: number } | null>(null);
    const recoveryPanelRef = useRef<HTMLDivElement>(null);
    const exportBusyRef = useRef(false);
    const t = useTranslations('importExport');
    const zipErrorMessage = (error: GedcomZipError): string => {
        switch (error) {
            case 'multiple_ged': return t('error_multiple_ged_in_zip');
            case 'too_large': return t('error_zip_entry_too_large');
            case 'unsafe_paths': return t('media_recovery_ambiguous_archive');
            case 'no_ged': return t('error_no_ged_in_zip');
        }
    };
    // A bare .ged over the server's cap is refused before upload (#1222). A zip's
    // .ged is checked as it is extracted (openGedcomZip → too_large).
    const gedcomOverCap = (candidate: File) => candidate.name.toLowerCase().endsWith('.ged') && candidate.size > MAX_GEDCOM_BYTES;
    const gedcomTooLargeMessage = t('error_gedcom_too_large', { mb: capInMegabytes(MAX_GEDCOM_BYTES) });
    const tm = useTranslations('mobileImport');
    const isPhone = useIsMobile();
    const router = useRouter();
    const treeName = useActiveTreeName();
    const { guardNavigation } = useUnsavedChangesGuard(false);
    // Every import/export/count call below MUST carry the active tree — with no
    // treeId the API resolves the DEFAULT tree, so a user working in tree B
    // would overwrite-wipe (or export) tree A without any warning.
    const { activeTreeId, activePermission } = useTree();
    const activeTreeIdRef = useRef<number | null>(activeTreeId);
    activeTreeIdRef.current = activeTreeId;
    // Closed by a tree switch: it described the previous tree.
    const confirmOverwrite = confirmOverwriteTree !== undefined && confirmOverwriteTree === activeTreeId;

    useEffect(() => {
        setMediaExportPreflight((current) => current && current.treeId !== activeTreeId ? null : current);
    }, [activeTreeId]);

    const refreshTreeCounts = useCallback(async (treeId: number | null) => {
        try {
            const counts = await (await getDataClient()).tree.getCounts(treeId);
            setTreeCounts({ treeId, counts });
        } catch {
            setTreeCounts({ treeId, counts: null });
        }
    }, []);

    useEffect(() => { void refreshTreeCounts(activeTreeId); }, [activeTreeId, refreshTreeCounts]);

    // Null until this tree's counts are read, so the warning doesn't flash up on an
    // empty tree while they load. The confirm dialog is still the last guard.
    const countsRead = treeCounts?.treeId === activeTreeId;
    const liveCounts = countsRead ? treeCounts.counts : null;
    const liveGate = countsRead ? gateOverwriteImport(liveCounts) : null;
    const treeEmpty = liveGate?.action === 'proceed';
    const countsText = (counts: NamedCounts) => t('tree_counts', { people: counts.people, families: counts.families });

    // Spreadsheet import state
    const [xlsxFile, setXlsxFile] = useState<File | null>(null);
    const [xlsxPhase, setXlsxPhase] = useState<'idle' | 'previewing' | 'preview' | 'confirming' | 'done'>('idle');
    const [xlsxDryRun, setXlsxDryRun] = useState<SpreadsheetDryRunResponse | null>(null);
    const [xlsxResult, setXlsxResult] = useState<SpreadsheetImportResponse | null>(null);
    const [xlsxError, setXlsxError] = useState<string | null>(null);
    const [dateFormat, setDateFormat] = useState<'MDY' | 'DMY'>('MDY');
    // Read date format preference from localStorage on mount
    useEffect(() => {
        const stored = localStorage.getItem('dateSlashFormat');
        if (stored === 'DMY') setDateFormat('DMY');
    }, []);

    useDocumentTitle(t('title'));

    async function handlePreview() {
        if (!file) {
            setError(t('please_select'));
            return;
        }
        if (!mode) return;
        if (gedcomOverCap(file)) {
            setError(gedcomTooLargeMessage);
            return;
        }
        setPreviewing(true);
        setError(null);
        setDryRunPreview(null);
        try {
            const isZip = file.name.toLowerCase().endsWith('.zip');
            let gedFile: File = file;
            let mediaJsonText: string | null = null;
            let sourcesJsonText: string | null = null;
            let sidecarsFound: string[] = [];
            if (isZip) {
                const JSZip = (await import('jszip')).default;
                const bundle = await openGedcomZip(await JSZip.loadAsync(file));
                if ('error' in bundle) {
                    setError(zipErrorMessage(bundle.error));
                    setPreviewing(false);
                    return;
                }
                gedFile = bundle.gedFile;
                // media.json lets the preview count library photos that aren't in the .ged
                mediaJsonText = bundle.sidecars['media.json'] ?? null;
                sourcesJsonText = bundle.sidecars['sources.json'] ?? null;
                sidecarsFound = BUNDLE_SIDECARS.filter((name) => bundle.sidecars[name] !== undefined);
            }
            const client = await getDataClient();
            const data = await client.gedcom.previewGedcom({ file: gedFile, mode, mediaJson: mediaJsonText || undefined, sourcesJson: sourcesJsonText || undefined }, activeTreeId);
            setDryRunPreview(data);
            setPreviewSidecars(isZip ? sidecarsFound : null);
        } catch (caughtError) {
            setError(caughtError instanceof RateLimitError ? t('error_rate_limited') : t('error_generic'));
        } finally {
            setPreviewing(false);
        }
    }

    function handleCancelPreview() {
        setDryRunPreview(null);
    }

    // Entry point from the Import button. Overwrite is destructive → gate it
    // behind a confirm dialog first; merge runs straight through.
    async function requestImport() {
        // `disabled` only takes effect on the next render, so a double-click can
        // re-enter before then. Guard on the state itself.
        if (loading || checkingTree) return;
        if (!file) { setError(t('please_select')); return; }
        if (!mode) return;
        if (mode !== 'overwrite') { runImport(); return; }

        // What overwrite destroys is the tree in the database, so the warning has
        // to describe *that* — and there is nothing to warn about when it's empty.
        // `getCounts` covers every table the overwrite deletes, not just the two
        // the copy names: a tree holding only library photos, only cases or only
        // repositories still has something to lose and must still confirm.
        setCheckingTree(true);
        let counts: TreeCounts | null = null;
        try {
            const client = await getDataClient();
            counts = await client.tree.getCounts(activeTreeId);
        } catch {
            // Couldn't read the tree — fall through to the count-less confirmation
            // rather than assume it's empty and skip the last guard.
            counts = null;
        } finally {
            setCheckingTree(false);
        }

        setTreeCounts({ treeId: activeTreeId, counts });
        const gate = gateOverwriteImport(counts);
        if (gate.action === 'proceed') { runImport(); return; }
        setExistingCounts(gate.counts);
        setConfirmOverwriteTree(activeTreeId);
    }

    async function runImport() {
        if (!file) {
            setError(t('please_select'));
            return;
        }
        if (!mode) return;
        if (gedcomOverCap(file)) {
            setError(gedcomTooLargeMessage);
            return;
        }

        setLoading(true);
        setImportProgress(null);
        setImportStep(null);
        setError(null);
        setResult(null);
        setDuplicateReport(null);
        // Keep the preview panel mounted during the import — it hosts the progress
        // bar and the "Importing…" button. Clearing it here (as before) collapsed the
        // UI back to the "Preview import" button with no loading indicator. It is
        // cleared on success below, once the result panel takes over.

        try {
            const isZip = file.name.toLowerCase().endsWith('.zip');

            let gedFile: File;
            const mediaBlobs: ArchiveMediaEntry<File>[] = [];
            let archiveManifest: string[] | undefined;
            let casesJsonText: string | null = null;
            let mediaJsonText: string | null = null;
            let sourcesJsonText: string | null = null;
            let placesJsonText: string | null = null;
            const zipWarnings: string[] = [];

            if (isZip) {
                // Extract zip in-browser so the server never sees the full archive
                const JSZip = (await import('jszip')).default;
                const zip = await JSZip.loadAsync(file);

                // The .ged and its sidecars (cases, media + face tags, sources,
                // the #402 gazetteer), wherever the bundle sits in the zip (#883).
                const bundle = await openGedcomZip(zip);
                if ('error' in bundle) {
                    setError(zipErrorMessage(bundle.error));
                    return;
                }
                gedFile = bundle.gedFile;
                casesJsonText = bundle.sidecars['cases.json'] ?? null;
                mediaJsonText = bundle.sidecars['media.json'] ?? null;
                sourcesJsonText = bundle.sidecars['sources.json'] ?? null;
                placesJsonText = bundle.sidecars['places.json'] ?? null;
                // Every path below is relative to the .ged's folder, the identity
                // media.json uses, so a re-zipped export folder still matches.
                const bundleEntries = [...bundle.layout.entries];
                archiveManifest = bundle.manifest;

                // Collect every allowed media file at its safe bundle path. The
                // declared path, not a basename or folder convention, is the
                // identity used by overwrite preflight and recovery.
                const archiveMediaPaths = new Set(collectArchiveMediaPaths(bundleEntries.map(([path]) => path)));
                for (const [path, entryName] of bundleEntries) {
                    const archivePath = normalizeArchivePath(path);
                    if (archivePath && archiveMediaPaths.has(archivePath)) {
                        try {
                            // Capped like the .ged, so a bomb hidden in a photo entry is
                            // skipped with a warning instead of exhausting the tab.
                            const bytes = await readBundleFile(zip, entryName);
                            if (!bytes) {
                                zipWarnings.push(t('error_zip_entry_too_large'));
                                continue;
                            }
                            const blob = new Blob([bytes]);
                            const basename = path.split('/').pop()!;
                            const ext = archivePath.slice(archivePath.lastIndexOf('.')).toLowerCase();
                            const mimeType = contentTypeForExtension(ext);
                            // Keep the upload File basename for server-side storage;
                            // archivePath remains the bundle-local identity key.
                            mediaBlobs.push({ archivePath, file: new File([blob], basename, { type: mimeType }) });
                        } catch {
                            zipWarnings.push(t('media_recovery_generic_error'));
                        }
                    }
                }
            } else {
                gedFile = file;
            }

            const client = await getDataClient();

            // Overwrite is destructive (it deletes existing media before the new
            // files are uploaded). Before deleting anything, dry-run to learn which
            // files the GEDCOM references and bail out if the zip is missing any —
            // otherwise those photos would be lost with no replacement. Merge mode
            // isn't destructive, so it proceeds and just reports the misses below.
            // A failed preview cannot establish that the replacement archive is
            // complete, so overwrite must stop before deleting existing media.
            if (isZip && mode === 'overwrite') {
                const check = await client.gedcom.previewGedcom({
                    file: gedFile,
                    mode,
                    mediaJson: mediaJsonText || undefined,
                    sourcesJson: sourcesJsonText || undefined,
                }, activeTreeId);
                const missing = check.expectedMediaRefs
                    ? findMissingMediaRefs(check.expectedMediaRefs, mediaBlobs)
                    : findMissingMedia(check.expectedMediaFilenames ?? [], mediaBlobs.map((entry) => entry.archivePath));
                if (missing.length > 0) {
                    setError(t('missing_media_overwrite', { count: missing.length }));
                    return;
                }
            }

            // Step 1: import the .ged file (+ optional cases/media/sources/places sidecars)
            const data = await client.gedcom.importGedcom({
                file: gedFile,
                mode,
                casesJson: casesJsonText || undefined,
                mediaJson: mediaJsonText || undefined,
                sourcesJson: sourcesJsonText || undefined,
                placesJson: placesJsonText || undefined,
                archiveManifest,
                onProgress: setImportStep,
            }, activeTreeId);

            setRecoverySeed({ treeId: activeTreeId, items: data.mediaItems, archive: isZip ? file : null });
            setResult({ ...data, zipWarnings, treeName });
            setFile(null);
            setMode(null);
            setDryRunPreview(null); // success → hand off from the preview panel to the result panel
            void refreshTreeCounts(activeTreeId);
            void loadDuplicateReport(activeTreeId);
            void loadChecksReport(activeTreeId);
        } catch (caughtError) {
            setError(caughtError instanceof RateLimitError ? t('error_rate_limited') : t('error_generic'));
        } finally {
            setLoading(false);
            setImportProgress(null);
            setImportStep(null);
        }
    }

    // The import report: point at the duplicate review (FR-6) when the import
    // brought in likely duplicates. A failed read just leaves the line out.
    async function loadDuplicateReport(treeId: number | null) {
        try {
            const suggestions = await (await getDataClient()).dashboard.suggestions(treeId);
            const duplicates = suggestions.find((suggestion) => suggestion.type === 'duplicates');
            setDuplicateReport({ treeId, count: duplicates?.count ?? 0 });
        } catch {
            setDuplicateReport(null);
        }
    }

    /** Best-effort: if the checks fail to run, the result shows without the line. */
    async function loadChecksReport(treeId: number | null) {
        try {
            const { problems } = await (await getDataClient()).dataChecks.list(treeId);
            setChecksReport({ treeId, count: problems.filter((p) => !p.confirmation).length });
        } catch {
            setChecksReport(null);
        }
    }

    function startAnotherImport() {
        setResult(null);
        setDuplicateReport(null);
        setChecksReport(null);
        setError(null);
    }

    /** The server's own message for a bad sheet (which sheet and row), and how long
     *  to wait when the import limit is reached (#1231). */
    function xlsxErrorText(caughtError: unknown): string {
        if (caughtError instanceof ValidationError) return caughtError.message;
        if (caughtError instanceof RateLimitError) {
            return caughtError.retryAfterSeconds != null
                ? t('error_rate_limited_minutes', { minutes: Math.max(1, Math.ceil(caughtError.retryAfterSeconds / 60)) })
                : t('error_rate_limited');
        }
        return t('error_generic');
    }

    async function handleXlsxPreview() {
        if (!xlsxFile) return;
        setXlsxPhase('previewing');
        setXlsxError(null);
        setXlsxDryRun(null);
        setXlsxResult(null);
        try {
            const client = await getDataClient();
            const data = await client.gedcom.previewSpreadsheet(xlsxFile, dateFormat, activeTreeId);
            setXlsxDryRun(data);
            setXlsxPhase('preview');
        } catch (caughtError) {
            setXlsxError(xlsxErrorText(caughtError));
            setXlsxPhase('idle');
        }
    }

    async function handleXlsxConfirm() {
        if (!xlsxFile) return;
        setXlsxPhase('confirming');
        setXlsxError(null);
        try {
            const client = await getDataClient();
            const data = await client.gedcom.importSpreadsheet(xlsxFile, dateFormat, activeTreeId);
            setXlsxResult(data);
            setXlsxPhase('done');
            setXlsxFile(null);
        } catch (caughtError) {
            setXlsxError(xlsxErrorText(caughtError));
            setXlsxPhase('preview');
        }
    }

    function handleXlsxCancel() {
        setXlsxPhase('idle');
        setXlsxDryRun(null);
        setXlsxError(null);
    }

    function downloadSkipLog(skipped: SkippedRecord[]) {
        const header = 'Type,Identifier,Reason\n';
        const rows = skipped.map(s =>
            `${s.type},"${s.identifier.replace(/"/g, '""')}","${s.reason.replace(/"/g, '""')}"`
        ).join('\n');
        const blob = new Blob([header + rows], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'import_skip_log.csv';
        a.click();
        URL.revokeObjectURL(url);
    }

    function downloadExportArtifact(artifact: ExportArtifact) {
        // Phones confirm the download with the file name (#1120, #1130).
        if (isPhone) showChangeToast({ message: tm('downloaded'), detail: artifact.filename });
        const url = URL.createObjectURL(artifact.blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = artifact.filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
    }

    async function exportArtifact(options: GedcomExportOptions, treeId: number | null): Promise<boolean> {
        if (exportBusyRef.current) return false;
        exportBusyRef.current = true;
        setExportBusy(true);
        setExportError(null);
        try {
            const client = await getDataClient();
            const artifact = await client.gedcom.exportGedcom(options, treeId);
            downloadExportArtifact(artifact);
            return true;
        } catch {
            setExportError(t('export_error_generic'));
            return false;
        } finally {
            exportBusyRef.current = false;
            setExportBusy(false);
        }
    }

    /** Resolves true once a file was downloaded: a backup with photos, or a bare GEDCOM. */
    async function handleExport(media: boolean): Promise<boolean> {
        if (exportBusyRef.current) return false;
        const exportTreeId = activeTreeId;
        if (!media) return exportArtifact({ includeMedia: false }, exportTreeId);

        exportBusyRef.current = true;
        setExportBusy(true);
        setExportError(null);
        try {
            const client = await getDataClient();
            const preflight = await client.gedcom.preflightExport(exportTreeId);
            if (!preflight.canExport) {
                if (activeTreeIdRef.current === exportTreeId) {
                    setMediaExportPreflight({ treeId: exportTreeId, preflight });
                }
                return false;
            }
            if (activeTreeIdRef.current !== exportTreeId) return false;
            const artifact = await client.gedcom.exportGedcom({ includeMedia: true }, exportTreeId);
            downloadExportArtifact(artifact);
            return true;
        } catch {
            setExportError(t('export_error_generic'));
            return false;
        } finally {
            exportBusyRef.current = false;
            setExportBusy(false);
        }
    }

    function reviewMediaExport() {
        setMediaExportPreflight(null);
        window.setTimeout(() => {
            const panel = recoveryPanelRef.current;
            // The panel lists import items only. With none (a missing backing
            // file has no item), the photos to fix are in Library (#947).
            if (!panel || panel.childElementCount === 0) {
                if (guardNavigation()) router.push('/library?tab=photos');
                return;
            }
            panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
            panel.focus({ preventScroll: true });
        }, 0);
    }

    const shared: MobileImportExportProps = {
        treeName,
        permission: activePermission,
        treeEmpty: countsRead ? treeEmpty : null,
        liveCounts,
        countsText,
        activeTreeId,
        file,
        onFile: (f) => { setFile(f); setError(null); setDryRunPreview(null); },
        onStartJob: (next) => { startAnotherImport(); setFile(null); setDryRunPreview(null); setMode(next); },
        previewing,
        loading,
        checkingTree,
        importStep,
        importProgress,
        preview: dryRunPreview,
        previewSidecars,
        error,
        onPreview: () => { void handlePreview(); },
        onBackToForm: handleCancelPreview,
        onImport: () => { void requestImport(); },
        result,
        recoverySeed,
        checksCount: checksReport?.treeId === activeTreeId ? checksReport.count : null,
        duplicatesCount: duplicateReport?.treeId === activeTreeId ? duplicateReport.count : null,
        onFinish: startAnotherImport,
        confirmOpen: confirmOverwrite,
        existingCounts,
        onConfirm: () => {
            const confirmedTree = confirmOverwriteTree;
            setConfirmOverwriteTree(undefined);
            if (confirmedTree === activeTreeId) runImport();
        },
        onCancelConfirm: () => setConfirmOverwriteTree(undefined),
        exportBusy,
        exportError,
        onExport: handleExport,
        preflight: mediaExportPreflight?.preflight ?? null,
        onPreflightClose: () => setMediaExportPreflight(null),
        onExportOmit: () => {
            if (!mediaExportPreflight || activeTreeIdRef.current !== mediaExportPreflight.treeId) { setMediaExportPreflight(null); return; }
            const exportTreeId = mediaExportPreflight.treeId;
            setMediaExportPreflight(null);
            void exportArtifact({ includeMedia: true, mediaPolicy: 'omit-unresolved' }, exportTreeId);
        },
        xlsx: {
            file: xlsxFile,
            onFile: (f) => { setXlsxFile(f); setXlsxError(null); },
            phase: xlsxPhase,
            dryRun: xlsxDryRun,
            result: xlsxResult,
            error: xlsxError,
            onPreview: () => { void handleXlsxPreview(); },
            onConfirm: () => { void handleXlsxConfirm(); },
            onCancel: () => { handleXlsxCancel(); setXlsxFile(null); setXlsxResult(null); },
            dateFormat,
        },
        onSkipLog: downloadSkipLog,
    };

    if (isPhone) return <MobileImportExport {...shared} />;
    return (
        <DesktopImportExport
            {...shared}
            onPreflightReview={reviewMediaExport}
            recoveryRef={recoveryPanelRef}
        />
    );
}
