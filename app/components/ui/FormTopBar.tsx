'use client';

import React from 'react';
import GuardedLink from '@/app/components/GuardedLink';
import { ChevronLeft } from '@/lib/icons';
import { cx } from './cx';
import { PAGE_COLUMN, type PageShellVariant } from './PageShell';

export interface FormTopBarProps extends React.HTMLAttributes<HTMLElement> {
  /**
   * 'header' → sticks to the top with a bottom border (save-bar / mobile header);
   * 'footer' → sticks to the bottom with a top border (mobile action bar).
   */
  variant?: 'header' | 'footer';
  /** Render element — pass 'header'/'footer' for the semantic landmark; defaults to 'div'. */
  as?: 'div' | 'header' | 'footer';
  /**
   * Forwarded to the rendered element so a page can MEASURE the bar. Any other
   * sticky element on the same page has to clear it (this bar is itself offset
   * below the navbar, so a hardcoded offset guesses at two heights at once and
   * gets one of them wrong — #441).
   */
  ref?: React.Ref<HTMLElement>;
  /**
   * Align the bar's contents with a `PageShell` content column (#689), so the
   * form title starts where the form's fields do. The bar itself stays full
   * width; put vertical padding on `className` and the gap on `innerClassName`.
   */
  column?: PageShellVariant;
  /** Classes for the column wrapper (only used with `column`). */
  innerClassName?: string;
}

/**
 * Sticky form action bar — the save/cancel chrome that was hand-rolled 3–4× across
 * `FamilyForm` + `PersonForm` desktop/mobile (#175 Wave 2). It owns only the
 * invariant shell (sticky positioning, z-index, surface background, the edge
 * border, and flex). Padding, gap, and content stay at the call site via
 * `className`/children — they legitimately differ per surface (desktop 14/28,
 * mobile 12/12, footer 10/14 + safe-area inset).
 */
export function FormTopBar({ variant = 'header', as, column, innerClassName = '', className = '', children, ref, ...rest }: FormTopBarProps) {
  const Comp = (as ?? 'div') as React.ElementType;
  return (
    <Comp
      ref={ref}
      className={cx(
        'sticky z-20 flex bg-[color:var(--surface)]',
        // The navbar is sticky at z-40 and owns the top --nav-h of the viewport, so
        // a bar pinned at top-0 scrolls underneath it and loses its heading. Stick
        // below the navbar instead — same offset .mobile-sticky-filters uses.
        variant === 'header'
          ? 'top-[var(--nav-h)] items-center border-b border-[color:var(--border)]'
          : 'bottom-0 border-t border-[color:var(--border)]',
        className,
      )}
      {...rest}
    >
      {column ? (
        <div className={cx(PAGE_COLUMN[column], 'flex items-center', innerClassName)}>{children}</div>
      ) : (
        children
      )}
    </Comp>
  );
}

export interface FormTopBarTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {
  /** Heading level; a form page's title is its `h1`. */
  as?: 'h1' | 'h2';
}

/** The form bar's title in the 22px dialog recipe (`.title-dialog`, #687). */
export function FormTopBarTitle({ as = 'h1', className = '', children, ...rest }: FormTopBarTitleProps) {
  const Comp = as;
  return (
    <Comp className={cx('title-dialog m-0', className)} {...rest}>
      {children}
    </Comp>
  );
}

export interface MobileFormHeaderProps {
  /** Where the back chevron goes; unsaved-changes guarding applies. */
  backHref: string;
  backLabel: string;
  title: React.ReactNode;
  /** Classes for the bar, e.g. `md:hidden` when the page also renders a desktop bar. */
  className?: string;
}

/**
 * The phone form header every add/edit form shares (#807): back chevron plus
 * the form's serif title, sticky under the navbar. Save and Cancel sit in the
 * `MobileFormFooter`, at thumb reach.
 */
export function MobileFormHeader({ backHref, backLabel, title, className = '' }: MobileFormHeaderProps) {
  return (
    <FormTopBar as="header" className={cx('p-3 gap-2', className)}>
      <GuardedLink
        href={backHref}
        aria-label={backLabel}
        title={backLabel}
        className="min-w-11 min-h-11 rounded-[8px] inline-flex items-center justify-center shrink-0 text-text-2"
      >
        <ChevronLeft size={20} aria-hidden="true" />
      </GuardedLink>
      <h1 className="serif text-lg font-semibold leading-[1.1] m-0 flex-1 min-w-0 truncate">{title}</h1>
    </FormTopBar>
  );
}

/**
 * The phone form footer (#807): the form's actions, sticky at the bottom. Its
 * background fills the home-indicator zone under viewport-fit=cover; breathing
 * room comes from padding-bottom (the env inset), not a bottom offset, which
 * would leave a gap the scroll content peeks through. Give each button
 * `min-h-11 flex-1`.
 */
export function MobileFormFooter({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return (
    <FormTopBar
      variant="footer"
      className={cx('gap-2.5 pt-2.5 px-3.5 pb-[calc(10px+env(safe-area-inset-bottom,0px))]', className)}
    >
      {children}
    </FormTopBar>
  );
}
