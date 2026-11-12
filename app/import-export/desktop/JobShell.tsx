'use client';

import { useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Card, CoverBand, PageShell, SectionHeader, cx } from '@/app/components/ui';
import { Check, ChevronRight, FileText, Upload, X } from '@/lib/icons';
import type { TreeCounts } from '@/lib/data/types';

/**
 * A job page's frame (#60): the band with its "Import and export ›" crumb, the job
 * as the title and its one-line scope; the three-step stepper; the main panel with
 * its footer (Back or Cancel left, the primary right); and the 300px aside with the
 * This tree and Help cards.
 */
export function JobShell({ title, scope, steps, step, onCrumb, footer, aside, children }: {
    title: string;
    scope: string;
    /** The three step names. */
    steps: readonly [string, string, string];
    /** 0-based; 3 means every step is done. */
    step: number;
    onCrumb: () => void;
    footer: React.ReactNode;
    aside: React.ReactNode;
    children: React.ReactNode;
}) {
    const t = useTranslations('importDesktop');
    return (
        <PageShell>
            <div className="mb-4">
                <CoverBand
                    variant="short"
                    eyebrow={(
                        <nav aria-label={t('crumb_label')}>
                            <button type="button" onClick={onCrumb} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 text-inherit uppercase tracking-[inherit] cursor-pointer hover:underline focus-ring rounded-sm">
                                {t('title')}<ChevronRight className="w-3 h-3" aria-hidden="true" />
                            </button>
                        </nav>
                    )}
                    title={title}
                    meta={scope}
                />
            </div>
            <ol className="import-stepper list-none m-0 mb-4 p-0 flex items-center gap-3" aria-label={t('steps_label')}>
                {steps.map((name, i) => {
                    const state = i < step ? 'done' : i === step ? 'current' : 'waiting';
                    return (
                        <li key={name} className="flex items-center gap-3 min-w-0" aria-current={state === 'current' ? 'step' : undefined}>
                            {i > 0 && <span aria-hidden="true" className="h-px w-8 bg-border" />}
                            <span
                                aria-hidden="true"
                                className={cx(
                                    'grid place-items-center w-6 h-6 rounded-full text-xs font-semibold tabular-nums shrink-0',
                                    state === 'waiting' ? 'border border-border text-text-muted bg-card' : 'bg-segment-on text-on-segment',
                                )}
                            >
                                {state === 'done' ? <Check className="w-3.5 h-3.5" /> : i + 1}
                            </span>
                            <span className={cx('text-sm truncate', state === 'waiting' ? 'text-text-muted' : 'text-text font-medium')}>
                                <span className="sr-only">{t(`step_state_${state}`)}: </span>{name}
                            </span>
                        </li>
                    );
                })}
            </ol>
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] items-start">
                <Card pad={false}>
                    <div className="p-6 grid gap-5">{children}</div>
                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-light px-6 py-4">{footer}</div>
                </Card>
                <aside className="grid gap-4">{aside}</aside>
            </div>
        </PageShell>
    );
}

/** The aside's This tree card: the tree's name and counts. */
export function TreeCard({ treeName, counts, empty }: { treeName: string; counts: TreeCounts | null; empty: boolean | null }) {
    const t = useTranslations('importDesktop');
    const tm = useTranslations('mobileImport');
    return (
        <Card>
            <SectionHeader level="rail" rule={false} title={t('this_tree')} />
            <p className="m-0 serif text-md font-semibold text-text">{treeName}</p>
            <p className="m-0 mt-1 text-sm text-text-muted tabular-nums">
                {empty ? tm('no_people_yet') : counts ? tm('tree_counts', { people: counts.people, families: counts.families }) : ' '}
            </p>
            {counts && !empty && (
                <p className="m-0 mt-0.5 text-sm text-text-muted tabular-nums">{t('photos_sources', { photos: counts.media, sources: counts.sources })}</p>
            )}
        </Card>
    );
}

/** The aside's Help card: short answers, each opening in place. */
export function HelpCard({ items }: { items: { title: string; body: string }[] }) {
    const t = useTranslations('importDesktop');
    const [open, setOpen] = useState<number | null>(null);
    const ids = useId();
    return (
        <Card>
            <SectionHeader level="rail" rule={false} title={t('help')} />
            <ul className="m-0 p-0 list-none grid gap-1">
                {items.map((item, i) => (
                    <li key={item.title}>
                        <button
                            type="button"
                            aria-expanded={open === i}
                            aria-controls={`${ids}-${i}`}
                            onClick={() => setOpen(open === i ? null : i)}
                            className="w-full text-left bg-transparent border-0 p-0 py-1 text-sm text-link hover:underline cursor-pointer focus-ring rounded-sm"
                        >
                            {item.title}
                        </button>
                        <p id={`${ids}-${i}`} hidden={open !== i} className="m-0 pb-2 text-sm leading-normal text-text-secondary">{item.body}</p>
                    </li>
                ))}
            </ul>
        </Card>
    );
}

/** A file's name and size in the units a person reads. */
function fileSize(bytes: number): string {
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * The drop zone, or the chosen file as a row with Change and remove. A file whose
 * name doesn't end in one of `extensions` is refused with `wrongType`, and the
 * caller keeps its primary disabled.
 */
export function DropZone({ file, extensions, accept, prompt, kindOf, wrongType, onFile }: {
    file: File | null;
    extensions: readonly string[];
    accept: string;
    prompt: string;
    kindOf: (file: File) => string;
    wrongType: string;
    onFile: (file: File | null) => void;
}) {
    const t = useTranslations('importDesktop');
    const input = useRef<HTMLInputElement>(null);
    const [over, setOver] = useState(false);
    const [refused, setRefused] = useState(false);
    const errorId = useId();
    const take = (next: File | null) => {
        if (next && !extensions.some((ext) => next.name.toLowerCase().endsWith(ext))) {
            setRefused(true);
            onFile(null);
            return;
        }
        setRefused(false);
        onFile(next);
    };
    const pick = () => { if (input.current) { input.current.value = ''; input.current.click(); } };

    return (
        <div className="grid gap-2">
            <input
                ref={input}
                type="file"
                accept={accept}
                className="hidden"
                aria-label={t('choose_file')}
                aria-describedby={refused ? errorId : undefined}
                onChange={(e) => take(e.target.files?.[0] ?? null)}
            />
            {file ? (
                <div className={cx('rounded-card', 'flex items-center gap-3 border border-border bg-card px-4 py-3')}>
                    <span aria-hidden="true" className="grid place-items-center w-9 h-9 shrink-0 rounded-btn bg-success-bg text-success"><FileText className="w-[18px] h-[18px]" /></span>
                    <span className="grid min-w-0 flex-1">
                        <span className="text-base font-medium text-text truncate">{file.name}</span>
                        <span className="text-meta text-text-muted">{fileSize(file.size)} · {kindOf(file)}</span>
                    </span>
                    <Button variant="ghost" size="sm" onClick={pick}>{t('change')}</Button>
                    <Button variant="ghost" size="sm" onClick={() => take(null)} aria-label={t('remove_file', { name: file.name })} icon={<X className="w-4 h-4" aria-hidden="true" />} />
                </div>
            ) : (
                <div
                    onDragOver={(e) => { e.preventDefault(); setOver(true); }}
                    onDragLeave={() => setOver(false)}
                    onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files?.[0] ?? null); }}
                    className={cx(
                        'grid justify-items-center gap-3 rounded-card border border-dashed px-6 py-8 text-center',
                        over ? 'border-focus bg-hover-surface' : refused ? 'border-error' : 'border-border bg-card-alt',
                    )}
                >
                    <Upload className="w-6 h-6 text-text-muted" aria-hidden="true" />
                    <p className="m-0 text-base text-text">{prompt}</p>
                    <Button variant="outline" onClick={pick}>{t('choose_file')}</Button>
                </div>
            )}
            {refused && <p id={errorId} role="alert" className="m-0 text-sm text-error">{wrongType}</p>}
        </div>
    );
}
