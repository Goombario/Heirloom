'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Banner, Button, buttonClass } from '@/app/components/ui';
import { Check, Download, Loader2 } from '@/lib/icons';
import type { ImportViewProps } from './DesktopImportExport';
import { DropZone, HelpCard, JobShell, TreeCard } from './JobShell';

/**
 * Add from a spreadsheet on desktop (#60): fill in the template, check what it
 * brings and what it skips, then import.
 */
export function SpreadsheetJob({ p, onLeave, onAnother }: { p: ImportViewProps; onLeave: () => void; onAnother: () => void }) {
    const t = useTranslations('importDesktop');
    const tm = useTranslations('mobileImport');
    const ts = useTranslations('spreadsheetImport');
    const x = p.xlsx;
    const phase = x.phase === 'done' ? 'done' : x.phase === 'confirming' ? 'running' : x.phase === 'preview' ? 'preview' : 'form';
    const step = { form: 0, preview: 1, running: 2, done: 3 }[phase];
    const format = x.dateFormat === 'DMY' ? ts('format_dmy') : ts('format_mdy');

    const footer = phase === 'form' ? (
        <>
            <Button variant="outline" onClick={onLeave}>{t('cancel')}</Button>
            <Button onClick={x.onPreview} disabled={!x.file || x.phase === 'previewing'}
                icon={x.phase === 'previewing' ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : undefined}>
                {x.phase === 'previewing' ? ts('previewing') : t('check_file')}
            </Button>
        </>
    ) : phase === 'preview' && x.dryRun ? (
        <>
            <Button variant="outline" onClick={onAnother}>{t('back')}</Button>
            <Button onClick={x.onConfirm}>{t('import_n', { count: x.dryRun.toImport.peopleCount })}</Button>
        </>
    ) : phase === 'running' ? (
        <>
            <span className="text-sm text-text-muted">{t('keep_open')}</span>
            <Button disabled icon={<Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}>{tm('importing')}</Button>
        </>
    ) : (
        <>
            <Button variant="outline" onClick={onAnother}>{t('import_another_sheet')}</Button>
            <span className="flex flex-wrap gap-2">
                <Link href="/families" className={buttonClass({ variant: 'outline' })}>{t('view_families')}</Link>
                <Link href="/people" className={buttonClass()}>{tm('view_people')}</Link>
            </span>
        </>
    );

    const skipped = phase === 'done' ? x.result?.skipped ?? [] : x.dryRun?.skipped ?? [];

    return (
        <JobShell
            title={tm('add_from_spreadsheet')}
            scope={t('scope_add', { tree: p.treeName })}
            steps={[t('step_template'), t('step_check'), t('step_import')]}
            step={step}
            onCrumb={onLeave}
            footer={footer}
            aside={(
                <>
                    <TreeCard treeName={p.treeName} counts={p.liveCounts} empty={p.treeEmpty} />
                    <HelpCard items={[
                        { title: t('help_rowid_title'), body: tm('xl_help_rowid') },
                        { title: t('help_dropdowns_title'), body: tm('xl_help_dropdowns') },
                        { title: t('help_duplicates_title'), body: tm('xl_help_duplicates') },
                    ]} />
                </>
            )}
        >
            {x.error && (
                <Banner tone="error">
                    <p className="font-semibold">{ts('error_label')}</p>
                    <p className="mt-1 whitespace-pre-line">{x.error}</p>
                </Banner>
            )}

            {phase === 'form' && (
                <>
                    <section aria-labelledby="sheet-template" className="grid gap-2">
                        <h2 id="sheet-template" className="m-0 text-base font-semibold text-text">{tm('step_template')}</h2>
                        <p className="m-0 text-sm text-text-secondary">{tm('template_sub')}</p>
                        <Button variant="outline" className="justify-self-start" icon={<Download className="w-4 h-4" aria-hidden="true" />}
                            onClick={() => { window.location.href = `/api/import/spreadsheet/template?dateFormat=${x.dateFormat}`; }}>
                            {t('download_template')}
                        </Button>
                        <p className="m-0 text-sm text-text-muted">
                            {t.rich('date_format', { format, link: (c) => <Link href="/options" className="text-link underline">{c}</Link> })}
                        </p>
                    </section>
                    <section aria-labelledby="sheet-file" className="grid gap-2">
                        <h2 id="sheet-file" className="m-0 text-base font-semibold text-text">{tm('step_filled')}</h2>
                        <DropZone
                            file={x.file}
                            extensions={['.xlsx']}
                            accept=".xlsx"
                            prompt={t('drop_sheet')}
                            kindOf={() => t('kind_xlsx')}
                            wrongType={t('wrong_sheet')}
                            onFile={x.onFile}
                        />
                    </section>
                </>
            )}

            {phase === 'running' && (
                <p role="status" className="m-0 flex items-center gap-3 text-base text-text-muted"><Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />{ts('confirming')}</p>
            )}

            {(phase === 'preview' || phase === 'done') && (
                <>
                    {phase === 'done' && (
                        <div className="flex items-center gap-3">
                            <span aria-hidden="true" className="grid place-items-center w-9 h-9 rounded-full bg-success-bg text-success"><Check className="w-5 h-5" /></span>
                            <h2 className="m-0 title-dialog text-text">{t('people_added', { count: x.result?.peopleImported ?? 0 })}</h2>
                        </div>
                    )}
                    <dl className="m-0 grid grid-cols-3 gap-2">
                        {([
                            [tm('people'), phase === 'done' ? x.result?.peopleImported : x.dryRun?.toImport.peopleCount],
                            [tm('families'), phase === 'done' ? x.result?.familiesImported : x.dryRun?.toImport.familiesCount],
                            [tm('children_linked'), phase === 'done' ? x.result?.childrenLinked : x.dryRun?.toImport.childrenCount],
                        ] as const).map(([label, value]) => (
                            <div key={label} className="rounded-btn border border-border-light bg-card-alt px-3 py-2.5">
                                <dt className="text-meta text-text-muted">{label}</dt>
                                <dd className="m-0 mt-0.5 text-lg font-semibold tabular-nums text-text">{value ?? 0}</dd>
                            </div>
                        ))}
                    </dl>
                    {skipped.length > 0 && (
                        <section aria-labelledby="sheet-skipped" className="grid gap-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <h2 id="sheet-skipped" className="eyebrow m-0">{t('skipped_count', { count: skipped.length })}</h2>
                                <Button variant="ghost" size="sm" icon={<Download className="w-3.5 h-3.5" aria-hidden="true" />} onClick={() => p.onSkipLog(skipped)}>{ts('download_log')}</Button>
                            </div>
                            {phase === 'preview' && <p className="m-0 text-sm text-text-secondary">{ts('preview_skipped_desc')}</p>}
                            <div className="max-h-64 overflow-y-auto scroll-area rounded-card border border-border-light">
                                <table className="w-full border-collapse text-sm">
                                    <thead>
                                        <tr className="text-left text-meta text-text-muted">
                                            <th scope="col" className="px-3 py-2 font-medium">{t('col_record')}</th>
                                            <th scope="col" className="px-3 py-2 font-medium">{t('col_why')}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {skipped.slice(0, 200).map((s, i) => (
                                            <tr key={i} className="border-t border-border-light">
                                                <td className="px-3 py-2 text-text">{s.identifier}</td>
                                                <td className="px-3 py-2 text-text-secondary">{s.reason}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </section>
                    )}
                </>
            )}
        </JobShell>
    );
}
