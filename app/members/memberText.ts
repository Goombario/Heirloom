'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { MemberListRow, MemberRole } from '@/lib/db/queries/members';
import { MemberActionError } from './useMembers';

/** The name a row goes by: the person's Google name once they've signed in, else the address. */
export function memberName(m: Pick<MemberListRow, 'Name' | 'Email'>): string {
  return m.Name?.trim() || m.Email;
}

/** Invited first, then by name, as the phone list orders them. */
export function byInvitedThenName(a: MemberListRow, b: MemberListRow): number {
  const rank = (m: MemberListRow) => (m.Status === 'invited' ? 0 : m.Status === 'active' ? 1 : 2);
  return rank(a) - rank(b) || memberName(a).localeCompare(memberName(b));
}

/** The words for a row: its role, the trees it reaches, when it was added, and dates. */
export function useMemberText() {
  const t = useTranslations('members');
  const locale = useLocale();
  const day = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });
  const date = (iso: string | null) => (iso ? day.format(new Date(iso)) : null);

  const role = (r: MemberRole) => (r === 'admin' ? t('role_admin') : t('role_member'));

  /** "Owns 2 · Edits 1", or null when sharing gives them nothing. */
  const trees = (m: MemberListRow): string | null => {
    const parts = [
      m.TreesOwned > 0 && t('trees_owns', { count: m.TreesOwned }),
      m.TreesEdit > 0 && t('trees_edits', { count: m.TreesEdit }),
      m.TreesContribute > 0 && t('trees_contributes', { count: m.TreesContribute }),
      m.TreesView > 0 && t('trees_views', { count: m.TreesView }),
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(' · ') : null;
  };

  const added = (m: MemberListRow): string => {
    if (m.Origin === 'bootstrap') return t('added_bootstrap');
    if (m.Origin === 'seed') return t('added_seed');
    const by = m.InvitedByName || m.InvitedByEmail;
    const on = date(m.CreatedAt) ?? '';
    return by ? t('added_by', { name: by, date: on }) : t('added_on', { date: on });
  };

  /** A refused change in plain words, from the server's reason code. */
  const failure = (err: unknown): string => {
    if (err instanceof MemberActionError) {
      if (err.code === 'already_listed') return t('error_already_listed');
      if (err.code === 'last_admin') return t('error_last_admin');
      if (err.status === 400) return t('error_invalid_email');
    }
    return t('error_generic');
  };

  return { role, trees, added, date, failure };
}

/** The normal sign-in page: an invitation lives on the address, not in the link. */
export function signInLink(): string {
  return `${window.location.origin}/auth/signin`;
}
