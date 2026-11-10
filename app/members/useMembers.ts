'use client';

import { useCallback, useEffect, useState } from 'react';
import type { MemberListRow, MemberLogRow, MemberRole, MemberRow } from '@/lib/db/queries/members';
import type { OrphanMediaCheck } from '@/lib/services/orphan-media-check';

/*
 * The Members page's data (#656): the list, the admin log, and the five changes.
 * Hosted only, so it talks to /api/members directly, as Share tree does with
 * /api/sharing. Every route re-checks that the caller is an active admin.
 */

export type MembersLoad = 'loading' | 'ready' | 'forbidden' | 'error';

/** A refused change, with the server's reason code when it gave one. */
export class MemberActionError extends Error {
  constructor(readonly status: number, readonly code: string | null, message: string) {
    super(message);
  }
}

async function send<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new MemberActionError(res.status, data.code ?? null, data.error ?? 'Request failed');
  return data as T;
}

export function useMembers() {
  const [members, setMembers] = useState<MemberListRow[]>([]);
  const [load, setLoad] = useState<MembersLoad>('loading');

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/members');
      if (res.status === 401 || res.status === 403 || res.status === 404) {
        setLoad('forbidden');
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json() as { members: MemberListRow[] };
      setMembers(data.members);
      setLoad('ready');
    } catch {
      setLoad((prev) => (prev === 'ready' ? prev : 'error'));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = useCallback(async <T,>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } finally {
      void refresh();
    }
  }, [refresh]);

  return {
    members,
    load,
    refresh,
    invite: (email: string, role: MemberRole) =>
      run(() => send<{ member: MemberRow }>('/api/members', { method: 'POST', body: JSON.stringify({ email, role }) })),
    setRole: (id: number, role: MemberRole) =>
      run(() => send<{ member: MemberRow }>(`/api/members/${id}`, { method: 'PATCH', body: JSON.stringify({ role }) })),
    revoke: (id: number) =>
      run(() => send<{ member: MemberRow }>(`/api/members/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'revoked' }) })),
    restore: (id: number) =>
      run(() => send<{ member: MemberRow }>(`/api/members/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'active' }) })),
    cancelInvite: (id: number) =>
      run(() => send<{ success: true }>(`/api/members/${id}`, { method: 'DELETE' })),
  };
}

/** The admin log, newest first, fetched when its tab first opens. */
export function useMemberLog(open: boolean, version: number) {
  const [entries, setEntries] = useState<MemberLogRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!open) return;
    let live = true;
    fetch('/api/members/log?pageSize=200')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: { entries: MemberLogRow[] }) => { if (live) { setEntries(data.entries); setFailed(false); } })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [open, version]);
  return { entries, failed };
}

/** The latest scheduled orphan media dry run (#946), fetched with the admin log. */
export function useOrphanMediaCheck(open: boolean) {
  const [check, setCheck] = useState<OrphanMediaCheck | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!open) return;
    let live = true;
    fetch('/api/members/orphan-media')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: { check: OrphanMediaCheck }) => { if (live) { setCheck(data.check); setFailed(false); } })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [open]);
  return { check, failed };
}
