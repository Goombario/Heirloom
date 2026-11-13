'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { cx } from '@/app/components/ui';
import { useMenuKeyboard } from '@/app/components/ui/useMenuKeyboard';
import { Copy, Ellipsis, RotateCcw, Shield, UserMinus, UserRound, X } from '@/lib/icons';
import type { MemberListRow } from '@/lib/db/queries/members';
import { memberName } from './memberText';

export interface MemberActions {
  onRole: (m: MemberListRow, role: 'admin' | 'member') => void;
  onRevoke: (m: MemberListRow) => void;
  onRestore: (m: MemberListRow) => void;
  onCopyLink: () => void;
  onCancelInvite: (m: MemberListRow) => void;
}

interface Item {
  label: string;
  icon: React.ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  separated?: boolean;
}

/**
 * The ••• menu on a desktop row. What it offers follows the row's status: Active has
 * Make admin or Make member and Revoke; Invited has Copy sign-in link and Cancel
 * invite; Revoked has Restore. The last admin's two choices are dimmed and say why.
 */
export function MemberRowMenu({ member, lastAdmin, actions }: {
  member: MemberListRow;
  /** This row is the only active admin: no demote, no revoke. */
  lastAdmin: boolean;
  actions: MemberActions;
}) {
  const t = useTranslations('members');
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const close = (returnFocus: boolean) => { setOpen(false); if (returnFocus) trigger.current?.focus(); };
  const onKeyDown = useMenuKeyboard({ open, menuRef: menu, onClose: close });

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const icon = (Icon: typeof Shield) => <Icon className="w-4 h-4" aria-hidden="true" />;
  const items: Item[] = member.Status === 'active'
    ? [
        member.Role === 'admin'
          ? { label: t('make_member'), icon: icon(UserRound), disabled: lastAdmin, onSelect: () => actions.onRole(member, 'member') }
          : { label: t('make_admin'), icon: icon(Shield), onSelect: () => actions.onRole(member, 'admin') },
        { label: t('revoke'), icon: icon(UserMinus), danger: true, disabled: lastAdmin, separated: true, onSelect: () => actions.onRevoke(member) },
      ]
    : member.Status === 'invited'
      ? [
          { label: t('copy_link'), icon: icon(Copy), onSelect: actions.onCopyLink },
          { label: t('cancel_invite'), icon: icon(X), danger: true, separated: true, onSelect: () => actions.onCancelInvite(member) },
        ]
      : [{ label: t('restore'), icon: icon(RotateCcw), onSelect: () => actions.onRestore(member) }];

  const label = t('actions_for', { name: memberName(member) });
  return (
    <div ref={wrap} className="relative inline-block">
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cx(
          'grid place-items-center w-8 h-8 rounded-full border text-text-muted cursor-pointer focus-ring',
          open ? 'border-border bg-surface-2 text-text' : 'border-transparent hover:bg-surface-2',
        )}
      >
        <Ellipsis className="w-4 h-4" aria-hidden="true" />
      </button>
      {open && (
        <div
          ref={menu}
          role="menu"
          aria-label={label}
          onKeyDown={onKeyDown}
          className="absolute right-0 top-full z-40 mt-1 w-64 rounded-lg border border-border bg-card p-1.5 shadow-[var(--shadow-lg)] text-left"
        >
          {items.map((item) => (
            <div key={item.label}>
              {item.separated && <div className="h-px bg-border my-1.5 mx-1" role="separator" />}
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                aria-disabled={item.disabled || undefined}
                onClick={() => {
                  if (item.disabled) return;
                  setOpen(false);
                  item.onSelect();
                }}
                className={cx(
                  'flex w-full min-h-9 items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm focus-ring-inset',
                  item.disabled
                    ? 'text-text-muted opacity-60 cursor-default'
                    : cx('cursor-pointer hover:bg-hover-surface', item.danger ? 'text-error' : 'text-text'),
                )}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            </div>
          ))}
          {lastAdmin && <p className="m-0 px-2.5 pt-2 pb-1.5 text-meta text-text-muted border-t border-border mt-1.5">{t('only_admin')}</p>}
        </div>
      )}
    </div>
  );
}
