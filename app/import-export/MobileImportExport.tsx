'use client';

import React, { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { DATA_MODE } from '@/lib/data';
import type { GedcomDryRunResponse, MediaExportPreflight, MediaImportItem, SkippedRecord, SpreadsheetDryRunResponse, SpreadsheetImportResponse, TreeCounts } from '@/lib/data/types';
import { GEDCOM_IMPORT_STEPS, type GedcomImportStep } from '@/lib/gedcom/import-steps';
import type { NamedCounts } from '@/lib/gedcom/overwrite-gate';
import { CopperPill, MobileListHeader, MobileRow, PageShell, cx } from '@/app/components/ui';
import { ConfirmSheet, Sheet } from '@/app/components/ui/Sheet';
import { AlertTriangle, ArrowUpRight, Check, CircleHelp, Download, FileText, GitMerge, LayoutGrid, Loader2, RotateCcw, Share2, Upload, Users } from '@/lib/icons';
import ImportProgress from './ImportProgress';
import MediaImportRecovery, { type ImportResultSummary } from './MediaImportRecovery';
import { ImportReport } from './ImportReport';
import { useIsDesktopApp } from '@/app/hooks/useIsDesktopApp';

/*
 * Import and export on phones (#1120, v2: option A's hub with C's merge and restore
 * split). One screen of three groups, each job in its own full-height sheet with
 * Preview / Import / Done top right: Back up (the copper Download backup pill, and a
 * GEDCOM for another app), Bring people in (Add from a file, which always merges, and
 * Add from a spreadsheet), and Start again (Restore a backup, which replaces the tree;
 * editors and owners only, and not on an empty tree). Viewers can only export.
 * Warnings, skipped records, help and the media export check open as small sheets.
 * The page owns every import and export; this is only how a phone shows it.
 */

type Job = 'merge' | 'restore' | 'xl';
type Small = 'skipped' | 'help' | 'zip' | 'xlhelp' | 'preflight';

export interface MobileImportExportProps {
    treeName: string;
    permission: string | null;
    /** Null until the counts are read. */
    treeEmpty: boolean | null;
    liveCounts: TreeCounts | null;
    countsText: (counts: NamedCounts) => string;
    activeTreeId: number | null;

    file: File | null;
    onFile: (file: File | null) => void;
    /** Starts a job: the mode it imports with and a clean form. */
    onStartJob: (mode: 'merge' | 'overwrite') => void;
    previewing: boolean;
    loading: boolean;
    checkingTree: boolean;
    importStep: GedcomImportStep | null;
    importProgress: { current: number; total: number } | null;
    preview: GedcomDryRunResponse | null;
    previewSidecars: string[] | null;
    error: string | null;
    onPreview: () => void;
    onBackToForm: () => void;
    onImport: () => void;
    result: ImportResultSummary | null;
    recoverySeed: { treeId: number | null; items: MediaImportItem[]; archive: File | null } | null;
    checksCount: number | null;
    duplicatesCount: number | null;
    onFinish: () => void;

    confirmOpen: boolean;
    existingCounts: NamedCounts | null;
    onConfirm: () => void;
    onCancelConfirm: () => void;

    exportBusy: boolean;
    exportError: string | null;
    onExport: (media: boolean) => Promise<boolean>;
    preflight: MediaExportPreflight | null;
    onPreflightClose: () => void;
    onExportOmit: () => void;

    xlsx: {
        file: File | null;
        onFile: (file: File | null) => void;
        phase: 'idle' | 'previewing' | 'preview' | 'confirming' | 'done';
        dryRun: SpreadsheetDryRunResponse | null;
        result: SpreadsheetImportResponse | null;
        error: string | null;
        onPreview: () => void;
        onConfirm: () => void;
        onCancel: () => void;
        dateFormat: 'MDY' | 'DMY';
    };
    onSkipLog: (skipped: SkippedRecord[]) => void;
}

export function MobileImportExport(p: MobileImportExportProps) {
    const t = useTranslations('mobileImport');
    const ti = useTranslations('importExport');
    const router = useRouter();
    const [job, setJob] = useState<Job | null>(null);
    const [small, setSmall] = useState<Small | null>(null);
    const [backedUp, setBackedUp] = useState(false);
    const canImport = p.permission !== 'view';
    const canReplace = p.permission === 'owner' || p.permission === 'edit';
    const counts = p.liveCounts;

    const open = (next: Job) => {
        setJob(next);
        setBackedUp(false);
        if (next !== 'xl') p.onStartJob(next === 'restore' ? 'overwrite' : 'merge');
        else p.xlsx.onCancel();
    };
    const close = () => {
        if (p.loading || p.xlsx.phase === 'confirming') return;
        if (p.result) p.onFinish();
        setJob(null);
    };

    return (
        <PageShell topBar={<MobileListHeader title={ti('title')} />} contentClassName="max-md:p-0!">
            <div className="grid gap-[3px] px-4 pt-4 pb-3.5 border-b border-border">
                <span className="eyebrow">{t('this_tree')}</span>
                <span className="serif font-semibold text-lg text-text">{p.treeName}</span>
                <span className="font-mono text-meta text-text-muted">
                    {p.treeEmpty ? t('no_people_yet') : counts ? t('tree_counts', { people: counts.people, families: counts.families }) : ' '}
                </span>
            </div>

            <Group title={t('back_up')}>
                <p className="m-0 px-4 pb-2.5 text-sm leading-normal text-text-secondary">{t('back_up_lede')}</p>
                <div className="px-4 pt-2 pb-3.5">
                    <CopperPill icon={p.exportBusy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Download aria-hidden="true" />}
                        disabled={p.exportBusy} aria-busy={p.exportBusy} onClick={() => { void p.onExport(true); }}>
                        {p.exportBusy ? ti('export_preparing') : t('download_backup')}
                    </CopperPill>
                </div>
                <MobileRow divided icon={<Share2 />} label={t('send_gedcom')} sub={t('send_gedcom_sub')} disabled={p.exportBusy}
                    onClick={() => { void p.onExport(false); }} />
                {p.exportError && <p role="alert" className="m-0 px-4 pb-3 text-sm text-error">{p.exportError}</p>}
            </Group>

            {canImport && (
                <Group title={t('bring_in')}>
                    <MobileRow icon={<GitMerge />} end="chevron" label={t('add_from_file')} sub={t('add_from_file_sub')} onClick={() => open('merge')} />
                    <MobileRow divided icon={<LayoutGrid />} end="chevron" label={t('add_from_spreadsheet')} sub={t('add_from_spreadsheet_sub')} onClick={() => open('xl')} />
                </Group>
            )}

            {canReplace && p.treeEmpty === false && (
                <Group title={t('start_again')}>
                    <MobileRow icon={<RotateCcw />} end="chevron" label={t('restore')} sub={t('restore_sub', { tree: p.treeName })} onClick={() => open('restore')} />
                </Group>
            )}

            {/* Photos still to finish from an earlier import; nothing renders without any. */}
            {!job && (
                <div className="px-4 pt-3 empty:hidden">
                    <MediaImportRecovery treeId={p.activeTreeId} />
                </div>
            )}

            <Group title={t('help')} last>
                <MobileRow icon={<CircleHelp />} end="chevron" label={t('about_files')} sub={t('about_files_sub')} onClick={() => setSmall('help')} />
            </Group>
            <div aria-hidden="true" style={{ height: 'calc(24px + env(safe-area-inset-bottom, 0px))' }} />

            {(job === 'merge' || job === 'restore') && (
                <ImportSheet p={p} restore={job === 'restore'} backedUp={backedUp} onClose={close}
                    onBackup={async () => { if (await p.onExport(true)) setBackedUp(true); }}
                    onSmall={setSmall} />
            )}
            {job === 'xl' && <SpreadsheetSheet p={p} onClose={close} onSmall={setSmall} />}

            <ConfirmSheet open={p.confirmOpen} title={ti('overwrite_confirm_title')}
                body={<>{p.existingCounts ? ti('overwrite_confirm_body', { tree: p.treeName, counts: p.countsText(p.existingCounts) }) : ti('overwrite_confirm_body_no_counts', { tree: p.treeName })} <span className="text-warning-text font-medium">{ti('overwrite_confirm_warning')}</span></>}
                confirmLabel={t('replace_tree')} keepLabel={t('keep_tree')} onConfirm={p.onConfirm} onClose={p.onCancelConfirm} busy={p.loading} />

            <SmallSheets p={p} which={small} onClose={() => setSmall(null)} onPhotos={() => router.push('/library?tab=photos')} />
        </PageShell>
    );
}

function Group({ title, last = false, children }: { title: string; last?: boolean; children: React.ReactNode }) {
    return (
        <section className={cx('pb-1.5', !last && 'border-b border-border')}>
            <h2 className="eyebrow m-0 px-4 pt-[18px] pb-1.5">{title}</h2>
            {children}
        </section>
    );
}

/** A file row: Choose a file, or the chosen file with Change. */
function FileRow({ file, accept, label, sub, onFile }: { file: File | null; accept: string; label: string; sub: string; onFile: (f: File | null) => void }) {
    const t = useTranslations('mobileImport');
    const ref = useRef<HTMLInputElement>(null);
    const pick = () => { if (ref.current) { ref.current.value = ''; ref.current.click(); } };
    return (
        <>
            <input ref={ref} type="file" accept={accept} className="hidden" aria-label={label} onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
            {file ? (
                <button type="button" onClick={pick} className="flex w-full min-h-[60px] items-center gap-3 px-4 py-2.5 text-left cursor-pointer active:bg-surface-2 focus-ring-inset">
                    <span aria-hidden="true" className="grid place-items-center w-[34px] h-[34px] shrink-0 rounded-[9px] bg-success-bg text-success [&_svg]:w-[18px] [&_svg]:h-[18px]"><FileText /></span>
                    <span className="flex-1 min-w-0 grid gap-px">
                        <span className="text-base font-medium text-text truncate">{file.name}</span>
                        <span className="text-meta text-text-muted">{t('file_size', { size: (file.size / 1024 / 1024).toFixed(1) })}</span>
                    </span>
                    <span className="text-sm font-medium text-text">{t('change')}</span>
                </button>
            ) : (
                <MobileRow icon={<Upload />} end="chevron" label={label} sub={sub} onClick={pick} />
            )}
        </>
    );
}

function Kv({ label, value, first }: { label: string; value: React.ReactNode; first?: boolean }) {
    return (
        <div className={cx('flex items-baseline justify-between px-4 py-2.5 text-base', !first && 'border-t border-border')}>
            <span className="text-text">{label}</span>
            <span className="font-mono text-base text-text tabular-nums">{value}</span>
        </div>
    );
}

function Eyebrow({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
    return <div className="flex items-baseline justify-between px-4 pt-[18px] pb-1.5"><span className="eyebrow">{children}</span>{action}</div>;
}

function ImportSheet({ p, restore, backedUp, onClose, onBackup, onSmall }: {
    p: MobileImportExportProps; restore: boolean; backedUp: boolean; onClose: () => void; onBackup: () => void; onSmall: (s: Small) => void;
}) {
    const t = useTranslations('mobileImport');
    const ti = useTranslations('importExport');
    const desktop = useIsDesktopApp();
    const phase = p.result ? 'done' : p.loading ? 'running' : p.preview ? 'preview' : 'form';
    const saveLabel = phase === 'form' ? (p.previewing ? ti('previewing') : t('preview'))
        : phase === 'preview' ? (p.checkingTree ? ti('checking_tree') : restore ? t('replace') : t('import'))
        : phase === 'running' ? t('importing') : t('done');
    const onSave = phase === 'form' ? p.onPreview : phase === 'preview' ? p.onImport : phase === 'done' ? onClose : () => {};
    const counts = p.liveCounts;
    const pv = p.preview;
    const stepIndex = p.importStep ? GEDCOM_IMPORT_STEPS.indexOf(p.importStep) : -1;

    return (
        <Sheet open onClose={onClose} title={restore ? t('restore') : t('add_from_file')} size="full"
            onSave={onSave} saveLabel={saveLabel} saveWhenClean
            saveDisabled={(phase === 'form' && (!p.file || p.previewing)) || phase === 'running' || p.checkingTree}>
            <div className="-mx-4 -mt-3">
                {p.error && <p role="alert" className="m-0 px-4 py-2.5 text-sm bg-error-bg text-error border-b border-border">{p.error}</p>}
                {phase === 'form' && (
                    <>
                        {restore && (
                            <>
                                <Eyebrow>{t('step_backup')}</Eyebrow>
                                <p className="m-0 px-4 pb-2.5 text-sm leading-normal text-text-secondary">
                                    {t('restore_lede', { tree: p.treeName, counts: counts ? t('tree_counts', { people: counts.people, families: counts.families }) : t('everything') })}
                                </p>
                                {backedUp ? (
                                    <MobileRow icon={<Check />} label={t('backup_downloaded')} />
                                ) : (
                                    <MobileRow icon={p.exportBusy ? <Loader2 className="animate-spin" /> : <Download />} label={p.exportBusy ? t('preparing_backup') : t('download_backup_now')}
                                        sub={t('backup_sub')} disabled={p.exportBusy} onClick={onBackup} />
                                )}
                                <Eyebrow>{t('step_file')}</Eyebrow>
                            </>
                        )}
                        {!restore && <Eyebrow>{t('the_file')}</Eyebrow>}
                        <FileRow file={p.file} accept=".ged,.zip" label={t('choose_file')} sub={t('choose_file_sub')} onFile={p.onFile} />
                        {restore && !backedUp && p.file && <p className="m-0 px-4 pt-1 pb-3 text-meta leading-snug text-text-muted">{t('no_backup_yet')}</p>}
                        {!restore && (
                            <p className="m-0 px-4 pt-1 pb-3 text-meta leading-snug text-text-muted">
                                {p.treeEmpty ? t('empty_all_in', { tree: p.treeName }) : t('merge_skips')}
                            </p>
                        )}
                        <MobileRow divided icon={<CircleHelp />} end="chevron" label={t('zip_title')} sub={t('zip_sub')} onClick={() => onSmall('zip')} />
                    </>
                )}

                {phase === 'preview' && pv && (
                    <>
                        <Eyebrow action={<button type="button" onClick={p.onBackToForm} className="relative text-sm font-medium text-text cursor-pointer before:absolute before:-inset-x-3 before:-inset-y-3.5 before:content-[''] focus-ring">{t('change')}</button>}>
                            {restore ? t('check_replace') : t('check_import')}
                        </Eyebrow>
                        <p className="m-0 px-4 pb-2.5 text-sm leading-normal text-text-secondary">
                            {p.treeEmpty ? t('preview_empty', { tree: p.treeName })
                                : counts ? t(restore ? 'preview_replaces' : 'preview_adds', { tree: p.treeName, counts: t('tree_counts', { people: counts.people, families: counts.families }) }) : null}
                        </p>
                        <div className="flex gap-1.5 px-4 pb-1.5">
                            <span className="inline-flex items-center gap-1 rounded-full bg-success-bg px-2.5 py-[3px] text-xs font-semibold text-success"><Check className="w-3 h-3" aria-hidden="true" />{ti('validated')}</span>
                        </div>
                        <Kv first label={ti('preview_people')} value={pv.toImport.peopleCount} />
                        <Kv label={ti('preview_families')} value={pv.toImport.familiesCount} />
                        <Kv label={ti('preview_children')} value={pv.toImport.childrenCount} />
                        <Kv label={ti('preview_media')} value={pv.toImport.mediaCount} />
                        <Kv label={ti('preview_sources')} value={pv.toImport.sourcesCount} />
                        <Kv label={ti('preview_citations')} value={pv.toImport.citationsCount} />
                        {p.previewSidecars && (
                            <p className="m-0 px-4 pt-1 pb-3 text-meta text-text-muted">
                                {p.previewSidecars.length > 0 ? ti('preview_sidecars', { files: p.previewSidecars.join(', ') }) : ti('preview_sidecars_none')}
                            </p>
                        )}
                        {DATA_MODE === 'local' && pv.toImport.peopleCount >= 1000 && <p className="m-0 px-4 pb-3 text-meta text-text-muted">{ti(desktop ? 'import_browser_note_desktop' : 'import_browser_note')}</p>}
                        {pv.skipped.length > 0 && (
                            <MobileRow divided icon={<AlertTriangle />} end="chevron" label={t('skipped_n', { count: pv.skipped.length })} sub={t('skipped_sub')} onClick={() => onSmall('skipped')} />
                        )}
                    </>
                )}

                {phase === 'running' && (
                    <>
                        <Eyebrow>{t('importing_into', { tree: p.treeName })}</Eyebrow>
                        <div className="px-4">
                            <ImportProgress
                                label={p.importProgress ? ti('uploading_media') : p.importStep ? ti(`import_step_${p.importStep}`) : ti('importing')}
                                current={p.importProgress?.current ?? (stepIndex >= 0 ? stepIndex + 1 : undefined)}
                                total={p.importProgress?.total ?? (stepIndex >= 0 ? GEDCOM_IMPORT_STEPS.length : undefined)}
                            />
                        </div>
                        <p className="m-0 px-4 pt-2 pb-3 text-meta leading-snug text-text-muted">{t('keep_open')}</p>
                    </>
                )}

                {phase === 'done' && (
                    <>
                        <div className="px-4 pt-4">
                            <MediaImportRecovery
                                treeId={p.activeTreeId}
                                initialTreeId={p.recoverySeed?.treeId}
                                initialItems={p.recoverySeed?.treeId === p.activeTreeId ? p.recoverySeed.items : undefined}
                                initialArchive={p.recoverySeed?.treeId === p.activeTreeId ? p.recoverySeed.archive : null}
                                result={p.result}
                            />
                        </div>
                        <div className="px-4 pt-3 empty:hidden">
                            <ImportReport datesToCheck={p.checksCount} duplicates={p.duplicatesCount} />
                        </div>
                        {/* The result panel above already offers View people and View families. */}
                        <div className="h-4" aria-hidden="true" />
                    </>
                )}
            </div>
        </Sheet>
    );
}

function SpreadsheetSheet({ p, onClose, onSmall }: { p: MobileImportExportProps; onClose: () => void; onSmall: (s: Small) => void }) {
    const t = useTranslations('mobileImport');
    const ts = useTranslations('spreadsheetImport');
    const x = p.xlsx;
    const phase = x.phase === 'done' ? 'done' : x.phase === 'confirming' ? 'running' : x.phase === 'preview' ? 'preview' : 'form';
    const saveLabel = phase === 'form' ? (x.phase === 'previewing' ? ts('previewing') : t('preview')) : phase === 'preview' ? t('import') : phase === 'running' ? t('importing') : t('done');
    const onSave = phase === 'form' ? x.onPreview : phase === 'preview' ? x.onConfirm : phase === 'done' ? onClose : () => {};
    return (
        <Sheet open onClose={onClose} title={t('add_from_spreadsheet')} size="full" onSave={onSave} saveLabel={saveLabel} saveWhenClean
            saveDisabled={(phase === 'form' && (!x.file || x.phase === 'previewing')) || phase === 'running'}>
            <div className="-mx-4 -mt-3">
                {x.error && <p role="alert" className="m-0 px-4 py-2.5 text-sm bg-error-bg text-error border-b border-border whitespace-pre-line">{x.error}</p>}
                {phase === 'form' && (
                    <>
                        <Eyebrow>{t('step_template')}</Eyebrow>
                        <MobileRow icon={<Download />} label={ts('download_template')} sub={t('template_sub')}
                            onClick={() => { window.location.href = `/api/import/spreadsheet/template?dateFormat=${x.dateFormat}`; }} />
                        <p className="m-0 px-4 pt-1 pb-3 text-meta leading-snug text-text-muted">
                            {ts('date_format_note', { format: x.dateFormat === 'DMY' ? ts('format_dmy') : ts('format_mdy') })}
                        </p>
                        <Eyebrow>{t('step_filled')}</Eyebrow>
                        <FileRow file={x.file} accept=".xlsx" label={t('choose_filled')} sub={t('choose_filled_sub')} onFile={x.onFile} />
                        <MobileRow divided icon={<CircleHelp />} end="chevron" label={t('xl_help')} sub={t('xl_help_sub')} onClick={() => onSmall('xlhelp')} />
                    </>
                )}
                {phase === 'preview' && x.dryRun && (
                    <>
                        <Eyebrow>{ts('preview_title')}</Eyebrow>
                        <Kv first label={t('people')} value={x.dryRun.toImport.peopleCount} />
                        <Kv label={t('families')} value={x.dryRun.toImport.familiesCount} />
                        <Kv label={t('children_linked')} value={x.dryRun.toImport.childrenCount} />
                        {x.dryRun.skipped.length > 0 && (
                            <>
                                <Eyebrow>{ts('preview_skipped_title', { count: x.dryRun.skipped.length })}</Eyebrow>
                                <p className="m-0 px-4 pb-2 text-sm text-text-secondary">{ts('preview_skipped_desc')}</p>
                                {x.dryRun.skipped.slice(0, 50).map((s, i) => <Kv key={i} first={i === 0} label={s.identifier} value={<span className="text-meta text-text-muted font-sans">{s.reason}</span>} />)}
                                <MobileRow divided icon={<Download />} label={ts('download_log')} sub=".csv" onClick={() => p.onSkipLog(x.dryRun!.skipped)} />
                            </>
                        )}
                    </>
                )}
                {phase === 'running' && (
                    <p role="status" className="m-0 flex items-center gap-3 px-4 py-6 text-base text-text-muted"><Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />{ts('confirming')}</p>
                )}
                {phase === 'done' && x.result && (
                    <>
                        <div className="grid gap-1.5 justify-items-start px-4 pt-5 pb-3">
                            <span aria-hidden="true" className="grid place-items-center w-10 h-10 rounded-full bg-success-bg text-success"><Check className="w-5 h-5" /></span>
                            <b className="serif font-semibold text-xl text-text">{ts('success_title')}</b>
                        </div>
                        <Kv first label={ts('success_people')} value={x.result.peopleImported} />
                        <Kv label={ts('success_families')} value={x.result.familiesImported} />
                        <Kv label={ts('success_children')} value={x.result.childrenLinked} />
                        {x.result.skipped.length > 0 && <Kv label={ts('success_skipped')} value={x.result.skipped.length} />}
                        <Eyebrow>{t('next_steps')}</Eyebrow>
                        <MobileRow href="/people" icon={<Users />} end="leave" label={t('view_people')} />
                        {x.result.skipped.length > 0 && <MobileRow divided icon={<Download />} label={ts('download_log')} sub=".csv" onClick={() => p.onSkipLog(x.result!.skipped)} />}
                    </>
                )}
            </div>
        </Sheet>
    );
}

function SmallSheets({ p, which, onClose, onPhotos }: { p: MobileImportExportProps; which: Small | null; onClose: () => void; onPhotos: () => void }) {
    const t = useTranslations('mobileImport');
    const ti = useTranslations('importExport');
    const zipTree = (
        <pre className="m-0 mx-4 mb-3 overflow-x-auto rounded-[10px] bg-surface px-3 py-2.5 font-mono text-xs leading-relaxed text-text-secondary">
            {`your_archive.zip
├── family_tree.ged   (required)
├── cases.json
├── media.json
├── sources.json
├── places.json
└── media/
    ├── photo1.jpg
    └── photo2.png`}
        </pre>
    );
    return (
        <>
            <Sheet open={which === 'skipped'} onClose={onClose} title={t('skipped_title')}>
                <div className="-mx-4 -mt-3">
                    {(p.preview?.skipped ?? []).slice(0, 100).map((s, i) => (
                        <div key={i} className={cx('grid gap-0.5 px-4 py-2.5', i > 0 && 'border-t border-border')}>
                            <span className="text-base text-text">{s.type} {s.identifier}</span>
                            <span className="text-meta text-text-muted">{s.reason}</span>
                        </div>
                    ))}
                    {p.preview && <MobileRow divided icon={<Download />} label={ti('download_skip_log')} sub=".csv" onClick={() => p.onSkipLog(p.preview!.skipped)} />}
                </div>
            </Sheet>
            <Sheet open={which === 'help'} onClose={onClose} title={t('about_files')}>
                <div className="-mx-4 -mt-3 pb-2">
                    <Eyebrow>{ti('help_version_title')}</Eyebrow><p className="m-0 px-4 text-sm leading-normal text-text-secondary">{ti('help_version')}</p>
                    <Eyebrow>{ti('help_size_title')}</Eyebrow><p className="m-0 px-4 text-sm leading-normal text-text-secondary">{ti('help_size')}</p>
                    <Eyebrow>{ti('help_safety_title')}</Eyebrow><p className="m-0 px-4 text-sm leading-normal text-text-secondary">{ti('help_safety')}</p>
                    <Eyebrow>{ti('help_merge_title')}</Eyebrow><p className="m-0 px-4 text-sm leading-normal text-text-secondary">{ti('help_merge')}</p>
                    <Eyebrow>{ti('zip_structure')}</Eyebrow>{zipTree}
                </div>
            </Sheet>
            <Sheet open={which === 'zip'} onClose={onClose} title={t('zip_title')}>
                <div className="-mx-4 -mt-3 pb-2">
                    <p className="m-0 px-4 pt-3 pb-2.5 text-sm leading-normal text-text-secondary">{ti('zip_desc')}</p>
                    {zipTree}
                    <p className="m-0 px-4 text-meta text-text-muted">{ti('import_compression_note')}</p>
                </div>
            </Sheet>
            <Sheet open={which === 'xlhelp'} onClose={onClose} title={t('xl_help')}>
                <div className="-mx-4 -mt-3">
                    {(['xl_help_rowid', 'xl_help_dropdowns', 'xl_help_duplicates'] as const).map((k, i) => (
                        <p key={k} className={cx('m-0 px-4 py-3 text-sm leading-normal text-text-secondary', i > 0 && 'border-t border-border')}>{t(k)}</p>
                    ))}
                </div>
            </Sheet>
            <Sheet open={p.preflight != null} onClose={p.onPreflightClose} title={t('preflight_title', { count: p.preflight?.omittedTotal ?? 0 })}>
                <div className="-mx-4 -mt-3">
                    <p className="m-0 px-4 pt-3 pb-2.5 text-sm leading-normal text-text-secondary">{ti('media_export_blocked_description')}</p>
                    <MobileRow icon={<ArrowUpRight />} end="leave" label={t('finish_photos')} sub={t('finish_photos_sub')} onClick={() => { p.onPreflightClose(); onPhotos(); }} />
                    <MobileRow divided icon={<Download />} label={t('download_without')} sub={t('download_without_sub')} disabled={p.exportBusy} onClick={p.onExportOmit} />
                </div>
            </Sheet>
        </>
    );
}
