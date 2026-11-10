'use client';
import React from 'react';
import { useTranslations } from 'next-intl';
import { cx } from './cx';
import { Card } from './Card';
import { Button } from './Button';

export interface DetailHeroProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * 'dark' = the portrait hero: the tier-1 gradient island (Person, Family).
   * 'light' = the record hero: a white Card header for records without a
   * portrait (Case, Place; the Source modal paints the same rhythm).
   */
  tone?: 'dark' | 'light';
}

/**
 * Tier-1 of the detail-surface elevation ladder: the hero region. `dark` is the
 * gradient island (`.hero-dark`) + shared 24px bottom margin; `light` is a Card
 * header (p-5, 16px bottom margin). A slot either way — the domain layout (person
 * portrait, family ribbon, place title+badges) is passed in as children.
 */
export function DetailHero({ tone = 'dark', className = '', children, ...rest }: DetailHeroProps) {
  if (tone === 'light') {
    return (
      <Card pad={false} className={cx('p-5 mb-[16px]', className)} {...rest}>
        {children}
      </Card>
    );
  }
  return (
    <div className={cx('hero-dark', 'mb-[24px]', className)} {...rest}>
      {children}
    </div>
  );
}

/**
 * The one hero Edit button (#765, LY-4): an outline button reading "Edit", no icon,
 * top-right of the Family portrait hero and every record hero. The Person hero is the
 * deliberate exception (a tonal Edit leading its action row).
 */
export function HeroEditButton({ className, ...rest }: Omit<React.ComponentProps<typeof Button>, 'variant' | 'children'>) {
  const tc = useTranslations('common');
  return (
    <Button variant="outline" className={cx('shrink-0', className)} {...rest}>
      {tc('edit')}
    </Button>
  );
}
