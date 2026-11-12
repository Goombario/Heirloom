'use client';

import GuardedLink from '@/app/components/GuardedLink';
import { ArrowUpRight, ChevronDown, ChevronRight } from '@/lib/icons';
import { cx } from './cx';

/**
 * What a text link does, which sets its glyph (#55, the link glyph rule):
 * - `action` (›): an action on this page (opens a panel, a popover, a dialog).
 * - `leave` (↗): leaves the page or opens a full-screen view.
 * - `expand` (⌄): expands in place; the glyph turns while `expanded`.
 */
type ActionLinkKind = 'action' | 'leave' | 'expand';

interface BaseProps {
  kind?: ActionLinkKind;
  children: React.ReactNode;
  /** Drop the glyph (e.g. an Edit link beside an expander). Defaults to on for every kind except a bare `action` with no href. */
  glyph?: boolean;
  className?: string;
  title?: string;
  'aria-label'?: string;
}

type ButtonProps = BaseProps & {
  href?: undefined;
  onClick: () => void;
  expanded?: boolean;
  controls?: string;
  /** A popover trigger (`PersonFinder`'s trigger props spread here). */
  ref?: React.Ref<HTMLButtonElement>;
  'aria-haspopup'?: 'dialog' | 'menu';
  'aria-expanded'?: boolean;
  'aria-controls'?: string;
};
type LinkProps = BaseProps & { href: string; onClick?: () => void; expanded?: undefined; controls?: undefined; ref?: undefined };

const GLYPH = { action: ChevronRight, leave: ArrowUpRight, expand: ChevronDown } as const;

/**
 * A small ink text link (13px, 600) with the right glyph after it. A link with an
 * `href` is a guarded Next link and defaults to `leave`; one with only `onClick`
 * is a button and defaults to `action`. Use it for header actions ("Full history ↗"),
 * "Read all ⌄", "Cite ›" and the like, so the glyph rule is applied in one place.
 */
export function ActionLink({ ref, ...props }: ButtonProps | LinkProps) {
  const { children, className, title } = props;
  const kind: ActionLinkKind = props.kind ?? (props.href != null ? 'leave' : 'action');
  const showGlyph = props.glyph ?? !(kind === 'action' && props.href == null && props.kind == null);
  const Glyph = GLYPH[kind];
  const cls = cx(
    'action-link inline-flex items-center gap-0.5 text-sm font-semibold text-link hover:underline underline-offset-2 cursor-pointer focus-ring rounded-sm',
    className,
  );
  const glyph = showGlyph ? (
    <Glyph
      aria-hidden="true"
      className={cx('w-3.5 h-3.5 shrink-0 transition-transform', kind === 'expand' && props.expanded && 'rotate-180')}
    />
  ) : null;

  if (props.href != null) {
    return (
      <GuardedLink href={props.href} onClick={props.onClick} className={cls} title={title} aria-label={props['aria-label']}>
        {children}{glyph}
      </GuardedLink>
    );
  }
  return (
    <button
      ref={ref}
      type="button"
      onClick={props.onClick}
      className={cx(cls, 'bg-transparent border-0 p-0')}
      title={title}
      aria-label={props['aria-label']}
      aria-haspopup={props['aria-haspopup']}
      aria-expanded={kind === 'expand' ? Boolean(props.expanded) : props['aria-expanded']}
      aria-controls={props.controls ?? props['aria-controls']}
    >
      {children}{glyph}
    </button>
  );
}
