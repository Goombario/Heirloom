'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Pagination, cx } from '@/app/components/ui';
import PersonAvatar from '@/app/components/PersonAvatar';
import { ChevronRight } from '@/lib/icons';
import { getInitials } from '@/lib/utils/initials';
import type { DataCheckEntry } from '@/lib/data/types';
import { personName, type EntryGroup } from './model';
import type { useDataCheckText } from './useDataCheckText';

interface DataCheckListProps {
    groups: EntryGroup[];
    selectedId: string | null;
    hrefFor: (entryId: string) => string;
    /** Called as an entry is opened, so the detail heading takes focus. */
    onOpen: (entryId: string) => void;
    page: number;
    pages: number;
    onPage: (page: number) => void;
    text: ReturnType<typeof useDataCheckText>;
    treeId: number | null;
}

/**
 * The Data checks list (#831): grouped by check, impossible first, one entry
 * per person, 25 to a page. Each entry is a link, so Enter opens it and the
 * browser's Back returns to the one before.
 */
export function DataCheckList({ groups, selectedId, hrefFor, onOpen, page, pages, onPage, text, treeId }: DataCheckListProps) {
    const t = useTranslations('dataChecks');
    const tCommon = useTranslations('common');
    return (
        <nav aria-label={t('entries_label')} className="flex flex-col h-full">
            <div className="flex-1">
                {groups.map((g) => (
                    <section key={g.rule} aria-labelledby={`dc-group-${g.rule}`}>
                        <h2 id={`dc-group-${g.rule}`}
                            className="flex justify-between gap-2 px-4 pt-3 pb-1.5 text-meta font-semibold text-text-secondary bg-card-alt border-t border-border first:border-t-0">
                            <span>{text.ruleName(g.rule)}</span>
                            <span className="font-mono font-normal text-text-muted">{g.total}</span>
                        </h2>
                        <ul>
                            {g.entries.map((e) => (
                                <li key={e.id}>
                                    <EntryLink entry={e} selected={e.id === selectedId} href={hrefFor(e.id)}
                                        onOpen={onOpen} text={text} treeId={treeId} />
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

function EntryLink({ entry, selected, href, onOpen, text, treeId }: {
    entry: DataCheckEntry; selected: boolean; href: string; onOpen: (entryId: string) => void;
    text: ReturnType<typeof useDataCheckText>; treeId: number | null;
}) {
    const p = text.byId.get(entry.personId);
    const name = personName(p, text.unknown);
    return (
        <Link href={href} onClick={() => onOpen(entry.id)} aria-current={selected ? 'true' : undefined}
            className={cx(
                'grid grid-cols-[30px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 border-t border-border-light text-sm focus-ring-inset hover:bg-hover-surface',
                // The wide layout always shows one entry; phones open it full screen instead.
                selected && 'md:bg-surface-2 md:shadow-[inset_3px_0_0_var(--color-text)]',
            )}>
            <PersonAvatar as="span" size={30} sex={p?.Sex} name={name} initials={getInitials(p?.FirstName, p?.LastName)} treeId={treeId} />
            <span className="min-w-0">
                <span className="block font-semibold text-text">{name}</span>
                <span className="block text-meta text-text-muted md:truncate">{text.summary(entry)}</span>
            </span>
            <ChevronRight className="w-4 h-4 text-text-muted md:hidden" aria-hidden="true" />
        </Link>
    );
}
