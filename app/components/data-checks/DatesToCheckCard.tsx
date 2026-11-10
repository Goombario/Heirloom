'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { SectionHeader } from '@/app/components/ui';
import PersonAvatar from '@/app/components/PersonAvatar';
import { personName } from '@/app/data-checks/model';
import { useDataCheckText } from '@/app/data-checks/useDataCheckText';
import { ChevronRight } from '@/lib/icons';
import { getInitials } from '@/lib/utils/initials';
import type { DataChecksResult, DataChecksSummary } from '@/lib/data/types';

const NO_PEOPLE: DataChecksResult['people'] = [];

/**
 * Home's "Dates to check" card (#834): work that can reach zero. The count,
 * the first three entries in the page's order (impossible first), each with
 * its avatar and one-line summary, then "Review all N ›". Hidden when there's
 * nothing to check, including while it loads. The summary carries only those
 * entries and the count; the page loads the rest (#1270).
 */
export function DatesToCheckCard({ summary, treeId }: { summary: DataChecksSummary | null | undefined; treeId: number | null }) {
    const t = useTranslations('dataChecks');
    const text = useDataCheckText(summary?.top.people ?? NO_PEOPLE);
    const count = summary?.openCount ?? 0;
    if (!summary || count === 0) return null;
    return (
        <section className="card card-pad" aria-labelledby="home-dates-to-check">
            <SectionHeader level="rail" title={t('title_home')} count={count} headingId="home-dates-to-check" />
            <ul className="m-0 p-0 list-none">
                {summary.top.problems.map((entry) => {
                    const p = text.byId.get(entry.personId);
                    const name = personName(p, text.unknown);
                    return (
                        <li key={entry.id}>
                            <Link href={`/data-checks?entry=${encodeURIComponent(entry.id)}`}
                                className="row row-lift gap-2.5 py-2 px-2 -mx-2 no-underline focus-ring border-b border-b-[color:var(--border-light)]">
                                <PersonAvatar as="span" size={28} sex={p?.Sex} name={name} initials={getInitials(p?.FirstName, p?.LastName)} treeId={treeId} />
                                <span className="min-w-0 text-sm">
                                    <span className="block font-semibold text-text truncate">{name}</span>
                                    <span className="block text-meta text-text-muted">{text.summary(entry)}</span>
                                </span>
                            </Link>
                        </li>
                    );
                })}
            </ul>
            <Link href="/data-checks" className="inline-flex items-center gap-0.5 min-h-6 mt-2.5 text-sm text-link hover:underline">
                {t('review_all', { count })}
                <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
            </Link>
        </section>
    );
}
