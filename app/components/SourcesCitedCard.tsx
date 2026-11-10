'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { SectionHeader, citeClass, cx } from '@/app/components/ui';
import { groupCitationFactsBySource, numberSources } from '@/app/components/citations/factDescriptors';
import type { CitationFactDescriptor } from '@/app/components/citations/types';
import { librarySourceHref } from '@/app/library/links';

interface SourcesCitedCardProps {
  facts: CitationFactDescriptor[];
  title: string;
  /** Placement: `sources-cited-rail` (desktop) or `sources-cited-inline` (one column); globals.css. */
  className?: string;
}

/**
 * The page's footnote list (EV-1): one row per source, numbered to match its
 * chips on the page (#754), each linking to the source. Which facts a source
 * supports is on the chips' popovers, not here (#780). Renders nothing until
 * the page cites something: an unsourced fact's own "+" is the cue (#896, #904).
 */
export default function SourcesCitedCard({ facts, title, className }: SourcesCitedCardProps) {
  const t = useTranslations('common');
  const sources = groupCitationFactsBySource(facts);
  const numbers = numberSources(facts);
  if (sources.length === 0) return null;

  return (
    <div className={cx('card overflow-hidden', className)}>
      <div className="pt-[14px] px-4 pb-[6px]">
        <SectionHeader level="rail" title={title} count={sources.length} className="mb-0" />
      </div>
      <ol className="sources-cited-list scroll-area list-none m-0 px-2 pb-2 pt-1">
        {sources.map(source => {
          const sourceTitle = source.title ?? t('source_fallback', { id: source.sourceId });
          return (
            <li key={source.sourceId}>
              <Link
                href={librarySourceHref(source.sourceId)}
                title={t('view_in_library_with_title', { title: sourceTitle })}
                className="flex items-center gap-2.5 rounded-btn px-2 py-1.5 text-base text-text hover:bg-hover-surface focus-ring"
              >
                <span className={`${citeClass()} shrink-0`}>{numbers.get(source.sourceId)}</span>
                <span className="min-w-0">{sourceTitle}</span>
              </Link>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
