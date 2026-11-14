'use client';

import React from 'react';
import GuardedLink from '@/app/components/GuardedLink';
import { ArrowUpRight, Check, ChevronRight, Plus } from '@/lib/icons';
import { useHideOnScroll } from '@/app/hooks/useHideOnScroll';
import { cx } from './cx';

/*
 * The mobile control vocabulary (#1057, design-system.md → Mobile → Controls and Rows):
 * glass buttons on photos and dark bands, full-width rows for every other action, and
 * at most one copper pill per screen. No boxed buttons on a phone screen.
 */

/** A 34px target drawn inside a 44px hit area. */
const HIT_44 = "relative before:absolute before:-inset-[5px] before:content-['']";

interface GlassButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Accessible name; also the tooltip. */
  label: string;
  /** The icon, sized by the button (18px). */
  icon: React.ReactNode;
  /** A word beside the icon makes it a pill ("Tree"); the word is then the name. */
  word?: string;
  /** Navigate instead of act. */
  href?: string;
}

/**
 * Round translucent button for photos and dark bands (menu, back, Tree, search, edit):
 * a 34px circle, or a 34px pill with a word. Black 38% fill and the glass hairline.
 */
export function GlassButton({ label, icon, word, href, className, type = 'button', ...rest }: GlassButtonProps) {
  const cls = cx(
    HIT_44,
    'inline-flex items-center justify-center h-[34px] shrink-0 rounded-full cursor-pointer',
    'bg-black/[0.38] text-white border border-[color:var(--color-glass-border)]',
    'transition-colors active:bg-black/55 focus-ring',
    '[&_svg]:w-[18px] [&_svg]:h-[18px] [&_svg]:shrink-0',
    word ? 'gap-1.5 pl-2.5 pr-3 text-sm font-semibold' : 'w-[34px]',
    className,
  );
  const body = <>{icon}{word && <span>{word}</span>}</>;
  if (href) {
    return (
      <GuardedLink href={href} className={cls} aria-label={word ? undefined : label} title={label}>
        {body}
      </GuardedLink>
    );
  }
  return (
    <button type={type} className={cls} aria-label={word ? undefined : label} title={label} {...rest}>
      {body}
    </button>
  );
}

/** What a tap does, shown at the row's end (or, for plus and checkbox, its start). */
type RowEnd = 'none' | 'chevron' | 'leave';

interface MobileRowProps {
  /** The row's main line. Content rows pass the name or text; action rows the action. */
  label: React.ReactNode;
  /** A second line, only for a count, a consequence or a person's own facts. */
  sub?: React.ReactNode;
  /** A 34px icon tile: makes this an action row (label in ink 600). */
  icon?: React.ReactNode;
  /** Leading content such as an avatar (content rows). */
  lead?: React.ReactNode;
  /** Chevron for a next step on the page, ↗ for leaving it, none for content rows. */
  end?: RowEnd;
  /** A one-tap suggestion: a plus before the lead, and the tap acts at once. */
  suggestion?: boolean;
  /** Multi-select: a checkbox before the lead, for picking several before one bulk action. */
  checked?: boolean;
  /** `danger` for a Delete row (red text, the last row of an edit sheet). */
  tone?: 'default' | 'danger';
  /** Draw a hairline above the row (rows after the first in a list). */
  divided?: boolean;
  /** The current choice, muted at the end before the chevron (a setting's value). */
  value?: React.ReactNode;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
  /** Called on hover, focus or touch of a linked row, to prefetch its page (#65). */
  onIntent?: () => void;
}

/**
 * The full-width row. Place rows edge to edge: each pads itself to the 16px gutter, so
 * its pressed highlight and hairline run the full width. A pressed highlight in
 * `--surface-2`, an optional icon tile or portrait, an optional second line. The end
 * says what a tap does: nothing for content rows, a chevron for a next step that stays
 * on the page, ↗ for leaving it. A plus marks a one-tap suggestion; a checkbox only
 * when picking several before one action (`checked`, `role="checkbox"`).
 */
export function MobileRow({
  label, sub, icon, lead, end = 'none', suggestion = false, checked, tone = 'default',
  divided = false, value, href, onClick, onIntent, disabled, className, 'aria-label': ariaLabel,
}: MobileRowProps) {
  const multi = checked !== undefined;
  const cls = cx(
    'flex w-full min-h-11 items-center gap-3 px-4 py-3 text-left bg-transparent cursor-pointer',
    'transition-colors active:bg-surface-2 focus-ring-inset no-underline',
    'disabled:opacity-40 disabled:cursor-default',
    divided && 'border-t border-border',
    className,
  );
  const body = (
    <>
      {multi && (
        <span
          aria-hidden="true"
          className={cx(
            'grid place-items-center w-[22px] h-[22px] shrink-0 rounded-md border-2',
            checked ? 'bg-text border-text text-card' : 'border-text-muted text-transparent',
          )}
        >
          <Check className="w-3.5 h-3.5" strokeWidth={2.6} />
        </span>
      )}
      {suggestion && (
        <span aria-hidden="true" className="grid place-items-center w-7 h-7 shrink-0 rounded-full bg-surface-2 text-link">
          <Plus className="w-4 h-4" strokeWidth={2.2} />
        </span>
      )}
      {icon && (
        <span
          aria-hidden="true"
          className={cx(
            'grid place-items-center w-[34px] h-[34px] shrink-0 rounded-[9px] bg-surface-2 [&_svg]:w-[18px] [&_svg]:h-[18px]',
            tone === 'danger' ? 'text-error' : 'text-text',
          )}
        >
          {icon}
        </span>
      )}
      {lead}
      <span className="flex-1 min-w-0 grid gap-px">
        <span className={cx(
          'text-base leading-snug',
          tone === 'danger' ? 'text-error font-semibold' : icon ? 'text-text font-semibold' : 'text-text',
        )}>
          {label}
        </span>
        {sub && <span className="text-meta text-text-muted">{sub}</span>}
      </span>
      {value != null && <span className="shrink-0 max-w-[46%] truncate text-sm text-text-muted">{value}</span>}
      {end === 'chevron' && <ChevronRight className="w-[18px] h-[18px] shrink-0 text-text-muted" aria-hidden="true" />}
      {end === 'leave' && <ArrowUpRight className="w-[18px] h-[18px] shrink-0 text-text-muted" aria-hidden="true" />}
    </>
  );
  if (href) {
    return <GuardedLink href={href} className={cls} aria-label={ariaLabel} onTouchStart={onIntent} onFocus={onIntent} onMouseEnter={onIntent}>{body}</GuardedLink>;
  }
  return (
    <button
      type="button"
      className={cls}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      role={multi ? 'checkbox' : undefined}
      aria-checked={multi ? checked : undefined}
    >
      {body}
    </button>
  );
}

interface CopperPillProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: React.ReactNode;
  /** Bottom right over a list, sliding away while you scroll down (replaces `Fab`).
   *  Otherwise the pill is full width inside the content. */
  floating?: boolean;
}

/**
 * The screen's one main action, a rounded copper pill (Add person, Add family, Save).
 * Full width inside content, or `floating` bottom right on a list page, phones only.
 */
export function CopperPill({ icon, floating = false, className, type = 'button', children, ...rest }: CopperPillProps) {
  const hidden = useHideOnScroll({ off: !floating });
  return (
    <button
      type={type}
      data-hidden={floating && hidden ? 'true' : undefined}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-full bg-primary text-white font-semibold cursor-pointer btn-glow',
        'transition-[background,transform,opacity] hover:bg-primary-dark active:scale-[0.97] focus-ring',
        'disabled:opacity-40 disabled:cursor-default [&_svg]:w-[18px] [&_svg]:h-[18px]',
        floating
          ? 'md:hidden fixed right-4 z-30 h-12 pl-4 pr-5 text-base shadow-[0_6px_18px_rgba(0,0,0,0.24)] data-[hidden=true]:translate-y-24 data-[hidden=true]:opacity-0 motion-reduce:transition-none'
          : 'w-full min-h-12 px-[18px] text-base',
        className,
      )}
      style={floating ? { bottom: 'calc(18px + env(safe-area-inset-bottom, 0px))' } : undefined}
      aria-hidden={floating && hidden ? true : undefined}
      tabIndex={floating && hidden ? -1 : undefined}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}

/**
 * An on/off setting row (#1122): the label and its description, and a switch at the
 * end. The whole row toggles. Checkboxes stay for picking several things before one
 * action; a setting that takes effect at once is a switch.
 */
export function SwitchRow({ label, description, checked, onChange, divided = false }: {
  label: string; description?: string; checked: boolean; onChange: (checked: boolean) => void; divided?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cx(
        'flex w-full items-start gap-3.5 px-4 py-3 text-left cursor-pointer active:bg-surface-2 focus-ring-inset',
        divided && 'border-t border-border',
      )}
    >
      <span className="flex-1 min-w-0 grid gap-0.5">
        <span className="text-base font-semibold text-text">{label}</span>
        {description && <span className="text-meta leading-snug text-text-muted">{description}</span>}
      </span>
      <span
        aria-hidden="true"
        className={cx(
          'relative shrink-0 w-11 h-[26px] rounded-full transition-colors motion-reduce:transition-none',
          checked ? 'bg-text' : 'bg-border',
        )}
      >
        <span className={cx(
          'absolute left-[3px] top-[3px] w-5 h-5 rounded-full shadow-[0_1px_3px_rgba(0,0,0,0.25)] transition-transform motion-reduce:transition-none',
          checked ? 'translate-x-[18px] bg-card' : 'bg-white',
        )} />
      </span>
    </button>
  );
}
