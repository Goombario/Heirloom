'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Button, Card, CoverBand, IconTile, PageShell, SectionHeader, cx } from '@/app/components/ui';
import { ChevronRight, CircleHelp, Download, GitMerge, LayoutGrid, Loader2, Lock, RotateCcw, Share2 } from '@/lib/icons';
import MediaImportRecovery from '../MediaImportRecovery';
import MediaExportPreflightDialog from '../MediaExportPreflightDialog';
import type { ImportViewProps, Job } from './DesktopImportExport';
import { useLastBackup } from './lastBackup';

/**
 * The desktop hub (#60): the Tools band with the tree's name and counts, then
 * Back up, Bring people in and Start again, and the Help strip. An empty tree has
 * nothing to back up or replace, so Add from a file leads; a viewer can only back up.
 */
export function ImportHub({ p, recoveryRef, canImport, canReplace, onJob }: {
    p: ImportViewProps;
    recoveryRef: React.RefObject<HTMLDivElement | null>;
    canImport: boolean;
    canReplace: boolean;
    onJob: (job: Job) => void;
}) {
    const t = useTranslations('importDesktop');
    const tm = useTranslations('mobileImport');
    const tn = useTranslations('nav');
    const ti = useTranslations('importExport');
    const format = useFormatter();
    const [helpOpen, setHelpOpen] = useState(false);
    const [lastBackup, markBackup] = useLastBackup(p.activeTreeId);
    const counts = p.liveCounts;
    const empty = p.treeEmpty === true;
    const countsLine = counts ? tm('tree_counts', { people: counts.people, families: counts.families }) : null;

    const backUp = async () => { if (await p.onExport(true)) markBackup(); };

    return (
        <PageShell>
            <div className="mb-4">
                <CoverBand
                    variant="short"
                    eyebrow={tn('tools')}
                    title={t('title')}
                    meta={<>{p.treeName}{(empty || countsLine) && <> · <span className="tabular-nums">{empty ? tm('no_people_yet') : countsLine}</span></>}</>}
                />
            </div>

            {/* Photos still to finish from an earlier import: the real panel renders nothing without any. */}
            <div ref={recoveryRef} tabIndex={-1} role="region" aria-label={ti('media_recovery_title')} className="mb-4 empty:hidden focus-ring">
                <MediaImportRecovery treeId={p.activeTreeId} />
            </div>

            <div className={cx('grid gap-4 items-start', canReplace && !empty ? 'lg:grid-cols-3' : 'lg:grid-cols-2')}>
                <Panel title={t('back_up')} line={empty ? t('nothing_to_back_up') : t('back_up_line')} muted={empty}>
                    <div className="grid gap-1.5 justify-items-start">
                        <Button
                            variant={empty ? 'outline' : 'primary'}
                            disabled={empty || p.exportBusy}
                            aria-busy={p.exportBusy}
                            onClick={() => { void backUp(); }}
                            icon={p.exportBusy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Download className="w-4 h-4" aria-hidden="true" />}
                        >
                            {p.exportBusy ? t('preparing') : tm('download_backup')}
                        </Button>
                        <span className="text-meta text-text-muted" aria-live="polite">
                            {p.exportBusy && (counts?.media ?? 0) > 0
                                ? t('zipping', { count: counts!.media })
                                : lastBackup != null && !empty
                                    ? t('last_backup', { date: format.dateTime(lastBackup, { dateStyle: 'medium' }) })
                                    : empty ? null : t('no_backup_here')}
                        </span>
                    </div>
                    <JobRow
                        icon={<Share2 className="w-[18px] h-[18px]" />}
                        label={t('export_gedcom')}
                        sub={t('export_gedcom_sub')}
                        disabled={empty || p.exportBusy}
                        onClick={() => { void p.onExport(false); }}
                        end={<Download className="w-4 h-4 shrink-0 text-text-muted" aria-hidden="true" />}
                    />
                    {p.exportError && <p role="alert" className="m-0 text-sm text-error">{p.exportError}</p>}
                </Panel>

                <Panel title={tm('bring_in')} line={canImport ? t('bring_in_line') : t('needs_edit')} muted={!canImport}>
                    {canImport ? (
                        <>
                            {empty && (
                                <Button onClick={() => onJob('add')} icon={<GitMerge className="w-4 h-4" aria-hidden="true" />} className="justify-self-start">
                                    {tm('add_from_file')}
                                </Button>
                            )}
                            {!empty && <JobRow icon={<GitMerge className="w-[18px] h-[18px]" />} label={tm('add_from_file')} sub={t('add_file_sub')} onClick={() => onJob('add')} />}
                            <JobRow icon={<LayoutGrid className="w-[18px] h-[18px]" />} label={tm('add_from_spreadsheet')} sub={t('add_sheet_sub')} onClick={() => onJob('spreadsheet')} />
                        </>
                    ) : (
                        <p className="m-0 flex items-center gap-2 text-sm text-text-muted">
                            <Lock className="w-4 h-4 shrink-0" aria-hidden="true" />{t('needs_edit_line')}
                        </p>
                    )}
                </Panel>

                {canReplace && !empty && (
                    <Panel title={tm('start_again')} line={countsLine ? t('start_again_line', { counts: countsLine }) : t('start_again_line_plain')}>
                        <JobRow danger icon={<RotateCcw className="w-[18px] h-[18px]" />} label={tm('restore')} sub={t('restore_sub')} onClick={() => onJob('restore')} />
                    </Panel>
                )}
            </div>

            <Card pad={false} className="mt-4">
                <div className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <CircleHelp className="w-[18px] h-[18px] text-text-muted shrink-0" aria-hidden="true" />
                    <span className="text-sm font-semibold text-text">{tm('about_files')}</span>
                    <span className="text-sm text-text-muted flex-1 min-w-0">{t('help_line')}</span>
                    <Button variant="ghost" size="sm" aria-expanded={helpOpen} aria-controls="import-help" onClick={() => setHelpOpen((v) => !v)}>
                        {helpOpen ? t('read_less') : t('read_more')}
                    </Button>
                </div>
                <dl id="import-help" hidden={!helpOpen} className="m-0 grid gap-x-8 gap-y-3 border-t border-border-light px-5 py-4 md:grid-cols-2 text-sm">
                    {([['help_version_title', 'help_version'], ['help_backup_title', 'help_backup'], ['help_size_title', 'help_size'], ['help_merge_title', 'help_merge']] as const).map(([title, body]) => (
                        <div key={title}>
                            <dt className="font-medium text-text">{t(title)}</dt>
                            <dd className="m-0 mt-1 text-text-secondary leading-normal">{t(body)}</dd>
                        </div>
                    ))}
                </dl>
            </Card>

            {p.preflight && (
                <MediaExportPreflightDialog
                    preflight={p.preflight}
                    onReview={p.onPreflightReview}
                    onCancel={p.onPreflightClose}
                    onExportWithoutUnresolved={p.onExportOmit}
                    busy={p.exportBusy}
                />
            )}
        </PageShell>
    );
}

function Panel({ title, line, muted = false, children }: { title: string; line: string; muted?: boolean; children: React.ReactNode }) {
    return (
        <Card className="grid gap-3 p-5" pad={false}>
            <div>
                <SectionHeader level="rail" rule={false} title={title} className={cx(muted && 'opacity-70')} />
                <p className="m-0 text-sm leading-normal text-text-secondary">{line}</p>
            </div>
            {children}
        </Card>
    );
}

/** A job: an outlined icon tile, the label and what it takes, and a chevron. */
function JobRow({ icon, label, sub, onClick, disabled = false, danger = false, end }: {
    icon: React.ReactNode;
    label: string;
    sub: string;
    onClick: () => void;
    disabled?: boolean;
    danger?: boolean;
    /** The trailing mark: a chevron for a job page, or what an action does. */
    end?: React.ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className={cx('rounded-card', 'flex w-full items-center gap-3 border border-border bg-card px-3 py-2.5 text-left cursor-pointer enabled:hover:bg-hover-surface focus-ring disabled:opacity-50 disabled:cursor-not-allowed')}
        >
            <IconTile>{icon}</IconTile>
            <span className="grid min-w-0 flex-1">
                <span className={cx('text-sm font-semibold', danger ? 'text-error' : 'text-text')}>{label}</span>
                <span className="text-meta text-text-muted">{sub}</span>
            </span>
            {end ?? <ChevronRight className="w-4 h-4 shrink-0 text-text-muted" aria-hidden="true" />}
        </button>
    );
}
