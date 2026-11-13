'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Pagination, cx } from '@/app/components/ui';
import type { DataCheckKind } from '@/lib/data-checks/rules';
import type { DataCheckEntry } from '@/lib/data/types';
import { entryYear, personName, type KindGroup } from './model';
import type { useDataCheckText } from './useDataCheckText';

interface DataCheckListProps {
    groups: KindGroup[];
    selectedId: string | null;
    hrefFor: (entryId: string) => string;
    /** Called as an entry is opened, so the detail heading takes focus. */
    onOpen: (entryId: string) => void;
    page: number;
    pages: number;
    onPage: (page: number) => void;
    text: ReturnType<typeof useDataCheckText>;
}

/**
 * The desktop Data checks list (#831, locked list-pages board): grouped by kind
 * (Impossible, Unlikely, Can't be checked) under small uppercase headers with
 * counts, one entry per person, 25 to a page. A row is the kind's mark, the
 * person's serif name over the check's summary, and the year in question. Each
 * entry is a link, so Enter opens it and the browser's Back returns to the one before.
 */
export function DataCheckList({ groups, selectedId, hrefFor, onOpen, page, pages, onPage, text }: DataCheckListProps) {
    const t = useTranslations('dataChecks');
    const tCommon = useTranslations('common');
    return (
        <nav aria-label={t('entries_label')} className="flex flex-col h-full">
            <div className="flex-1">
                {groups.map((g) => (
                    <section key={g.kind} aria-labelledby={`dc-group-${g.kind}`}>
                        <h2 id={`dc-group-${g.kind}`}
                            className="flex justify-between gap-2 px-4 pt-3 pb-1.5 text-xs font-semibold uppercase tracking-[0.07em] text-text-muted bg-card-alt border-t border-border first:border-t-0">
                            <span>{t(`kind_${g.kind}`)}</span>
                            <span className="tabular-nums">{g.total}</span>
                        </h2>
                        <ul>
                            {g.entries.map((e) => (
                                <li key={e.id}>
                                    <EntryLink entry={e} selected={e.id === selectedId} href={hrefFor(e.id)} onOpen={onOpen} text={text} />
                                </li>
                            ))}
                        </ul>
                    </section>
                ))}
            </div>
            <div className="border-t border-border px-4 pb-3 empty:hidden">
                <Pagination current={page} total={pages} onPrev={() => onPage(page - 1)} onNext={() => onPage(page + 1)}
                    prevLabel={tCommon('previous')} nextLabel={tCommon('next')}
                    positionLabel={tCommon('page_of', { current: page, total: pages })} />
            </div>
        </nav>
    );
}

/** The kind's mark: impossible a filled dot, unlikely an orange ring, can't be checked a dashed ring. */
export function KindMark({ kind }: { kind: DataCheckKind }) {
    return (
        <span aria-hidden="true" className={cx(
            'inline-block w-2.5 h-2.5 rounded-full shrink-0 box-border',
            kind === 'impossible' && 'bg-error',
            kind === 'unlikely' && 'border-2 border-warning-text',
            kind === 'unreadable' && 'border-2 border-dashed border-text-muted',
        )} />
    );
}

function EntryLink({ entry, selected, href, onOpen, text }: {
    entry: DataCheckEntry; selected: boolean; href: string; onOpen: (entryId: string) => void;
    text: ReturnType<typeof useDataCheckText>;
}) {
    const p = text.byId.get(entry.personId);
    const name = personName(p, text.unknown);
    const year = entryYear(entry);
    return (
        <Link href={href} onClick={() => onOpen(entry.id)} aria-current={selected ? 'true' : undefined}
            className={cx(
                'grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-[11px] border-t border-border-light text-sm focus-ring-inset hover:bg-hover-surface',
                selected && 'bg-surface-2 shadow-[inset_3px_0_0_var(--color-hero-bg)]',
            )}>
            <KindMark kind={entry.kind} />
            <span className="min-w-0 grid gap-px">
                <span className="serif text-base font-semibold leading-tight text-text truncate">{name}</span>
                <span className="text-meta text-text-secondary truncate">{text.summary(entry)}</span>
            </span>
            <span className="font-mono text-meta text-text-muted tabular-nums">{year ?? '—'}</span>
        </Link>
    );
}
