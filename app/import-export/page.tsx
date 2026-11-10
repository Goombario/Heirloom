'use client';

import { useState, useEffect, useId, useRef, useCallback, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { DATA_MODE, getDataClient } from '@/lib/data';
import { RateLimitError } from '@/lib/data/errors';
import { ValidationError } from '@/lib/validation';
import { useTree } from '@/app/contexts/TreeContext';
import { useActiveTreeName } from '@/app/hooks/useActiveTreeName';
import { useUnsavedChangesGuard } from '@/app/components/UnsavedChangesProvider';
import { GEDCOM_IMPORT_STEPS, type GedcomImportStep } from '@/lib/gedcom/import-steps';
import { Banner, Button, Badge, buttonClass, Card, PageShell } from '@/app/components/ui';
import { Loader2, AlertTriangle, Download, Upload } from '@/lib/icons';
import type { GedcomDryRunResponse, SpreadsheetDryRunResponse, SpreadsheetImportResponse, SkippedRecord, TreeCounts, MediaImportItem, MediaExportPreflight, ExportArtifact, GedcomExportOptions } from '@/lib/data/types';
import { findMissingMedia, findMissingMediaRefs, normalizeArchivePath, type ArchiveMediaEntry } from '@/lib/gedcom/media-match';
import { contentTypeForExtension } from '@/lib/media/allowed-extensions';
import { gateOverwriteImport, type NamedCounts } from '@/lib/gedcom/overwrite-gate';
import { MAX_GEDCOM_BYTES, capInMegabytes } from '@/lib/import-limits';
import { BUNDLE_SIDECARS, openGedcomZip, readBundleFile, type GedcomZipError } from '@/lib/gedcom/zip-bundle';
import ConfirmDialog from '@/app/components/ConfirmDialog';
import ImportProgress from './ImportProgress';
import MediaImportRecovery, { type ImportResultSummary } from './MediaImportRecovery';
import { ImportReport } from './ImportReport';
import MediaExportPreflightDialog from './MediaExportPreflightDialog';
import { collectArchiveMediaPaths } from './useMediaImportRecovery';
import { useDocumentTitle } from '@/app/hooks/useDocumentTitle';
import { useIsMobile } from '@/app/hooks/useIsMobile';
import { showChangeToast } from '@/app/components/ui';
import { MobileImportExport } from './MobileImportExport';

type GedcomImportResult = ImportResultSummary;

/** A browser-build import of this many people takes long enough to warn about (ST-1). */
const LARGE_IMPORT_PEOPLE = 1000;

interface MediaExportPreflightState {
    treeId: number | null;
    preflight: MediaExportPreflight;
}

export default function ImportExportPage() {
    const [file, setFile] = useState<File | null>(null);
    // No mode is pre-selected: Overwrite is destructive, so the user has to pick one
    // before Preview or Import will run (FL-1).
    const [mode, setMode] = useState<'overwrite' | 'merge' | null>(null);
    const [includeMedia, setIncludeMedia] = useState(true);
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
    const exportAnchorRef = useRef<HTMLDivElement>(null);
    const recoveryPanelRef = useRef<HTMLDivElement>(null);
    const exportBusyRef = useRef(false);
    const t = useTranslations('importExport');
    const ts = useTranslations('spreadsheetImport');
    const tCommon = useTranslations('common');
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
    const namedCounts = liveGate?.action === 'confirm' ? liveGate.counts : null;
    const countsText = (counts: NamedCounts) => t('tree_counts', { people: counts.people, families: counts.families });
    const modeLabel = (value: string) => (value === 'overwrite' ? t('mode_overwrite') : t('mode_merge'));
    const strong = (chunks: ReactNode) => <strong>{chunks}</strong>;

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

    /** Resolves true once a file was downloaded. `media` defaults to the checkbox. */
    async function handleExport(media: boolean = includeMedia): Promise<boolean> {
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

    if (isPhone) {
        return (
            <MobileImportExport
                treeName={treeName}
                permission={activePermission}
                treeEmpty={countsRead ? treeEmpty : null}
                liveCounts={liveCounts}
                countsText={countsText}
                activeTreeId={activeTreeId}
                file={file}
                onFile={(f) => { setFile(f); setError(null); setDryRunPreview(null); }}
                onStartJob={(next) => { startAnotherImport(); setFile(null); setDryRunPreview(null); setMode(next); }}
                previewing={previewing}
                loading={loading}
                checkingTree={checkingTree}
                importStep={importStep}
                importProgress={importProgress}
                preview={dryRunPreview}
                previewSidecars={previewSidecars}
                error={error}
                onPreview={() => { void handlePreview(); }}
                onBackToForm={handleCancelPreview}
                onImport={() => { void requestImport(); }}
                result={result}
                recoverySeed={recoverySeed}
                checksCount={checksReport?.treeId === activeTreeId ? checksReport.count : null}
                duplicatesCount={duplicateReport?.treeId === activeTreeId ? duplicateReport.count : null}
                onFinish={startAnotherImport}
                confirmOpen={confirmOverwrite}
                existingCounts={existingCounts}
                onConfirm={() => {
                    const confirmedTree = confirmOverwriteTree;
                    setConfirmOverwriteTree(undefined);
                    if (confirmedTree === activeTreeId) runImport();
                }}
                onCancelConfirm={() => setConfirmOverwriteTree(undefined)}
                exportBusy={exportBusy}
                exportError={exportError}
                onExport={handleExport}
                preflight={mediaExportPreflight?.preflight ?? null}
                onPreflightClose={() => setMediaExportPreflight(null)}
                onExportOmit={() => {
                    if (!mediaExportPreflight || activeTreeIdRef.current !== mediaExportPreflight.treeId) { setMediaExportPreflight(null); return; }
                    const exportTreeId = mediaExportPreflight.treeId;
                    setMediaExportPreflight(null);
                    void exportArtifact({ includeMedia: true, mediaPolicy: 'omit-unresolved' }, exportTreeId);
                }}
                xlsx={{
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
                }}
                onSkipLog={downloadSkipLog}
            />
        );
    }

    return (
        <PageShell title={t('title')} subtitle={t('subtitle')}>
            <div className="max-w-4xl">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-6">
                    {/* Import Section */}
                    <Card pad={false} className="p-6">
                        {/* Name the tree at every step: the active tree is per browser,
                            so the header chip was the only clue to what gets replaced (FR-2). */}
                        <h2 className="section text-text mb-4">{t('import_title_tree', { tree: treeName })}</h2>
                        <p className="text-text-secondary mb-6">{t('import_desc')}</p>

                        <div className="space-y-4">
                            {/* The form collapses once an import succeeds; the result
                                panel below takes over until "Import another file" (FR-3). */}
                            {!result && (<>
                            {/* File Upload */}
                            <FileField
                                label={t('select_file')}
                                accept=".ged,.zip"
                                file={file}
                                onFile={setFile}
                                chooseLabel={t('choose_file')}
                                noFileLabel={t('no_file')}
                            />

                            {/* Zip Structure Info */}
                            <div className="bg-surface border border-border rounded-lg p-4">
                                <p className="text-sm text-text font-medium mb-2">{t('zip_structure')}</p>
                                <p className="text-xs text-text-muted mb-2">{t('zip_desc')}</p>
                                <pre className="text-xs bg-card-alt p-2 rounded font-mono text-text-secondary">
                                    {`your_archive.zip
├── family_tree.ged  (required)
├── cases.json       (optional)
├── media.json       (optional)
├── sources.json     (optional)
└── media/           (optional)
    ├── photo1.jpg
    ├── photo2.png
    └── ...`}
                                </pre>
                                <p className="text-xs text-text-muted mt-2">{t('import_compression_note')}</p>
                            </div>

                            {/* Import Mode */}
                            <div>
                                <label className="block text-sm font-medium text-text mb-2">
                                    {t('import_mode')}
                                </label>
                                <div className="space-y-2">
                                    <label className="flex items-start p-3 border border-border rounded-lg cursor-pointer hover:bg-surface">
                                        <input
                                            type="radio"
                                            name="import-mode"
                                            value="overwrite"
                                            checked={mode === 'overwrite'}
                                            onChange={(e) => setMode(e.target.value as 'overwrite')}
                                            className="mt-1 mr-3"
                                        />
                                        <div>
                                            <div className="font-medium text-text">{t('mode_overwrite')}</div>
                                            <div className="text-sm text-text-muted">{t('mode_overwrite_desc')}</div>
                                        </div>
                                    </label>
                                    <label className="flex items-start p-3 border border-border rounded-lg cursor-pointer hover:bg-surface">
                                        <input
                                            type="radio"
                                            name="import-mode"
                                            value="merge"
                                            checked={mode === 'merge'}
                                            onChange={(e) => setMode(e.target.value as 'merge')}
                                            className="mt-1 mr-3"
                                        />
                                        <div>
                                            <div className="font-medium text-text">{t('mode_merge')}</div>
                                            <div className="text-sm text-text-muted">{t('mode_merge_desc')}</div>
                                        </div>
                                    </label>
                                </div>
                            </div>

                            {/* Overwrite is irreversible — warn + offer a one-click backup.
                                An empty tree has nothing to lose, so it gets neither. */}
                            {mode === 'overwrite' && liveGate?.action === 'confirm' && (
                                <Banner tone="warning" role="note" icon={<AlertTriangle className="w-4 h-4" />}>
                                    <p>{namedCounts
                                        ? t.rich('overwrite_warning_counts', { tree: treeName, counts: countsText(namedCounts), strong })
                                        : t.rich('overwrite_warning', { tree: treeName, strong })}</p>
                                    <button
                                        type="button"
                                        onClick={() => exportAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                                        className="mt-1.5 font-semibold underline cursor-pointer rounded focus-ring"
                                    >
                                        {t('back_up_first')}
                                    </button>
                                </Banner>
                            )}

                            {/* Preview / Import buttons */}
                            {dryRunPreview ? (
                                <div className="space-y-3">
                                    <div className="bg-surface border border-border rounded-lg p-4 space-y-2">
                                        <div className="flex items-center gap-2 mb-2">
                                            <Badge tone="green">{t('validated')}</Badge>
                                            {dryRunPreview.skipped.length > 0 && (
                                                <Badge tone="warning">{t('warnings_count', { count: dryRunPreview.skipped.length })}</Badge>
                                            )}
                                        </div>
                                        <p className="text-sm text-text-muted">{t.rich('preview_ready', { mode: modeLabel(dryRunPreview.mode), strong })}</p>
                                        {/* What's there now, beside what the file adds (FR-2). */}
                                        {liveCounts && (
                                            <p className="text-sm text-text-muted">
                                                {treeEmpty
                                                    ? t.rich('preview_current_empty', { tree: treeName, strong })
                                                    : t.rich(dryRunPreview.mode === 'overwrite' ? 'preview_current_overwrite' : 'preview_current_merge', { tree: treeName, counts: countsText(liveCounts), strong })}
                                            </p>
                                        )}
                                        <div className="grid grid-cols-2 gap-2 text-sm text-text">
                                            <div>{t('preview_people')}: <strong>{dryRunPreview.toImport.peopleCount}</strong></div>
                                            <div>{t('preview_families')}: <strong>{dryRunPreview.toImport.familiesCount}</strong></div>
                                            <div>{t('preview_children')}: <strong>{dryRunPreview.toImport.childrenCount}</strong></div>
                                            <div>{t('preview_media')}: <strong>{dryRunPreview.toImport.mediaCount}</strong></div>
                                            <div>{t('preview_sources')}: <strong>{dryRunPreview.toImport.sourcesCount}</strong></div>
                                            <div>{t('preview_citations')}: <strong>{dryRunPreview.toImport.citationsCount}</strong></div>
                                        </div>
                                        {previewSidecars && (
                                            <p className="text-xs text-text-muted">
                                                {previewSidecars.length > 0
                                                    ? t('preview_sidecars', { files: previewSidecars.join(', ') })
                                                    : t('preview_sidecars_none')}
                                            </p>
                                        )}
                                        {dryRunPreview.skipped.length > 0 && (
                                            <div className="mt-3 pt-3 border-t border-border">
                                                <p className="text-sm font-medium text-badge-warning-text mb-1">
                                                    {t('skipped_records', { count: dryRunPreview.skipped.length })}
                                                </p>
                                                <ul className="text-xs text-text-muted space-y-1 max-h-32 overflow-y-auto">
                                                    {dryRunPreview.skipped.slice(0, 50).map((s, i) => (
                                                        <li key={i} className="truncate">{s.type} {s.identifier} — {s.reason}</li>
                                                    ))}
                                                </ul>
                                                <button
                                                    type="button"
                                                    onClick={() => downloadSkipLog(dryRunPreview.skipped)}
                                                    className="mt-2 text-xs text-link hover:underline"
                                                >
                                                    {t('download_skip_log')}
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                    {/* The browser build imports in the page, about a minute for a
                                        large file; say so before the user starts (ST-1). */}
                                    {DATA_MODE === 'local' && dryRunPreview.toImport.peopleCount >= LARGE_IMPORT_PEOPLE && (
                                        <p className="text-sm text-text-muted">{t('import_browser_note')}</p>
                                    )}
                                    {loading && (
                                        <ImportProgress
                                            label={importProgress
                                                ? t('uploading_media')
                                                : importStep
                                                    ? t(`import_step_${importStep}`)
                                                    : t('importing_counts', { tree: treeName, counts: countsText({ people: dryRunPreview.toImport.peopleCount, families: dryRunPreview.toImport.familiesCount }) })}
                                            current={importProgress?.current ?? (importStep ? GEDCOM_IMPORT_STEPS.indexOf(importStep) + 1 : undefined)}
                                            total={importProgress?.total ?? (importStep ? GEDCOM_IMPORT_STEPS.length : undefined)}
                                        />
                                    )}
                                    <div className="flex gap-2">
                                        <Button
                                            className="flex-1"
                                            onClick={() => { void requestImport(); }}
                                            disabled={loading || checkingTree}
                                            icon={checkingTree && !loading ? <Loader2 className="animate-spin h-4 w-4" aria-hidden="true" /> : undefined}
                                        >
                                            {loading
                                                ? (importProgress ? t('upload_progress', { current: importProgress.current, total: importProgress.total }) : t('importing'))
                                                : checkingTree ? t('checking_tree') : t('import_button')}
                                        </Button>
                                        <Button
                                            variant="outline"
                                            onClick={handleCancelPreview}
                                            disabled={loading}
                                        >
                                            {tCommon('cancel')}
                                        </Button>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex flex-wrap items-center gap-3">
                                    <Button
                                        onClick={handlePreview}
                                        disabled={!file || !mode || previewing || loading}
                                        icon={previewing ? <Loader2 className="animate-spin h-4 w-4" aria-hidden="true" /> : undefined}
                                    >
                                        {previewing ? t('previewing') : t('preview_button')}
                                    </Button>
                                    {file && !mode && <p className="text-sm text-text-muted">{t('choose_mode_hint')}</p>}
                                </div>
                            )}
                            </>)}

                            {/* Error Message */}
                            {error && (
                                <Banner tone="error">
                                    <p className="font-semibold">{t('error_label')}</p>
                                    <p className="mt-1">{error}</p>
                                </Banner>
                            )}

                            <div ref={recoveryPanelRef} tabIndex={-1} role="region" aria-label={t('media_recovery_title')}>
                                <MediaImportRecovery
                                    treeId={activeTreeId}
                                    initialTreeId={recoverySeed?.treeId}
                                    initialItems={recoverySeed?.treeId === activeTreeId ? recoverySeed.items : undefined}
                                    initialArchive={recoverySeed?.treeId === activeTreeId ? recoverySeed.archive : null}
                                    result={result}
                                />
                            </div>

                            {result && (
                                <div className="space-y-3">
                                    <ImportReport
                                        datesToCheck={checksReport?.treeId === activeTreeId ? checksReport.count : null}
                                        duplicates={duplicateReport?.treeId === activeTreeId ? duplicateReport.count : null} />
                                    <Button variant="outline" onClick={startAnotherImport} icon={<Upload className="w-4 h-4" aria-hidden="true" />}>
                                        {t('import_another')}
                                    </Button>
                                </div>
                            )}
                        </div>
                    </Card>

                    {/* Export Section. The scroll anchor lives inside the card (not as a
                        sibling) so it never occupies a grid cell — a stray grid child here
                        pushed Export out of the second column and under Import. */}
                    <Card pad={false} className="p-6">
                        <div ref={exportAnchorRef} />
                        <h2 className="section text-text mb-4">{t('export_title')}</h2>
                        <p className="text-text-secondary mb-6">{t('export_desc')}</p>

                        <div className="space-y-4">
                            {/* Include Media Checkbox */}
                            <label className="flex items-center p-3 border border-border rounded-lg cursor-pointer hover:bg-surface">
                                <input
                                    type="checkbox"
                                    checked={includeMedia}
                                    onChange={(e) => setIncludeMedia(e.target.checked)}
                                    className="mr-3 w-4 h-4"
                                />
                                <div>
                                    <div className="font-medium text-text">{t('include_media')}</div>
                                    <div className="text-sm text-text-muted">{t('include_media_desc')}</div>
                                </div>
                            </label>

                            <div className="bg-surface border border-border rounded-lg p-4">
                                <p className="text-sm text-text">
                                    <strong>{t('what_is_gedcom_title')}</strong>
                                </p>
                                <p className="text-sm text-text-muted mt-2">{t('what_is_gedcom')}</p>
                            </div>

                            <Button
                                size="lg"
                                block
                                onClick={() => { void handleExport(); }}
                                disabled={exportBusy}
                                aria-busy={exportBusy}
                                // The media preflight takes a second or two; say so (BK-1).
                                icon={exportBusy
                                    ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                                    : <Download className="w-4 h-4" aria-hidden="true" />}
                            >
                                {exportBusy ? t('export_preparing') : includeMedia ? t('download_zip') : t('download_gedcom')}
                            </Button>
                            {exportError && (
                                <p role="alert" className="text-sm text-error">{exportError}</p>
                            )}

                            <div className="text-sm text-text-muted space-y-2">
                                <p><strong>{t('export_includes')}</strong></p>
                                <ul className="list-disc list-inside space-y-1 ml-2">
                                    <li>{t('export_all_people')}</li>
                                    <li>{t('export_all_families')}</li>
                                    <li>{t('export_birth_death')}</li>
                                    <li>{t('export_events')}</li>
                                    {includeMedia && <li>{t('export_photos')}</li>}
                                </ul>
                            </div>

                            <div className="bg-surface border border-border rounded-lg p-3">
                                <p className="text-xs text-text-muted">{t('export_sources_included')}</p>
                            </div>

                        </div>
                    </Card>
                </div>

                {mediaExportPreflight && (
                    <MediaExportPreflightDialog
                        preflight={mediaExportPreflight.preflight}
                        onReview={reviewMediaExport}
                        onCancel={() => setMediaExportPreflight(null)}
                        onExportWithoutUnresolved={() => {
                            if (activeTreeIdRef.current !== mediaExportPreflight.treeId) {
                                setMediaExportPreflight(null);
                                return;
                            }
                            const exportTreeId = mediaExportPreflight.treeId;
                            setMediaExportPreflight(null);
                            void exportArtifact({ includeMedia: true, mediaPolicy: 'omit-unresolved' }, exportTreeId);
                        }}
                        busy={exportBusy}
                    />
                )}

                {/* Overwrite confirmation modal — kept outside the import/export grid so
                    it is never counted as a grid child. */}
                <ConfirmDialog
                    open={confirmOverwrite}
                    variant="calm"
                    tone="danger"
                    title={t('overwrite_confirm_title')}
                    body={existingCounts
                        ? t('overwrite_confirm_body', { tree: treeName, counts: countsText(existingCounts) })
                        : t('overwrite_confirm_body_no_counts', { tree: treeName })}
                    warning={t('overwrite_confirm_warning')}
                    confirmLabel={t('overwrite_confirm_cta')}
                    busy={loading}
                    onConfirm={() => {
                        const confirmedTree = confirmOverwriteTree;
                        setConfirmOverwriteTree(undefined);
                        if (confirmedTree === activeTreeId) runImport();
                    }}
                    onCancel={() => setConfirmOverwriteTree(undefined)}
                />

                {/* Spreadsheet Import Section */}
                <Card pad={false} className="mt-6 p-6">
                    <div className="mb-4">
                        <h2 className="section m-0 text-text">{ts('title')}</h2>
                        <p className="text-text-secondary text-sm mt-0.5">{ts('subtitle')}</p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                        {/* Download template */}
                        <div className="space-y-3">
                            <p className="text-sm text-text-muted">{ts('download_template_desc')}</p>
                            <Button
                                variant="outline"
                                icon={<Download className="w-4 h-4" aria-hidden="true" />}
                                onClick={() => { window.location.href = `/api/import/spreadsheet/template?dateFormat=${dateFormat}`; }}
                            >
                                {ts('download_template')}
                            </Button>
                            <p className="text-xs text-text-muted">
                                {ts('date_format_note', {
                                    format: dateFormat === 'DMY' ? ts('format_dmy') : ts('format_mdy'),
                                })}
                            </p>
                        </div>

                        {/* Upload & import */}
                        <div className="space-y-4">
                            {xlsxPhase === 'idle' || xlsxPhase === 'previewing' ? (
                                <>
                                    <FileField
                                        label={ts('select_file')}
                                        accept=".xlsx"
                                        file={xlsxFile}
                                        onFile={(f) => { setXlsxFile(f); setXlsxError(null); }}
                                        chooseLabel={t('choose_file')}
                                        noFileLabel={t('no_file')}
                                    />
                                    <Button
                                        onClick={handleXlsxPreview}
                                        disabled={!xlsxFile || xlsxPhase === 'previewing'}
                                        icon={xlsxPhase === 'previewing' ? <Loader2 className="animate-spin h-4 w-4" aria-hidden="true" /> : undefined}
                                    >
                                        {xlsxPhase === 'previewing' ? ts('previewing') : ts('preview_button')}
                                    </Button>
                                </>
                            ) : xlsxPhase === 'preview' && xlsxDryRun ? (
                                <div className="space-y-4">
                                    <div className="bg-surface border border-border rounded-lg p-4 space-y-2">
                                        <p className="font-semibold text-text">{ts('preview_title')}</p>
                                        <p className="text-sm text-text-muted">{ts('preview_to_import')}</p>
                                        <ul className="text-sm text-text space-y-1 list-disc list-inside ml-2">
                                            <li>{ts('preview_people', { count: xlsxDryRun.toImport.peopleCount })}</li>
                                            <li>{ts('preview_families', { count: xlsxDryRun.toImport.familiesCount })}</li>
                                            <li>{ts('preview_children', { count: xlsxDryRun.toImport.childrenCount })}</li>
                                        </ul>
                                        {xlsxDryRun.skipped.length > 0 && (
                                            <div className="mt-3 pt-3 border-t border-border">
                                                <p className="text-sm font-medium text-badge-warning-text">
                                                    {ts('preview_skipped_title', { count: xlsxDryRun.skipped.length })}
                                                </p>
                                                <p className="text-xs text-text-muted mb-2">{ts('preview_skipped_desc')}</p>
                                                <ul className="text-xs text-text-muted space-y-1 max-h-32 overflow-y-auto">
                                                    {xlsxDryRun.skipped.map((s, i) => (
                                                        <li key={i} className="truncate">{s.identifier} — {s.reason}</li>
                                                    ))}
                                                </ul>
                                                <button
                                                    onClick={() => downloadSkipLog(xlsxDryRun.skipped)}
                                                    className="mt-2 text-xs text-link hover:underline"
                                                >
                                                    {ts('download_log')}
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex gap-2">
                                        <Button className="flex-1" onClick={handleXlsxConfirm}>
                                            {ts('confirm_button')}
                                        </Button>
                                        <Button
                                            variant="outline"
                                            onClick={handleXlsxCancel}
                                        >
                                            {ts('cancel_button')}
                                        </Button>
                                    </div>
                                </div>
                            ) : xlsxPhase === 'confirming' ? (
                                <div className="flex items-center justify-center py-8 gap-3 text-text-muted">
                                    <Loader2 className="animate-spin h-5 w-5" aria-hidden="true" />
                                    {ts('confirming')}
                                </div>
                            ) : xlsxPhase === 'done' && xlsxResult ? (
                                <Banner tone="success">
                                    <p className="font-semibold mb-2">{ts('success_title')}</p>
                                    <div className="space-y-1">
                                        <p><strong>{ts('success_people')}</strong> {xlsxResult.peopleImported}</p>
                                        <p><strong>{ts('success_families')}</strong> {xlsxResult.familiesImported}</p>
                                        <p><strong>{ts('success_children')}</strong> {xlsxResult.childrenLinked}</p>
                                        {xlsxResult.skipped.length > 0 && (
                                            <>
                                                <p><strong>{ts('success_skipped')}</strong> {xlsxResult.skipped.length}</p>
                                                <button
                                                    onClick={() => downloadSkipLog(xlsxResult.skipped)}
                                                    className="text-xs text-link hover:underline"
                                                >
                                                    {ts('download_log')}
                                                </button>
                                            </>
                                        )}
                                    </div>
                                    <div className="mt-3 flex flex-wrap gap-2">
                                        <Link href="/people" className={buttonClass({ variant: 'success' })}>
                                            {ts('view_people')}
                                        </Link>
                                        <Link href="/families" className={buttonClass({ variant: 'outline' })}>
                                            {ts('view_families')}
                                        </Link>
                                    </div>
                                </Banner>
                            ) : null}

                            {xlsxError && (
                                <Banner tone="error">
                                    <p className="font-semibold">{ts('error_label')}</p>
                                    <div className="mt-1 space-y-0.5">
                                        {xlsxError.split('\n').map((line, i) => (
                                            <p key={i}>{line}</p>
                                        ))}
                                    </div>
                                </Banner>
                            )}
                        </div>
                    </div>
                </Card>

                {/* Help Section */}
                <Card pad={false} className="mt-8 p-6">
                    <h3 className="section text-text mb-4">{t('help_title')}</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-text-muted">
                        <div>
                            <p className="font-medium text-text mb-2">{t('help_version_title')}</p>
                            <p>{t('help_version')}</p>
                        </div>
                        <div>
                            <p className="font-medium text-text mb-2">{t('help_size_title')}</p>
                            <p>{t('help_size')}</p>
                        </div>
                        <div>
                            <p className="font-medium text-text mb-2">{t('help_safety_title')}</p>
                            <p>{t('help_safety')}</p>
                        </div>
                        <div>
                            <p className="font-medium text-text mb-2">{t('help_merge_title')}</p>
                            <p>{t('help_merge')}</p>
                        </div>
                    </div>
                </Card>

            </div>
        </PageShell>
    );
}

/**
 * A file input shown as an outline `Button` plus the chosen file's name (BTN-6), instead
 * of the browser's unstyled "Choose file" control. The native input stays in the DOM,
 * hidden, so tests and drag-free pickers still reach it.
 */
function FileField({ label, accept, file, onFile, chooseLabel, noFileLabel }: {
    label: string;
    accept: string;
    file: File | null;
    onFile: (file: File | null) => void;
    chooseLabel: string;
    noFileLabel: string;
}) {
    const inputRef = useRef<HTMLInputElement>(null);
    const labelId = useId();
    return (
        <div>
            <p id={labelId} className="block text-sm font-medium text-text mb-2">{label}</p>
            <div className="flex items-center gap-3 min-w-0">
                <input
                    ref={inputRef}
                    type="file"
                    accept={accept}
                    aria-labelledby={labelId}
                    className="hidden"
                    onChange={(e) => onFile(e.target.files?.[0] ?? null)}
                />
                <Button
                    variant="outline"
                    className="shrink-0"
                    aria-describedby={labelId}
                    icon={<Upload className="w-4 h-4" aria-hidden="true" />}
                    onClick={() => {
                        // Clear first so picking the same file again still fires onChange.
                        if (inputRef.current) { inputRef.current.value = ''; inputRef.current.click(); }
                    }}
                >
                    {chooseLabel}
                </Button>
                <span className="text-sm text-text-secondary truncate min-w-0">
                    {file ? `${file.name} (${(file.size / 1024).toFixed(1)} KB)` : noFileLabel}
                </span>
            </div>
        </div>
    );
}
