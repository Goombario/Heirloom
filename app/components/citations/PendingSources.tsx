'use client';

import { useTranslations } from 'next-intl';
import type { PendingCitation } from '@/app/components/AttachSourceSidebar';
import { citeClass, cx } from '@/app/components/ui';
import { X } from '@/lib/icons';

/** The queued source's title: a picked source, or one to be created on save. */
function pendingSourceTitle(p: PendingCitation): string | null {
    return p.sourceTitle ?? p.newSource?.Title ?? null;
}

/**
 * Sources queued on a fact that has no row yet (#192): the Add an event composer
 * collects them and writes the citations once the event is created. Each one can
 * be taken off again before saving. `pins` sits inline in the desktop panel's
 * Sources row; `rows` lists them in a phone sheet.
 */
export function PendingSources({ pending, onRemove, look }: {
    pending: readonly PendingCitation[];
    onRemove: (index: number) => void;
    look: 'pins' | 'rows';
}) {
    const t = useTranslations('common');
    if (pending.length === 0) return null;
    return (
        <ul className={cx('m-0 p-0 list-none', look === 'pins' ? 'contents' : 'grid')} aria-label={t('pending_sources')}>
            {pending.map((p, i) => {
                const title = pendingSourceTitle(p) || t('pending_source_untitled');
                return (
                    <li key={`${title}-${i}`}
                        className={look === 'pins'
                            ? 'inline-flex items-center gap-1 max-w-full rounded-full border border-border bg-card pl-1 pr-0.5 py-0.5 text-meta text-text'
                            : 'flex items-center gap-2 px-4 py-1 text-base leading-snug'}>
                        <span className={cx(citeClass({ square: false }), 'shrink-0')} title={t('pending_source')} aria-hidden="true">…</span>
                        <span className="min-w-0 truncate">
                            {title}{p.page ? <span className="text-text-muted"> · {p.page}</span> : null}
                        </span>
                        <button type="button" onClick={() => onRemove(i)}
                            aria-label={t('remove_pending_source', { title })} title={t('remove_pending_source', { title })}
                            className={cx('inline-flex items-center justify-center shrink-0 rounded-full text-text-muted hover:text-text hover:bg-hover-surface focus-ring',
                                look === 'pins' ? 'w-6 h-6' : 'w-11 h-11 -mr-2 ml-auto')}>
                            <X className={look === 'pins' ? 'w-3 h-3' : 'w-4 h-4'} aria-hidden="true" />
                        </button>
                    </li>
                );
            })}
        </ul>
    );
}
