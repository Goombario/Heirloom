'use client';

import GuardedLink from '@/app/components/GuardedLink';
import ProfileImage from '@/app/components/ProfileImage';
import { ArrowUpRight, Link2Off } from '@/lib/icons';
import { getInitials } from '@/lib/utils/initials';
import { avatarClass } from '@/lib/utils/avatar';
import { cx } from './cx';
import { RowAction, RowActions } from './RowActions';

/** One face in the stack: a portrait when there is one, else initials on the sex colour. */
interface FamilyStackPerson {
  Id: number;
  FirstName?: string | null;
  LastName?: string | null;
  Sex?: string | null;
  PrimaryMediaId?: number | null;
  FocalX?: number | null;
  FocalY?: number | null;
  FocalRadius?: number | null;
}

/** The photo stack's cards, front first: a slight fan, like prints dropped on a table. */
const STACK_CARD = ['left-0 top-[3px] -rotate-3', 'left-[8px] top-px rotate-[5deg]', 'left-4 top-1 rotate-[11deg]'];

function FamilyStack({ people, treeId }: { people: FamilyStackPerson[]; treeId: number | null }) {
  // Painted back to front, so the first face lands on top. At most three.
  const cards = people.slice(0, STACK_CARD.length).map((p, i) => ({ p, cls: STACK_CARD[i] })).reverse();
  return (
    <span aria-hidden="true" className="relative w-[54px] h-12 shrink-0">
      {cards.map(({ p, cls }) => (
        <span key={p.Id} className={cx('absolute w-9 h-[42px] rounded-[4px] border-2 border-card overflow-hidden shadow-sm bg-card', cls)}>
          {p.PrimaryMediaId
            ? <ProfileImage mediaId={p.PrimaryMediaId} treeId={treeId} alt="" focalX={p.FocalX ?? 50} focalY={p.FocalY ?? 50} focalRadius={p.FocalRadius ?? null}
                containerWidth={32} containerHeight={38} circular={false} />
            : (
              <span className={cx(avatarClass(p.Sex ?? null), 'grid place-items-center w-full h-full text-xs font-semibold text-[color:var(--color-on-media)]')}>
                {getInitials(p.FirstName ?? '', p.LastName ?? '')}
              </span>
            )}
        </span>
      ))}
    </span>
  );
}

export interface FamilyRecordRowProps {
  href: string;
  /** "Anders & Greta’s family", or "with Greta Holm" on the family page. Wraps rather than cuts off (#48). */
  title: React.ReactNode;
  /** "Marriage · 1902 · 3 children". */
  sub?: React.ReactNode;
  /** Parents then self and siblings, or self, partner, children. The first three show. */
  stack: FamilyStackPerson[];
  treeId: number | null;
  /** The phone row ends in ↗; the desktop rail row doesn't (locked on #49). */
  arrow?: boolean;
  /** Desktop hover unlink: removes this person from that family, editors only. */
  unlink?: { label: string; onClick: () => void };
  /** `phone` keeps the 72px touch row; `desktop` is the compact rail row. */
  density?: 'phone' | 'desktop';
  className?: string;
}

/**
 * The way into a family record (#1098, shared by #55): a tinted row with a photo
 * stack, so it reads as a family, not one more person. The phone Family tab and the
 * desktop person and family rails use the same row.
 */
export function FamilyRecordRow({ href, title, sub, stack, treeId, arrow = true, unlink, density = 'phone', className }: FamilyRecordRowProps) {
  const phone = density === 'phone';
  const link = (
    <GuardedLink
      href={href}
      className={cx(
        'flex flex-1 min-w-0 items-center gap-3 text-text no-underline transition-colors',
        phone ? 'w-full min-h-[72px] px-4 py-3 bg-surface-2 active:bg-border focus-ring-inset' : 'px-3 py-2.5 focus-ring rounded-card',
      )}
    >
      {stack.length > 0 && <FamilyStack people={stack} treeId={treeId} />}
      <span className="flex-1 min-w-0 grid gap-px">
        <span className="serif font-semibold text-md leading-snug break-words">{title}</span>
        {sub && <span className="text-meta text-text-muted">{sub}</span>}
      </span>
      {arrow && <ArrowUpRight className="w-[18px] h-[18px] shrink-0 text-text-muted" aria-hidden="true" />}
    </GuardedLink>
  );
  if (phone && !unlink) return className ? <div className={className}>{link}</div> : link;
  return (
    <div className={cx('family-record-row row-host flex items-center gap-1 rounded-card bg-surface-2 hover:bg-[color:var(--color-border)] transition-colors', !phone && 'pr-2', className)}>
      {link}
      {unlink && (
        <RowActions compact>
          <RowAction danger icon={<Link2Off size={13} aria-hidden="true" />} label={unlink.label} ariaLabel={unlink.label} onClick={unlink.onClick} />
        </RowActions>
      )}
    </div>
  );
}
