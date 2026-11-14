'use client';

import { useTranslations } from 'next-intl';
import GuardedLink from '@/app/components/GuardedLink';
import { SectionEmpty, SectionHeader, citeClass, cx } from '@/app/components/ui';
import { groupCitationFactsBySource, numberSources } from '@/app/components/citations/factDescriptors';
import type { CitationFactDescriptor } from '@/app/components/citations/types';
import { librarySourceHref } from '@/app/library/links';
import { sourceTypeLabel } from '@/app/library/sourceTypes';
import { sortableYear } from '@/lib/date-utils';
import { ArrowUpRight } from '@/lib/icons';

/** How many facts a row names before "and N more". */
const NAMED = 3;

/** A fact as the "Cited for" line names it: its label and year ("Census 1880"). */
function factName(fact: CitationFactDescriptor): string {
  const year = sortableYear(fact.date ?? null);
  return year != null ? `${fact.label} ${year}` : fact.label;
}

/**
 * "Sources cited" at the foot of the desktop person page (#49): one row per source,
 * numbered to match its chips, each leaving for the source (↗), with its type and
 * the facts on this page it is cited for (ADR 0044). With nothing cited the section
 * stays as one line (#157), so the section list's "Sources" entry always lands
 * somewhere; it has no Add, since citations come from a fact's source pin.
 */
export function SourcesSection({ facts, title, notice }: {
  facts: CitationFactDescriptor[];
  title: string;
  /** A load error to show above the list; the section keeps its heading while one shows. */
  notice?: React.ReactNode;
}) {
  const t = useTranslations('common');
  const tl = useTranslations('library');
  const td = useTranslations('personDesktop');
  const sources = groupCitationFactsBySource(facts);
  const numbers = numberSources(facts);
  const empty = sources.length === 0 && !notice;
  return (
    <section id="sources" aria-labelledby="sources-title" className={cx(empty && 'is-empty')}>
      {empty ? (
        <SectionEmpty headingId="sources-title" title={title}>{td('sources_none')}</SectionEmpty>
      ) : (
        <>
          {notice}
          <SectionHeader level="label" headingId="sources-title" title={title} count={sources.length} />
          {sources.length > 0 && (
            // Open rows (#157), like Names and Notes: spacing only, no hairlines.
            <ol className="list-none m-0 p-0 grid gap-0.5">
              {sources.map((source) => {
                const sourceTitle = source.title ?? t('source_fallback', { id: source.sourceId });
                const type = source.facts.flatMap((f) => f.citations).find((c) => c.SourceId === source.sourceId)?.sourceType ?? null;
                const names = source.facts.map(factName);
                const shown = names.slice(0, NAMED).join(', ');
                const more = names.length - NAMED;
                return (
                  <li key={source.sourceId}>
                    <GuardedLink
                      href={librarySourceHref(source.sourceId)}
                      className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-2.5 gap-y-0.5 rounded-btn -mx-2 px-2 py-2 text-base text-text no-underline hover:bg-hover-surface focus-ring"
                    >
                      <span className={`${citeClass()} shrink-0 mt-px`}>{numbers.get(source.sourceId)}</span>
                      <span className="serif text-md font-semibold min-w-0">{sourceTitle}</span>
                      <ArrowUpRight className="w-4 h-4 shrink-0 mt-0.5 text-text-muted" aria-hidden="true" />
                      {names.length > 0 && (
                        <span className="col-start-2 col-span-2 text-meta text-text-muted">
                          {td.rich('cited_for', {
                            type: sourceTypeLabel(type, tl),
                            facts: shown,
                            more: Math.max(0, more),
                            b: (chunks) => <b className="font-semibold text-text-secondary">{chunks}</b>,
                          })}
                        </span>
                      )}
                    </GuardedLink>
                  </li>
                );
              })}
            </ol>
          )}
        </>
      )}
    </section>
  );
}
