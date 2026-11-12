'use client';

import { useTranslations } from 'next-intl';
import GuardedLink from '@/app/components/GuardedLink';
import { Card, SectionHeader, citeClass } from '@/app/components/ui';
import { groupCitationFactsBySource, numberSources } from '@/app/components/citations/factDescriptors';
import type { CitationFactDescriptor } from '@/app/components/citations/types';
import { librarySourceHref } from '@/app/library/links';
import { ArrowUpRight } from '@/lib/icons';

/**
 * "Sources cited" at the foot of the desktop person page (#49): one row per source,
 * numbered to match its chips, each leaving for the source (↗). With nothing cited
 * the section stays, so the section list's "Sources" entry always lands somewhere.
 */
export function SourcesSection({ facts, title }: { facts: CitationFactDescriptor[]; title: string }) {
  const t = useTranslations('common');
  const td = useTranslations('personDesktop');
  const sources = groupCitationFactsBySource(facts);
  const numbers = numberSources(facts);
  return (
    <>
      <SectionHeader headingId="sources-title" title={title} count={sources.length} />
      {sources.length === 0 ? (
        <p className="m-0 text-sm text-text-muted">{td('no_sources')}</p>
      ) : (
        <Card pad={false}>
          <ol className="list-none m-0 p-2">
            {sources.map((source) => {
              const sourceTitle = source.title ?? t('source_fallback', { id: source.sourceId });
              return (
                <li key={source.sourceId}>
                  <GuardedLink
                    href={librarySourceHref(source.sourceId)}
                    className="flex items-center gap-2.5 rounded-btn px-2 py-2 text-base text-text no-underline hover:bg-hover-surface focus-ring"
                  >
                    <span className={`${citeClass()} shrink-0`}>{numbers.get(source.sourceId)}</span>
                    <span className="serif min-w-0 flex-1">{sourceTitle}</span>
                    <ArrowUpRight className="w-4 h-4 shrink-0 text-text-muted" aria-hidden="true" />
                  </GuardedLink>
                </li>
              );
            })}
          </ol>
        </Card>
      )}
    </>
  );
}
