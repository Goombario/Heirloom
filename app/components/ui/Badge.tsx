import React from 'react';
import { cx } from './cx';

type Tone = 'neutral' | 'outline' | 'evidence' | 'warning' | 'green' | 'blue' | 'red' | 'violet' | 'new';
type Shape = 'tag' | 'pill';

// Status badges are small square tags (#692, decision 9): 4px radius, no hover,
// never in a row of controls. A badge is not clickable, so it must not share the
// round shape of a FilterChip; `shape="pill"` is kept only for a dismissible filter
// token, which IS a control.
//
// Quiet tags (audit §13 addendum, 2026-09-23): no edge on any tone but warning (below). The ring that
// #692 added made rows of tags read as dated, boxed chrome; a tag's fill is now
// deliberately faint and its text (AA on its own fill, contrast-tokens.test.ts)
// carries it, the way the NEW tag always has. Descriptive facts (sex, role) are no
// longer tags at all, and living status and sourcing have their own primitives
// (StatusMark, SourcingMeter), so fewer tags appear per row.
const TAG_TONE: Record<string, string> = {
  // The default: the NEW-style quiet fill, a touch darker than surface-2 so it
  // stays visible on cards and on surface-2 parents without an edge.
  neutral: 'bg-new-bg text-on-new',
  // Plain muted text in the tag's slot (no fill, no box): for secondary states such
  // as an inactive case or a separated family. Transparent, so it can never collide
  // with the surface behind it (the Faces rail paints its column surface-2).
  outline: 'bg-transparent text-text-muted',
  // Evidence (#688): the solid "complete" fill. Amber means evidence only, so never
  // use this for counts, flags or announcements.
  evidence: 'bg-evidence-tag text-on-evidence-tag',
  // Orange, not amber, so a warning never reads as "sourced". The one tone with an
  // edge (#824, #899): its fill is ~1.03:1 on a dark card, so without the 1px
  // warning-edge the tag's shape vanished. Still a pale fill, never a solid one, so
  // it can't be mistaken for the copper Save button.
  warning: 'bg-warning-bg text-warning-text ring-1 ring-inset ring-warning-edge',
  green: 'bg-success-bg text-success',
  blue: 'bg-info-bg text-info-text',
  red: 'bg-error-bg text-error',
  violet: 'bg-count-bg text-count-text',
  // Announcement ("NEW"): the same quiet fill as neutral.
  new: 'bg-new-bg text-on-new',
};

const TAG_BASE = 'inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium whitespace-nowrap';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  shape?: Shape;
  dot?: boolean;
}

export function Badge({ tone = 'neutral', shape = 'tag', dot = false, className = '', children, ...rest }: BadgeProps) {
  const base = cx(TAG_BASE, shape === 'pill' ? 'rounded-full' : 'rounded-[4px]', TAG_TONE[tone] ?? TAG_TONE.neutral);
  return (
    <span className={cx(base, className)} {...rest}>
      {dot && (
        <span
          className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
          style={{ background: 'currentColor' }}
        />
      )}
      {children}
    </span>
  );
}
