'use client';

import React from 'react';
import { Banner } from './Banner';
import { Button } from './Button';

export interface InlineDataErrorProps {
  /** Already translated copy for the affected region. */
  message: string;
  /** Already translated action label, normally common.retry. */
  retryLabel: string;
  onRetry: () => void;
  className?: string;
}

/**
 * A translated, retryable read error for the region whose data failed to load.
 * Fetching, authentication, and navigation stay with the caller so this
 * presentational primitive can be used in pages, cards, and modals alike.
 */
export function InlineDataError({ message, retryLabel, onRetry, className = '' }: InlineDataErrorProps) {
  return (
    <Banner tone="error" role="alert" className={className}>
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 flex-1">{message}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRetry}
          // sm (32px) beside the message; a 44px target on touch only (#693).
          className="shrink-0 [@media(pointer:coarse)]:min-h-11"
        >
          {retryLabel}
        </Button>
      </div>
    </Banner>
  );
}
