'use client';
import React from 'react';
import { useTranslations } from 'next-intl';
import { formatDateForDisplay, formatYearOrEmpty } from '@/lib/date-utils';
import { useLanguage } from '@/app/components/LanguageProvider';
import { useDateQualifierWords } from '@/app/components/date-input/aliases';
import { cx } from './cx';
import type { LivingStatus } from './StatusMark';

interface LifespanProps {
  /**
   * `compact` = years only, "1889 – 1960" (thin spaces, #934) (lists, rails, chips, search).
   * `full` = "b. Feb 15, 1889, Lumen — d. Feb 20, 1960, Sunvale" (heroes).
   */
  variant?: 'compact' | 'full';
  /** Stored dates (GEDCOM qualifiers intact), or bare years from a server payload. */
  birth?: string | null;
  death?: string | null;
  /** Full only. The first comma segment is shown ("Lumen", not "Lumen, Asteria"). */
  birthPlace?: string | null;
  deathPlace?: string | null;
  /**
   * Compact, when only the birth is known: `deceased` → "1895 – ?". Anyone else,
   * living included, reads "b. 1895" (#861: no "–living" anywhere).
   */
  status?: LivingStatus;
  /** Compact only: `birth`/`death` are already display years ("~1876"), as the
   *  faces payload pre-formats them server-side. Re-formatting would drop the "~". */
  preformatted?: boolean;
  /**
   * `evidence` = amber: a fact being read or checked (heroes, timelines, citations).
   * `muted` = grey: the dates only help tell people apart (rows, lists, tables,
   * pickers, search, tree cards). Both keep JetBrains Mono (#935, ADR 0034).
   * Defaults to `evidence` for `full`, the hero format, and `muted` for `compact`.
   */
  tone?: 'evidence' | 'muted';
  className?: string;
}

const firstSegment = (place: string | null | undefined) => place?.split(',')[0]?.trim() || null;

/**
 * The one lifespan (#766, DV-1). Two formats, both with `.date-mono` on the dates
 * only (amber, or grey with `tone="muted"`); places and words stay in the
 * surrounding colour. Renders nothing when neither date is known. An age is not a
 * lifespan: callers show "aged 71" separately, once.
 */
export function Lifespan(props: LifespanProps) {
  return props.variant === 'full' ? <FullLifespan {...props} /> : <CompactLifespan {...props} />;
}

/** "b. Feb 15, 1889, Lumen — d. Feb 20, 1960, Sunvale". Only this variant needs the
 *  date-format settings, so compact rows don't depend on the language provider. */
function FullLifespan({ birth, death, birthPlace, deathPlace, tone = 'evidence', className }: LifespanProps) {
  const t = useTranslations('lifespan');
  const { language } = useLanguage();
  const dateWords = useDateQualifierWords();
  const d = (chunks: React.ReactNode) => <span className={cx('date-mono', tone === 'muted' && 'date-muted')}>{chunks}</span>;
  const part = (key: 'born' | 'died', date: string | null | undefined, place: string | null | undefined) => {
    if (!date) return null;
    const shown = formatDateForDisplay(date, language, dateWords);
    const at = firstSegment(place);
    return at ? t.rich(`${key}_at`, { date: shown, place: at, d }) : t.rich(key, { date: shown, d });
  };
  const born = part('born', birth, birthPlace);
  const died = part('died', death, deathPlace);
  if (!born && !died) return null;
  return (
    <span className={className}>
      {born}
      {born && died && ' — '}
      {died}
    </span>
  );
}

/**
 * Thin spaces (U+2009) around the en dash (#934): without them a qualifier
 * symbol runs into the dash, so "1800–<1812" reads as an arrow. The span is
 * nowrap because a thin space is a break opportunity.
 */
const DASH = '\u2009–\u2009';

/** "1889 – 1960", "1895 – ?", "b. 1895" or "d. 1960" (thin spaces). */
function CompactLifespan({ birth, death, status, preformatted = false, tone = 'muted', className }: LifespanProps) {
  const t = useTranslations('lifespan');
  const year = (v: string | null | undefined) => (preformatted ? v ?? '' : formatYearOrEmpty(v ?? null));
  const b = year(birth);
  const e = year(death);
  let text: string | null = null;
  if (b && e) text = `${b}${DASH}${e}`;
  else if (b) text = status === 'deceased' ? `${b}${DASH}?` : t('born_year', { year: b });
  else if (e) text = t('died_year', { year: e });
  if (!text) return null;
  return <span className={cx('date-mono whitespace-nowrap', tone === 'muted' && 'date-muted', className)}>{text}</span>;
}
