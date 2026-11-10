import React from 'react';
import { useFitOneLine } from '@/app/hooks/useFitOneLine';

/**
 * The dark-hero name heading, owned in one place so the real PersonHero and the
 * PersonSummaryView loading paint cannot drift (they previously re-typed the name
 * font-size and #fff colour independently — 40 vs 36). `size` selects the exact
 * current per-context size, preserving each caller's spacing:
 *   sm = the compact hero below md (22px, 3px bottom margin)
 *   lg = person desktop hero + summary paint (40px, 4px bottom margin)
 *
 * A long name shrinks to stay on one line, down to a floor (lg 28px, sm 18px),
 * and wraps only below it (#741). Both callers size the same way, so the summary
 * paint and the live hero match.
 */
const FIT = {
  sm: { token: '--text-xl', minRatio: 18 / 22 },
  lg: { token: '--text-4xl', minRatio: 28 / 40 },
} as const;

export function HeroName({ children, size = 'lg' }: { children: React.ReactNode; size?: 'sm' | 'lg' }) {
  const fitRef = useFitOneLine<HTMLHeadingElement>(FIT[size]);
  const sizeClass =
    size === 'sm'
      ? 'serif font-semibold tracking-[-0.02em] text-xl leading-[1.1] mb-[3px]'
      : 'title-hero mb-[4px]';
  return (
    <h1
      ref={fitRef}
      className={`text-[color:var(--color-text)] m-0 ${sizeClass}`}
      style={{ overflowWrap: 'anywhere' }}
    >
      {children}
    </h1>
  );
}
