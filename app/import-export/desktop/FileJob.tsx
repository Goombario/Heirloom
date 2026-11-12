'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { DATA_MODE } from '@/lib/data';
import { GEDCOM_IMPORT_STEPS } from '@/lib/gedcom/import-steps';
import { Banner, Button, buttonClass, cx } from '@/app/components/ui';
import ConfirmDialog from '@/app/components/ConfirmDialog';
import { AlertTriangle, Check, Circle, Download, Loader2 } from '@/lib/icons';
import ImportProgress from '../ImportProgress';
import MediaImportRecovery from '../MediaImportRecovery';
import { ImportReport } from '../ImportReport';
import type { ImportViewProps } from './DesktopImportExport';
import { DropZone, HelpCard, JobShell, TreeCard } from './JobShell';
import { useLastBackup } from './lastBackup';

/** A browser-build import of this many people takes long enough to warn about (ST-1). */
const LARGE_IMPORT_PEOPLE = 1000;
const SIDECAR_LABEL = { 'cases.json': 'side_cases', 'media.json': 'side_media', 'sources.json': 'side_sources', 'places.json': 'side_places' } as const;

/**
 * Add from a file (the old Merge) and Restore a backup (the old Overwrite) on
 * desktop (#60): choose the file, check what it brings, then import, each step on
 * the job page. Restore asks for a backup of what's here first, compares the tree
 * with the file, and confirms before it replaces anything.
 */
export function FileJob({ p, restore, onLeave }: { p: ImportViewProps; restore: boolean; onLeave: () => void }) {
    const t = useTranslations('importDesktop');
    const tm = useTranslations('mobileImport');
    const ti = useTranslations('importExport');
    const [, markBackup] = useLastBackup(p.activeTreeId);
    const [backedUp, setBackedUp] = useState(false);
    const [showSkipped, setShowSkipped] = useState(false);
    const [importedFrom, setImportedFrom] = useState<string | null>(null);
    const phase = p.result ? 'done' : p.loading ? 'running' : p.preview ? 'preview' : 'form';
    const step = { form: 0, preview: 1, running: 2, done: 3 }[phase];
    const counts = p.liveCounts;
    const countsLine = counts ? tm('tree_counts', { people: counts.people, families: counts.families }) : null;
    const pv = p.preview;

    const backUp = async () => { if (await p.onExport(true)) { markBackup(); setBackedUp(true); } };
    const start = () => { setImportedFrom(p.file?.name ?? null); p.onImport(); };
    const another = () => { p.onStartJob('merge'); setShowSkipped(false); };

    const footer = phase === 'form' ? (
        <>
            <Button variant="outline" onClick={onLeave}>{t('cancel')}</Button>
            <Button onClick={p.onPreview} disabled={!p.file || p.previewing}
                icon={p.previewing ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : undefined}>
                {p.previewing ? ti('previewing') : t('check_file')}
            </Button>
        </>
    ) : phase === 'preview' && pv ? (
        <>
            <Button variant="outline" onClick={p.onBackToForm}>{t('back')}</Button>
            <Button variant={restore ? 'danger' : 'primary'} onClick={start} disabled={p.checkingTree}
                icon={p.checkingTree ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : undefined}>
                {p.checkingTree ? ti('checking_tree') : restore ? tm('replace_tree') : t('import_n', { count: pv.toImport.peopleCount })}
            </Button>
        </>
    ) : phase === 'running' ? (
        <>
            <span className="text-sm text-text-muted">{p.importProgress ? t('photos_note') : t('keep_open')}</span>
            <Button disabled icon={<Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}>{tm('importing')}</Button>
        </>
    ) : (
        <>
            {restore ? <Button variant="outline" onClick={onLeave}>{t('back_to_hub')}</Button> : <Button variant="outline" onClick={another}>{ti('import_another')}</Button>}
            <span className="flex flex-wrap gap-2">
                <Link href="/families" className={buttonClass({ variant: 'outline' })}>{t('view_families')}</Link>
                <Link href="/people" className={buttonClass()}>{tm('view_people')}</Link>
            </span>
        </>
    );

    const stepIndex = p.importStep ? GEDCOM_IMPORT_STEPS.indexOf(p.importStep) : -1;

    return (
        <JobShell
            title={restore ? tm('restore') : tm('add_from_file')}
            scope={restore ? t('scope_replace', { tree: p.treeName }) : t('scope_add', { tree: p.treeName })}
            steps={restore ? [t('step_backup_choose'), t('step_check'), t('step_replace')] : [t('step_choose'), t('step_check'), t('step_import')]}
            step={step}
            onCrumb={onLeave}
            footer={footer}
            aside={(
                <>
                    <TreeCard treeName={p.treeName} counts={counts} empty={p.treeEmpty} />
                    <HelpCard items={[
                        { title: t('help_which_files'), body: t('help_which_files_body') },
                        { title: tm('zip_title'), body: t('help_zip_body') },
                        restore
                            ? { title: t('help_undo_title'), body: t('help_undo_restore') }
                            : { title: t('help_skipped_title'), body: t('help_skipped_body') },
                    ]} />
                </>
            )}
        >
            {p.error && (
                <Banner tone="error">
                    <p className="font-semibold">{ti('error_label')}</p>
                    <p className="mt-1">{p.error}</p>
                </Banner>
            )}

            {phase === 'form' && (
                <>
                    {restore && (
                        <section aria-labelledby="restore-backup" className="grid gap-2">
                            <h2 id="restore-backup" className="m-0 text-base font-semibold text-text">{t('backup_here')}</h2>
                            <p className="m-0 text-sm text-text-secondary">
                                {tm('restore_lede', { tree: p.treeName, counts: countsLine ?? tm('everything') })}
                            </p>
                            {backedUp ? (
                                <p className="m-0 flex items-center gap-2 text-sm font-medium text-success"><Check className="w-4 h-4" aria-hidden="true" />{tm('backup_downloaded')}</p>
                            ) : (
                                <Button className="justify-self-start" onClick={() => { void backUp(); }} disabled={p.exportBusy} aria-busy={p.exportBusy}
                                    icon={p.exportBusy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Download className="w-4 h-4" aria-hidden="true" />}>
                                    {p.exportBusy ? tm('preparing_backup') : tm('download_backup_now')}
                                </Button>
                            )}
                            {p.exportError && <p role="alert" className="m-0 text-sm text-error">{p.exportError}</p>}
                        </section>
                    )}
                    <section aria-labelledby="job-file" className="grid gap-2">
                        <h2 id="job-file" className={cx('m-0 text-base font-semibold text-text', !restore && 'sr-only')}>{restore ? t('file_to_restore') : tm('the_file')}</h2>
                        <DropZone
                            file={p.file}
                            extensions={['.ged', '.zip']}
                            accept=".ged,.zip"
                            prompt={t('drop_file')}
                            kindOf={(f) => (f.name.toLowerCase().endsWith('.zip') ? t('kind_zip') : t('kind_ged'))}
                            wrongType={t('wrong_type')}
                            onFile={p.onFile}
                        />
                        {restore
                            ? !backedUp && p.file && (
                                <p className="m-0 flex items-start gap-2 text-sm text-warning-text"><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />{t('no_backup_warning')}</p>
                            )
                            : <p className="m-0 text-sm text-text-muted">{p.treeEmpty ? tm('empty_all_in', { tree: p.treeName }) : t('merge_note')}</p>}
                    </section>
                </>
            )}

            {phase === 'preview' && pv && (
                <>
                    <div className="grid gap-2">
                        <span className="justify-self-start inline-flex items-center gap-1 rounded-full bg-success-bg px-2.5 py-[3px] text-xs font-semibold text-success">
                            <Check className="w-3 h-3" aria-hidden="true" />{t('file_read')}
                        </span>
                        <p className="m-0 text-sm text-text-secondary">
                            {p.treeEmpty ? tm('preview_empty', { tree: p.treeName })
                                : countsLine ? tm(restore ? 'preview_replaces' : 'preview_adds', { tree: p.treeName, counts: countsLine }) : null}
                        </p>
                    </div>

                    {restore ? (
                        <table className="w-full border-collapse text-sm">
                            <caption className="sr-only">{t('compare_caption')}</caption>
                            <thead>
                                <tr className="text-left text-meta text-text-muted">
                                    <th scope="col" className="py-2 font-medium"><span className="sr-only">{t('record_kind')}</span></th>
                                    <th scope="col" className="py-2 font-medium text-right">{t('in_tree_now')}</th>
                                    <th scope="col" className="py-2 font-medium text-right">{t('in_file')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {([
                                    [ti('preview_people'), counts?.people, pv.toImport.peopleCount],
                                    [ti('preview_families'), counts?.families, pv.toImport.familiesCount],
                                    [ti('preview_media'), counts?.media, pv.toImport.mediaCount],
                                    [ti('preview_sources'), counts?.sources, pv.toImport.sourcesCount],
                                ] as const).map(([label, now, incoming]) => (
                                    <tr key={label} className="border-t border-border-light">
                                        <th scope="row" className="py-2 text-left font-normal text-text">{label}</th>
                                        <td className="py-2 text-right tabular-nums text-text">{now ?? '–'}</td>
                                        <td className="py-2 text-right tabular-nums text-text">{incoming}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    ) : (
                        <section aria-labelledby="coming-in" className="grid gap-2">
                            <h2 id="coming-in" className="eyebrow m-0">{t('coming_in')}</h2>
                            <dl className="m-0 grid grid-cols-3 gap-2">
                                {([
                                    [ti('preview_people'), pv.toImport.peopleCount],
                                    [ti('preview_families'), pv.toImport.familiesCount],
                                    [tm('children_linked'), pv.toImport.childrenCount],
                                    [ti('preview_media'), pv.toImport.mediaCount],
                                    [ti('preview_sources'), pv.toImport.sourcesCount],
                                    [ti('preview_citations'), pv.toImport.citationsCount],
                                ] as const).map(([label, value]) => (
                                    <div key={label} className="rounded-btn border border-border-light bg-card-alt px-3 py-2.5">
                                        <dt className="text-meta text-text-muted">{label}</dt>
                                        <dd className="m-0 mt-0.5 text-lg font-semibold tabular-nums text-text">{value}</dd>
                                    </div>
                                ))}
                            </dl>
                        </section>
                    )}

                    {p.previewSidecars && p.previewSidecars.length > 0 && (
                        <section aria-labelledby="also-in" className="grid gap-1">
                            <h2 id="also-in" className="eyebrow m-0">{t('also_in')}</h2>
                            <p className="m-0 text-sm text-text-secondary">
                                {p.previewSidecars.map((name) => (name in SIDECAR_LABEL ? t(SIDECAR_LABEL[name as keyof typeof SIDECAR_LABEL]) : name)).join(' · ')}
                            </p>
                        </section>
                    )}

                    {(pv.skipped.length > 0 || restore || (DATA_MODE === 'local' && pv.toImport.peopleCount >= LARGE_IMPORT_PEOPLE)) && (
                        <section aria-labelledby="before-import" className="grid gap-2">
                            <h2 id="before-import" className="eyebrow m-0">{restore ? t('before_replace') : t('before_import')}</h2>
                            {restore && (
                                <p className="m-0 flex items-start gap-2 text-sm text-warning-text">
                                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />{t('gone_warning', { tree: p.treeName })}
                                </p>
                            )}
                            {pv.skipped.length > 0 && (
                                <div className="grid gap-2">
                                    <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text">
                                        {tm('skipped_n', { count: pv.skipped.length })}
                                        <Button variant="ghost" size="sm" aria-expanded={showSkipped} onClick={() => setShowSkipped((v) => !v)}>{showSkipped ? t('hide') : t('show')}</Button>
                                        <Button variant="ghost" size="sm" icon={<Download className="w-3.5 h-3.5" aria-hidden="true" />} onClick={() => p.onSkipLog(pv.skipped)} aria-label={ti('download_skip_log')}>.csv</Button>
                                    </p>
                                    {showSkipped && (
                                        <ul className="m-0 p-0 list-none max-h-48 overflow-y-auto scroll-area rounded-card border border-border-light">
                                            {pv.skipped.slice(0, 100).map((s, i) => (
                                                <li key={i} className="grid gap-0.5 px-3 py-2 text-sm border-t border-border-light first:border-t-0">
                                                    <span className="text-text">{s.type} {s.identifier}</span>
                                                    <span className="text-meta text-text-muted">{s.reason}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                            )}
                            {DATA_MODE === 'local' && pv.toImport.peopleCount >= LARGE_IMPORT_PEOPLE && <p className="m-0 text-sm text-text-muted">{ti('import_browser_note')}</p>}
                        </section>
                    )}
                </>
            )}

            {phase === 'running' && (
                <section aria-labelledby="importing" className="grid gap-4">
                    <h2 id="importing" className="m-0 text-base font-semibold text-text">{tm('importing_into', { tree: p.treeName })}</h2>
                    <ImportProgress
                        label={p.importProgress ? ti('uploading_media') : p.importStep ? ti(`import_step_${p.importStep}`) : ti('importing')}
                        current={p.importProgress?.current ?? (stepIndex >= 0 ? stepIndex + 1 : undefined)}
                        total={p.importProgress?.total ?? (stepIndex >= 0 ? GEDCOM_IMPORT_STEPS.length : undefined)}
                    />
                    {(stepIndex >= 0 || p.importProgress) && (
                        <ol className="m-0 p-0 list-none grid gap-1.5" aria-label={t('import_steps')}>
                            {[...GEDCOM_IMPORT_STEPS.map((s, i) => ({ key: s, label: ti(`import_step_${s}`), state: p.importProgress || i < stepIndex ? 'done' : i === stepIndex ? 'current' : 'waiting' })),
                                { key: 'photos', label: ti('uploading_media'), state: p.importProgress ? 'current' : 'waiting' }].map((s) => (
                                <li key={s.key} className={cx('flex items-center gap-2 text-sm', s.state === 'waiting' ? 'text-text-muted' : 'text-text')}>
                                    {s.state === 'done' ? <Check className="w-4 h-4 text-success" aria-hidden="true" />
                                        : s.state === 'current' ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                                            : <Circle className="w-4 h-4" aria-hidden="true" />}
                                    <span className="sr-only">{t(`step_state_${s.state}`)}: </span>
                                    <span className="flex-1">{s.label}</span>
                                    {s.key === 'photos' && p.importProgress && (
                                        <span className="tabular-nums text-text-muted">{t('n_of_total', { current: p.importProgress.current, total: p.importProgress.total })}</span>
                                    )}
                                </li>
                            ))}
                        </ol>
                    )}
                </section>
            )}

            {phase === 'done' && p.result && (
                <>
                    <h2 className="m-0 title-dialog text-text">
                        {restore
                            ? (importedFrom ? t('restored_from', { tree: p.treeName, file: importedFrom }) : t('restored', { tree: p.treeName }))
                            : t('people_added', { count: p.result.peopleCount })}
                    </h2>
                    <MediaImportRecovery
                        treeId={p.activeTreeId}
                        initialTreeId={p.recoverySeed?.treeId}
                        initialItems={p.recoverySeed?.treeId === p.activeTreeId ? p.recoverySeed.items : undefined}
                        initialArchive={p.recoverySeed?.treeId === p.activeTreeId ? p.recoverySeed.archive : null}
                        result={p.result}
                        links={false}
                    />
                    <ImportReport datesToCheck={p.checksCount} duplicates={p.duplicatesCount} />
                    {restore && <p className="m-0 text-sm text-text-muted">{t('restored_note')}</p>}
                </>
            )}

            {restore && (
                <ConfirmDialog
                    open={p.confirmOpen}
                    variant="calm"
                    tone="danger"
                    title={ti('overwrite_confirm_title')}
                    body={p.existingCounts
                        ? ti('overwrite_confirm_body', { tree: p.treeName, counts: p.countsText(p.existingCounts) })
                        : ti('overwrite_confirm_body_no_counts', { tree: p.treeName })}
                    warning={ti('overwrite_confirm_warning')}
                    confirmLabel={tm('replace_tree')}
                    cancelLabel={tm('keep_tree')}
                    busy={p.loading}
                    onConfirm={p.onConfirm}
                    onCancel={p.onCancelConfirm}
                />
            )}
        </JobShell>
    );
}
