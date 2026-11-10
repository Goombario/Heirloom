'use client';

import { Button } from './Button';

export interface PaginationProps {
  current: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  prevLabel: string;
  nextLabel: string;
  /** Pre-interpolated "Page X of Y" label — i18n stays with the caller. */
  positionLabel: string;
}

/**
 * Prev / position / Next pager. Renders nothing for a single page. Extracted
 * from the byte-identical blocks in the People and Families list pages (#175).
 */
export function Pagination({
  current,
  total,
  onPrev,
  onNext,
  prevLabel,
  nextLabel,
  positionLabel,
}: PaginationProps) {
  if (total <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-2 mt-4">
      <Button variant="outline" size="sm" onClick={onPrev} disabled={current === 1}>
        {prevLabel}
      </Button>
      <span className="text-text-muted text-sm">{positionLabel}</span>
      <Button variant="outline" size="sm" onClick={onNext} disabled={current === total}>
        {nextLabel}
      </Button>
    </div>
  );
}
