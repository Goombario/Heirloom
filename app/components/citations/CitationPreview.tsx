'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Badge, Button, Card, buttonClass } from '@/app/components/ui';
import { Sheet } from '@/app/components/ui/Sheet';
import { useIsMobile } from '@/app/hooks/useIsMobile';
import { BookOpen } from '@/lib/icons';
import { isQuayValue } from '@/lib/citations/quay';
import type { Citation } from '@/lib/db/queries/citations';
import type { CitationPreviewTarget } from './types';
import type { SourceNumbers } from './factDescriptors';
import { placeCitationPopover } from './popoverPlacement';
import FactValue from './FactValue';
import { CitationLink } from './CitationLink';
import { librarySourceHref } from '@/app/library/links';

interface CitationPreviewProps {
  target: CitationPreviewTarget;
  /** The page's footnote numbers, so each citation carries its chip's number. */
  sourceNumbers: SourceNumbers;
  canEdit: boolean;
  onClose: () => void;
  onEdit: (citation: Citation) => void;
}

/**
 * Every citation on one fact (EV-4): whichever of the fact's chips opened it,
 * the popover lists them all, in footnote order.
 */
export default function CitationPreview({ target, sourceNumbers, canEdit, onClose, onEdit }: CitationPreviewProps) {
  const t = useTranslations('library');
  const isMobile = useIsMobile();
  const [position, setPosition] = useState<{ top: number; left: number; width?: number; maxHeight?: number }>({ top: 0, left: 0 });
  const cardRef = useRef<HTMLDivElement>(null);
  const focusRef = useRef<HTMLAnchorElement>(null);
  const { fact } = target;
  const citations = [...fact.citations].sort((a, b) =>
    (sourceNumbers.get(a.SourceId) ?? Infinity) - (sourceNumbers.get(b.SourceId) ?? Infinity));

  useLayoutEffect(() => {
    if (isMobile) return;
    const place = () => {
      const anchor = target.anchor;
      const row = anchor.closest('.tl-med-ev, tr') ?? anchor;
      const column = anchor.closest('.card');
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      setPosition(placeCitationPopover({
        anchor: anchor.getBoundingClientRect(),
        row: row.getBoundingClientRect(),
        bounds: column?.getBoundingClientRect() ?? { top: 0, bottom: viewport.height, left: 0, right: viewport.width },
        // The natural height, not the height a previous placement capped.
        height: cardRef.current?.scrollHeight ?? 0,
        viewport,
      }));
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [target.anchor, isMobile]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  // The popover focuses the clicked citation's link; the phone sheet focuses its
  // own first control (Sheet `autoFocus`). Either way, closing returns to the chip (#844).
  useEffect(() => {
    if (!isMobile) focusRef.current?.focus();
    return () => target.anchor.focus();
  }, [isMobile, target.anchor]);

  // Tabbing past the last control (or Shift+Tab before the first) closes the
  // popover, and its cleanup above returns focus to the chip (#798, KB-4).
  const closeOnTabOut = (event: React.KeyboardEvent) => {
    if (event.key !== 'Tab' || !cardRef.current) return;
    const focusable = Array.from(cardRef.current.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ));
    const edge = event.shiftKey ? focusable[0] : focusable[focusable.length - 1];
    if (!edge || event.target === edge) {
      event.preventDefault();
      onClose();
    }
  };

  const content = (
    <div className="p-[22px]">
      <div className="text-xs font-semibold uppercase tracking-[0.1em] text-text-muted">{t('evidence_for')}</div>
      <h3 className="serif text-xl leading-tight font-semibold text-text mt-0.5 mb-0">{fact.label}</h3>
      <p className="text-sm leading-relaxed text-text-muted mt-1 mb-4"><FactValue fact={fact} /></p>
      <ul className="list-none m-0 p-0">
        {citations.map(citation => (
          <li key={citation.Id} className="border-t border-border py-4 last:pb-0">
            <div className="flex items-start gap-2.5">
              <span className="text-xs font-semibold tabular-nums text-evidence leading-6 shrink-0" aria-hidden="true">{sourceNumbers.get(citation.SourceId)}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Badge className="shrink-0">
                      <BookOpen size={11} aria-hidden="true" />
                      {t(`type_${citation.sourceType ?? 'Document'}`)}
                    </Badge>
                    <div className="serif text-md leading-snug font-semibold text-text min-w-0">
                      {citation.sourceTitle ?? t('untitled_source')}
                    </div>
                  </div>
                  {citation.Quay && isQuayValue(citation.Quay) && (
                    <Badge tone="outline" dot className="shrink-0 text-evidence px-2.5 py-1">
                      {t(`certainty_short_${citation.Quay}`)}
                    </Badge>
                  )}
                </div>
                {(citation.sourceRepo || citation.Page) && (
                  <p className="text-xs leading-relaxed text-text-muted mt-2 mb-0">
                    {[citation.sourceRepo, citation.Page].filter(Boolean).join(' · ')}
                  </p>
                )}
                {citation.Url && <div className="mt-1.5"><CitationLink url={citation.Url} /></div>}
                {citation.DataText && (
                  <blockquote className="serif text-sm italic leading-relaxed text-text-secondary border-l-2 border-evidence-border bg-card-alt mt-3 mb-0 py-3 px-3.5 line-clamp-4">
                    {citation.DataText}
                  </blockquote>
                )}
                <div className="flex items-center justify-end gap-2 mt-3">
                  <Link
                    ref={citation.Id === target.citation.Id ? focusRef : undefined}
                    href={librarySourceHref(citation.SourceId)}
                    title={t('open_in_library')}
                    className={buttonClass({ variant: 'ghost', size: 'sm' })}
                  >
                    {t('open_source')}
                  </Link>
                  {canEdit && <Button variant="outline" size="sm" onClick={() => onEdit(citation)}>{t('edit_citation')}</Button>}
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );

  if (isMobile) {
    return <Sheet open onClose={onClose} title={fact.label} autoFocus>{content}</Sheet>;
  }

  return (
    <>
      <button type="button" aria-label={t('close_preview')} className="fixed inset-0 z-50 cursor-default" onClick={onClose} />
      <Card ref={cardRef} data-testid="citation-preview-card" role="dialog" aria-modal="true" aria-label={t('citation_preview')} onKeyDown={closeOnTabOut} pad={false} className="fixed z-60 w-[calc(100vw-24px)] max-w-[480px] max-h-[calc(100vh-24px)] overflow-auto rounded-panel shadow-[var(--shadow-lg)]" style={position}>
        {content}
      </Card>
    </>
  );
}
