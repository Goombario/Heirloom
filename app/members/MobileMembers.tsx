'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  MobileListToggleChip, MobileListFilters, MobileListMeta, MobileRow, Input, Banner, showChangeToast, showErrorToast,
} from '@/app/components/ui';
import { ConfirmSheet, Sheet } from '@/app/components/ui/Sheet';
import { Avatar } from '@/app/components/ui/Avatar';
import { Copy, RotateCcw, UserMinus, X } from '@/lib/icons';
import { foldForSearch } from '@/lib/utils/search-fold';
import type { MemberListRow, MemberRole } from '@/lib/db/queries/members';
import { afterSheetStep } from '@/app/families/new/mobile/NewFamilySheet';
import { copySignInLink } from './CopySignInLink';
import { byInvitedThenName, memberName, useMemberText } from './memberText';
import { RolePickerRows } from './RolePickerRows';
import type { useMembers } from './useMembers';

/*
 * The phone Members page (#656), on the list page kit like People: the filter field
 * and chips (Active, Invited, Revoked, Admin log), full-width rows, Invited first
 * then by name. A row opens a small sheet with that person's actions; role changes
 * apply at once with Undo, Revoke asks first. Invite is a full-height sheet.
 */

export type PhoneView = 'all' | 'active' | 'invited' | 'revoked' | 'log';

export function MobileMembersFilters({ query, onQuery, view, onView }: {
  query: string;
  onQuery: (q: string) => void;
  view: PhoneView;
  onView: (v: PhoneView) => void;
}) {
  const t = useTranslations('members');
  const tc = useTranslations('common');
  const chips: { key: PhoneView; label: string }[] = [
    { key: 'active', label: t('status_active') },
    { key: 'invited', label: t('status_invited') },
    { key: 'revoked', label: t('status_revoked') },
    { key: 'log', label: t('tab_log') },
  ];
  return (
    <MobileListFilters value={query} onChange={onQuery} placeholder={t('filter_placeholder')}>
      {chips.map((c) => (
        <MobileListToggleChip
          key={c.key}
          label={c.label}
          on={view === c.key}
          clearLabel={tc('clear_filter_named', { name: c.label })}
          onTap={() => onView(view === c.key ? 'all' : c.key)}
          onClear={() => onView('all')}
        />
      ))}
    </MobileListFilters>
  );
}

export function filterMembers(members: MemberListRow[], view: PhoneView, query: string): MemberListRow[] {
  const q = foldForSearch(query.trim());
  return members
    .filter((m) => view === 'all' || view === 'log' || m.Status === view)
    .filter((m) => !q || foldForSearch(`${m.Name ?? ''} ${m.Email}`).includes(q))
    .sort(byInvitedThenName);
}

export function MobileMemberRows({ rows, meId, onOpen }: {
  rows: MemberListRow[];
  meId: number | null;
  onOpen: (m: MemberListRow) => void;
}) {
  const t = useTranslations('members');
  const text = useMemberText();
  return (
    <div className="md:hidden">
      <MobileListMeta count={t('count', { count: rows.length })} />
      {rows.length === 0 && <p className="m-0 px-4 py-6 text-base text-text-muted">{t('empty_filtered')}</p>}
      {rows.map((m, i) => {
        const role = text.role(m.Role);
        const sub = m.Status === 'invited'
          ? t('row_invited', { role })
          : m.Status === 'revoked'
            ? (m.RevokedAt ? t('row_revoked', { date: text.date(m.RevokedAt)! }) : t('row_revoked_no_date'))
            : m.UserId === meId
              ? t('row_you', { role })
              : [role, text.trees(m)].filter(Boolean).join(' · ');
        return (
          <MobileRow
            key={m.Id}
            divided={i > 0}
            onClick={() => onOpen(m)}
            className={m.Status === 'revoked' ? 'opacity-60 min-h-16' : 'min-h-16'}
            lead={<MemberAvatar member={m} size={40} />}
            label={(
              <span className={m.Status === 'invited' ? 'block truncate text-base' : 'block truncate serif text-md font-semibold'}>
                {memberName(m)}
              </span>
            )}
            sub={<span className="block truncate">{sub}</span>}
          />
        );
      })}
    </div>
  );
}

/** Initials once the person has a name; a dashed "?" for an invitation. */
export function MemberAvatar({ member, size }: { member: MemberListRow; size: number }) {
  if (member.Status === 'invited' || !member.Name) {
    return (
      <span
        aria-hidden="true"
        className="grid place-items-center shrink-0 rounded-full bg-surface-2 text-text-muted border border-dashed border-border font-semibold"
        style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
      >
        ?
      </span>
    );
  }
  return <Avatar name={member.Name} size={size} className="shadow-sm" />;
}

type Api = ReturnType<typeof useMembers>;

/** One person's sheet: their address and last sign-in, Role, then Access. */
export function MemberSheet({ member, lastAdmin, api, onClose }: {
  member: MemberListRow | null;
  lastAdmin: boolean;
  api: Api;
  onClose: () => void;
}) {
  const t = useTranslations('members');
  const text = useMemberText();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!member) return null;
  const name = memberName(member);

  const changeRole = async (role: MemberRole) => {
    if (role === member.Role || busy) return;
    const before = member.Role;
    setBusy(true);
    try {
      await api.setRole(member.Id, role);
      showChangeToast({
        message: role === 'admin' ? t('done_role_admin', { name }) : t('done_role_member', { name }),
        onUndo: () => { void api.setRole(member.Id, before).catch((err) => showErrorToast(text.failure(err))); },
      });
    } catch (err) {
      showErrorToast(text.failure(err));
    } finally {
      setBusy(false);
    }
  };

  const act = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await work();
      onClose();
      showChangeToast({ message: done });
    } catch (err) {
      showErrorToast(text.failure(err));
    } finally {
      setBusy(false);
    }
  };

  const lastSignIn = text.date(member.LastSignInAt);
  return (
    <>
      <Sheet open onClose={onClose} title={name}>
        <div className="-mx-4 -mt-3">
          <div className="px-4 py-3 border-b border-border">
            <div className="text-base text-text break-all">{member.Email}</div>
            <div className="text-meta text-text-muted">
              {member.Status === 'invited' ? t('not_signed_in') : lastSignIn ? t('last_signed_in', { date: lastSignIn }) : t('never')}
            </div>
          </div>
          {member.Status !== 'revoked' && (
            <>
              <div className="eyebrow px-4 pt-4 pb-1">{t('section_role')}</div>
              <RolePickerRows
                value={member.Role}
                onChange={(role) => void changeRole(role)}
                memberDisabled={lastAdmin && member.Role === 'admin'}
              />
              {lastAdmin && member.Role === 'admin' && <p className="m-0 px-4 pb-2 text-meta text-text-muted">{t('only_admin')}</p>}
            </>
          )}
          <div className="eyebrow px-4 pt-4 pb-1 border-t border-border">{t('section_access')}</div>
          {member.Status === 'active' && (
            <MobileRow
              icon={<UserMinus />}
              tone="danger"
              label={t('revoke_row')}
              sub={lastAdmin ? t('only_admin') : t('revoke_row_hint')}
              disabled={lastAdmin || busy}
              onClick={() => setConfirm(true)}
            />
          )}
          {member.Status === 'invited' && (
            <>
              <MobileRow
                icon={<Copy />}
                label={t('copy_link')}
                onClick={() => void copySignInLink({ copied: t('copied'), failed: t('copy_failed') })}
              />
              <MobileRow
                icon={<X />}
                tone="danger"
                divided
                label={t('cancel_invite')}
                disabled={busy}
                onClick={() => void act(() => api.cancelInvite(member.Id), t('done_cancelled', { email: member.Email }))}
              />
            </>
          )}
          {member.Status === 'revoked' && (
            <MobileRow
              icon={<RotateCcw />}
              label={t('restore')}
              disabled={busy}
              onClick={() => void act(() => api.restore(member.Id), t('done_restored', { name }))}
            />
          )}
        </div>
      </Sheet>
      <ConfirmSheet
        open={confirm}
        title={t('revoke_title', { name })}
        body={`${t('revoke_body', { name })} ${t('revoke_bullet_kept', { name })} ${t('revoke_bullet_shares', { name })}`}
        confirmLabel={t('revoke_row')}
        keepLabel={t('keep')}
        busy={busy}
        onClose={() => setConfirm(false)}
        onConfirm={() => { setConfirm(false); void act(() => api.revoke(member.Id), t('done_revoked', { name })); }}
      />
    </>
  );
}

/** Invite member on a phone: a full-height sheet with Invite as its copper pill. */
export function InviteMemberSheet({ open, initialEmail = '', onClose, onInvited, api }: {
  open: boolean;
  initialEmail?: string;
  onClose: () => void;
  /** After the sheet closes: open the new invitation's sheet (its Copy sign-in link). */
  onInvited: (email: string) => void;
  api: Api;
}) {
  if (!open) return null;
  return <InviteMemberSheetBody initialEmail={initialEmail} onClose={onClose} onInvited={onInvited} api={api} />;
}

function InviteMemberSheetBody({ initialEmail, onClose, onInvited, api }: {
  initialEmail: string;
  onClose: () => void;
  onInvited: (email: string) => void;
  api: Api;
}) {
  const t = useTranslations('members');
  const text = useMemberText();
  const [email, setEmail] = useState(initialEmail);
  const [role, setRole] = useState<MemberRole>('member');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.invite(email, role);
      const invited = email.trim().toLowerCase();
      onClose();
      showChangeToast({ message: t('done_invited', { email: invited }) });
      afterSheetStep(() => onInvited(invited));
    } catch (err) {
      setError(text.failure(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={t('invite_title')}
      size="full"
      dirty={email.trim() !== initialEmail.trim() || role !== 'member'}
      onSave={save}
      saveLabel={t('invite_short')}
      saveDisabled={busy || !email.trim()}
      saveWhenClean={!!initialEmail}
    >
      <div className="grid gap-4 pt-1">
        <Input
          type="email"
          label={t('email_label')}
          hint={t('email_hint')}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          inputMode="email"
        />
        {error && <Banner tone="error">{error}</Banner>}
      </div>
      <div className="-mx-4 mt-2">
        <div className="eyebrow px-4 pt-3 pb-1">{t('section_role')}</div>
        <RolePickerRows value={role} onChange={setRole} />
        <p className="m-0 px-4 py-3.5 text-meta text-text-muted">{t('invite_no_email')}</p>
      </div>
    </Sheet>
  );
}
