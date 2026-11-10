'use client';

import { useTranslations } from 'next-intl';
import { QUAY_VALUES, QUAY_LABEL_KEY } from '@/lib/citations/quay';
import { quayTone } from './quayTone';

/** i18n key (under `library`) for each QUAY level's short segment label. */
const QUAY_SHORT_KEY: Record<string, string> = {
  '3': 'certainty_short_3',
  '2': 'certainty_short_2',
  '1': 'certainty_short_1',
  '0': 'certainty_short_0',
};

const TONE_ON: Record<string, string> = {
  green: 'bg-success-bg border-success text-success',
  blue: 'bg-info-bg border-info-text text-info-text',
  warning: 'bg-warning-bg border-[color:var(--warning-text)] text-warning-text',
  red: 'bg-error-bg border-error text-error',
};

interface Props {
  /** '' (unset) or '0'..'3'. */
  value: string;
  onChange: (value: string) => void;
  idPrefix?: string;
  /** Id of the visible label naming the group; without it the group names itself. */
  labelledBy?: string;
}

/**
 * Certainty (GEDCOM QUAY) picker — colour AND text label so it stays legible for
 * colour-blind users. Clicking the active segment clears it back to unset.
 */
export function CertaintySegments({ value, onChange, idPrefix = 'quay', labelledBy }: Props) {
  const t = useTranslations('library');
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : t('field_certainty')}
      className="grid grid-cols-4 rounded-md overflow-hidden">
      {QUAY_VALUES.map((v, i) => {
        const on = value === v;
        const tone = quayTone(v);
        const fullLabel = t(QUAY_LABEL_KEY[v]);
        const shortLabel = t(QUAY_SHORT_KEY[v]);
        return (
          <button
            key={v}
            type="button"
            id={`${idPrefix}-${v}`}
            role="radio"
            aria-checked={on}
            aria-label={fullLabel}
            title={fullLabel}
            onClick={() => onChange(on ? '' : v)}
            className={[
              'text-xs font-medium py-2 px-1 border cursor-pointer select-none text-center',
              'min-h-[44px] sm:min-h-0 sm:py-1.5',
              'focus-ring',
              i > 0 ? 'border-l-0' : '',
              on
                ? `${TONE_ON[tone]} font-semibold`
                : 'bg-card border-border text-text-muted hover:bg-[color:var(--color-hover-surface)]',
            ].join(' ')}
          >
            {shortLabel}
          </button>
        );
      })}
    </div>
  );
}
