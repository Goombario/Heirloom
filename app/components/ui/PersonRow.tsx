'use client';

import GuardedLink from '@/app/components/GuardedLink';
import { Link2Off } from '@/lib/icons';
import { cx } from './cx';
import { PersonIdentity } from './PersonIdentity';
import { RowAction, RowActions } from './RowActions';

interface RowCommand { label: string; onClick: () => void }

type IdentityProps = React.ComponentProps<typeof PersonIdentity>;

export interface PersonRowProps extends Omit<IdentityProps, 'as' | 'className'> {
  /** Where the row goes: the person's page. Leave it out for a static row (a form's picked child). */
  href?: string;
  /** Edit, editors and contributors only. Opens the row's inline panel. The label names the row ("Edit Anna"). */
  edit?: RowCommand;
  /** Unlink (remove from this family), editors only. Takes effect at once, with an Undo toast. */
  unlink?: RowCommand;
  className?: string;
}

/**
 * A person in a list (#55): rail partners, children and siblings, Home's Recently
 * edited, form child rows and finder results. It is `PersonIdentity` (avatar, name,
 * years, role tag) inside a link, with the hover actions as a sibling of the link,
 * never nested inside it. On the v1.1 pages pass `nameStyle="serif"` (C9).
 */
export function PersonRow({ href, edit, unlink, className, ...identity }: PersonRowProps) {
  const hasActions = edit != null || unlink != null;
  const body = <PersonIdentity {...identity} as="span" className="flex-1" />;
  return (
    <div className={cx('person-row row-host flex items-center gap-2 rounded-btn transition-colors', href && 'hover:bg-hover-surface', className)}>
      {href ? (
        <GuardedLink href={href} className="flex flex-1 min-w-0 items-center px-2 py-1.5 text-text no-underline focus-ring rounded-btn">
          {body}
        </GuardedLink>
      ) : (
        <div className="flex flex-1 min-w-0 items-center px-2 py-1.5">{body}</div>
      )}
      {hasActions && (
        <RowActions compact editLabel={edit?.label} onEdit={edit?.onClick}>
          {unlink && (
            <RowAction danger icon={<Link2Off size={13} aria-hidden="true" />} label={unlink.label} ariaLabel={unlink.label} onClick={unlink.onClick} />
          )}
        </RowActions>
      )}
    </div>
  );
}
