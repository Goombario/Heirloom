'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import ConfirmDialog from '@/app/components/ConfirmDialog';
import {
  Badge, Button, CopperPill, CoverBand, DataTable, EmptyState, FilterChip, InlineDataError, ListToolbar, MobileListHeader, PageShell,
  TablePanel, showErrorToast, showSuccessToast, type Column,
} from '@/app/components/ui';
import { useTree } from '@/app/contexts/TreeContext';
import { useDocumentTitle } from '@/app/hooks/useDocumentTitle';
import { useIsMobile } from '@/app/hooks/useIsMobile';
import { Plus, Shield } from '@/lib/icons';
import type { MemberListRow, MemberRole, MemberStatus } from '@/lib/db/queries/members';
import { AdminLog } from './AdminLog';
import { copySignInLink } from './CopySignInLink';
import { InviteMemberDialog } from './InviteMemberDialog';
import { MemberRowMenu, type MemberActions } from './MemberRowMenu';
import { memberName, useMemberText } from './memberText';
import {
  filterMembers, InviteMemberSheet, MemberAvatar, MemberSheet, MobileMemberRows, MobileMembersFilters, type PhoneView,
} from './MobileMembers';
import { OrphanMediaNotice } from './OrphanMediaNotice';
import { useMemberLog, useMembers, useOrphanMediaCheck } from './useMembers';

type Tab = 'members' | 'log';
type StatusFilter = 'all' | MemberStatus;

const STATUS_TONE: Record<MemberStatus, 'green' | 'warning' | 'outline'> = {
  active: 'green',
  invited: 'warning',
  revoked: 'outline',
};

/**
 * Members (#656, ADR 0029): who can sign in to this hosted site, admin only. Desktop
 * is a list page with two tabs, Members and Admin log, status chips and a ••• menu on
 * each row; the phone follows the list page kit. `?invite=` opens Invite with the
 * address filled in (Share tree's "Invite them too").
 */
export default function MembersPageClient() {
  const t = useTranslations('members');
  const tc = useTranslations('common');
  useDocumentTitle(t('title'));
  const router = useRouter();
  const params = useSearchParams();
  const isMobile = useIsMobile();
  const { currentUserId } = useTree();
  const api = useMembers();
  const text = useMemberText();

  const [tab, setTab] = useState<Tab>('members');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [phoneView, setPhoneView] = useState<PhoneView>('all');
  const [query, setQuery] = useState('');
  const prefill = params.get('invite') ?? '';
  const [inviting, setInviting] = useState(prefill !== '');
  // "Invite them too" can arrive while this page is already open.
  useEffect(() => { if (prefill) setInviting(true); }, [prefill]);
  const [revoking, setRevoking] = useState<MemberListRow | null>(null);
  const [revokeBusy, setRevokeBusy] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [openEmail, setOpenEmail] = useState<string | null>(null);
  const [logVersion, setLogVersion] = useState(0);
  const tabRefs = useRef(new Map<Tab, HTMLButtonElement>());

  const showLog = isMobile ? phoneView === 'log' : tab === 'log';
  const log = useMemberLog(showLog, logVersion);
  const orphans = useOrphanMediaCheck(showLog);

  const members = api.members;
  const activeAdmins = members.filter((m) => m.Role === 'admin' && m.Status === 'active').length;
  const isLastAdmin = (m: MemberListRow) => m.Role === 'admin' && m.Status === 'active' && activeAdmins <= 1;
  const counts = useMemo(() => ({
    active: members.filter((m) => m.Status === 'active').length,
    invited: members.filter((m) => m.Status === 'invited').length,
    revoked: members.filter((m) => m.Status === 'revoked').length,
  }), [members]);
  const [deskQuery, setDeskQuery] = useState('');
  const shown = useMemo(() => filterMembers(members, status, deskQuery), [members, status, deskQuery]);
  const phoneRows = useMemo(() => filterMembers(members, phoneView, query), [members, phoneView, query]);
  const openMember = members.find((m) => m.Id === openId || (openEmail !== null && m.Email === openEmail)) ?? null;

  const closeInvite = () => {
    setInviting(false);
    if (prefill) router.replace('/members');
  };
  const changed = () => setLogVersion((v) => v + 1);

  const actions: MemberActions = {
    onRole: async (m, role: MemberRole) => {
      try {
        await api.setRole(m.Id, role);
        changed();
        showSuccessToast(role === 'admin' ? t('done_role_admin', { name: memberName(m) }) : t('done_role_member', { name: memberName(m) }));
      } catch (err) {
        showErrorToast(text.failure(err));
      }
    },
    onRevoke: (m) => setRevoking(m),
    onRestore: async (m) => {
      try {
        await api.restore(m.Id);
        changed();
        showSuccessToast(t('done_restored', { name: memberName(m) }));
      } catch (err) {
        showErrorToast(text.failure(err));
      }
    },
    onCopyLink: () => void copySignInLink({ copied: t('copied'), failed: t('copy_failed') }),
    onCancelInvite: async (m) => {
      try {
        await api.cancelInvite(m.Id);
        changed();
        showSuccessToast(t('done_cancelled', { email: m.Email }));
      } catch (err) {
        showErrorToast(text.failure(err));
      }
    },
  };

  const columns: Column<MemberListRow>[] = [
    {
      key: 'person',
      header: t('col_person'),
      render: (m) => (
        <div className="flex items-center gap-2.5 min-w-0">
          <MemberAvatar member={m} size={32} />
          <div className="min-w-0">
            {m.Status === 'invited' ? (
              <>
                <div className="text-sm text-text truncate">{m.Email}</div>
                <div className="text-meta text-text-muted">{t('not_signed_in')}</div>
              </>
            ) : (
              <>
                <div className="serif text-base font-semibold text-text truncate">
                  {memberName(m)}
                  {m.UserId === currentUserId && <span className="ml-1.5 font-sans text-meta font-normal text-text-muted">{t('you')}</span>}
                </div>
                <div className="text-meta text-text-muted truncate">{m.Email}</div>
              </>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'role',
      header: t('col_role'),
      render: (m) => m.Role === 'admin'
        ? <Badge tone="neutral"><Shield className="w-3 h-3" aria-hidden="true" />{t('role_admin')}</Badge>
        : <span className="text-sm text-text-secondary">{t('role_member')}</span>,
    },
    {
      key: 'status',
      header: t('col_status'),
      render: (m) => <Badge tone={STATUS_TONE[m.Status]}>{t(`status_${m.Status}`)}</Badge>,
    },
    {
      key: 'trees',
      header: t('col_trees'),
      render: (m) => {
        const trees = text.trees(m);
        return trees ? <span className="text-sm">{trees}</span> : <span className="text-sm text-text-muted">{t('trees_none')}</span>;
      },
    },
    {
      key: 'last',
      header: t('col_last_sign_in'),
      render: (m) => {
        const day = text.date(m.LastSignInAt);
        return day ? <span className="date-mono text-meta">{day}</span> : <span className="text-sm text-text-muted">{t('never')}</span>;
      },
    },
    {
      key: 'added',
      header: t('col_added'),
      render: (m) => <span className="text-sm text-text-muted">{text.added(m)}</span>,
    },
    {
      key: 'menu',
      header: <span className="sr-only">{t('col_actions')}</span>,
      align: 'right',
      width: 48,
      render: (m) => <MemberRowMenu member={m} lastAdmin={isLastAdmin(m)} actions={actions} />,
    },
  ];

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'members', label: t('tab_members'), count: members.length },
    { id: 'log', label: t('tab_log') },
  ];
  const onTabKey = (e: React.KeyboardEvent, id: Tab) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const next = id === 'members' ? 'log' : 'members';
    setTab(next);
    tabRefs.current.get(next)?.focus();
  };

  const shell = {
    topBar: <MobileListHeader title={t('title')} />,
    contentClassName: 'max-md:p-0!',
  };
  // Desktop (#59): the short navy band, as on the other list pages.
  const band = (
    <div className="hidden md:block mb-4">
      <CoverBand
        variant="short"
        title={t('title')}
        meta={api.load === 'ready' ? <><span className="tabular-nums">{t('count', { count: members.length })}</span> · {t('subtitle')}</> : t('subtitle')}
      />
    </div>
  );

  if (api.load !== 'ready') {
    return (
      <PageShell {...shell} busy={api.load === 'loading'}>
        {band}
        <div className="max-md:p-4">
          {api.load === 'forbidden' && <EmptyState variant="empty" title={t('forbidden_title')} message={t('forbidden_body')} />}
          {api.load === 'error' && <InlineDataError message={t('load_failed')} retryLabel={tc('retry')} onRetry={() => void api.refresh()} />}
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell {...shell}>
      {band}
      {/* Phone */}
      <MobileMembersFilters query={query} onQuery={setQuery} view={phoneView} onView={setPhoneView} />
      {phoneView === 'log' ? (
        <div className="md:hidden pt-2">
          <OrphanMediaNotice check={orphans.check} failed={orphans.failed} />
          <AdminLog entries={log.entries} failed={log.failed} onRetry={changed} />
        </div>
      ) : (
        <MobileMemberRows rows={phoneRows} meId={currentUserId} onOpen={(m) => { setOpenEmail(null); setOpenId(m.Id); }} />
      )}
      <div className="h-24 md:hidden" aria-hidden="true" />
      <CopperPill floating icon={<Plus aria-hidden="true" />} onClick={() => setInviting(true)}>{t('invite_short')}</CopperPill>
      <MemberSheet
        member={isMobile ? openMember : null}
        lastAdmin={openMember ? isLastAdmin(openMember) : false}
        api={{ ...api, setRole: async (id, role) => { const r = await api.setRole(id, role); changed(); return r; } }}
        onClose={() => { setOpenId(null); setOpenEmail(null); }}
      />
      <InviteMemberSheet
        open={isMobile && inviting}
        initialEmail={prefill}
        api={api}
        onClose={closeInvite}
        onInvited={(email) => { changed(); setOpenEmail(email); }}
      />

      {/* Desktop */}
      <div className="hidden md:block">
        <div role="tablist" aria-label={t('tabs_label')} className="flex gap-0.5 border-b border-border mb-4">
          {tabs.map(({ id, label, count }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                ref={(node) => { if (node) tabRefs.current.set(id, node); else tabRefs.current.delete(id); }}
                type="button"
                role="tab"
                id={`members-tab-${id}`}
                aria-controls={`members-panel-${id}`}
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                onClick={() => setTab(id)}
                onKeyDown={(e) => onTabKey(e, id)}
                className={`min-h-11 px-3.5 -mb-px text-sm inline-flex items-center gap-1 cursor-pointer focus-ring-inset border-b-2 ${active ? 'border-primary text-text font-semibold' : 'border-transparent text-text-secondary'}`}
              >
                {label}
                {count !== undefined && <span className="font-mono text-xs text-text-muted font-normal"><span className="sr-only">, </span>{count}</span>}
              </button>
            );
          })}
        </div>

        {tab === 'members' ? (
          <div role="tabpanel" id="members-panel-members" aria-labelledby="members-tab-members" className="grid gap-4">
            <ListToolbar
              search={deskQuery}
              onSearchChange={setDeskQuery}
              searchLabel={t('filter_placeholder')}
              action={<Button variant="primary" icon={<Plus className="w-4 h-4" aria-hidden="true" />} onClick={() => setInviting(true)}>{t('invite')}</Button>}
              filters={<div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('filters_label')}>
              <FilterChip label={t('filter_all')} count={members.length} active={status === 'all'} onClick={() => setStatus('all')} />
              <FilterChip label={t('status_active')} count={counts.active} active={status === 'active'} onClick={() => setStatus('active')} />
              <FilterChip label={t('status_invited')} count={counts.invited} active={status === 'invited'} onClick={() => setStatus('invited')} />
              <FilterChip label={t('status_revoked')} count={counts.revoked} active={status === 'revoked'} onClick={() => setStatus('revoked')} />
              </div>}
            />
            <TablePanel page={1} pageSize={Math.max(1, shown.length)} total={shown.length} onPage={() => {}}>
              <DataTable
                columns={columns}
                rows={shown}
                rowKey={(m) => m.Id}
                rowClassName={(m) => (m.Status === 'revoked' ? 'opacity-70' : undefined)}
                empty={<p className="m-0 px-4 py-8 text-center text-sm text-text-muted">{t('empty_filtered')}</p>}
              />
            </TablePanel>
          </div>
        ) : (
          <div role="tabpanel" id="members-panel-log" aria-labelledby="members-tab-log">
            <OrphanMediaNotice check={orphans.check} failed={orphans.failed} />
            <AdminLog entries={log.entries} failed={log.failed} onRetry={changed} />
          </div>
        )}
      </div>

      <InviteMemberDialog
        open={!isMobile && inviting}
        initialEmail={prefill}
        onClose={closeInvite}
        onInvite={async (email, role) => { await api.invite(email, role); changed(); }}
      />
      <ConfirmDialog
        open={revoking !== null}
        variant="calm"
        tone="danger"
        title={revoking ? t('revoke_title', { name: memberName(revoking) }) : ''}
        body={revoking ? t('revoke_body', { name: memberName(revoking) }) : ''}
        bullets={revoking ? [t('revoke_bullet_kept', { name: memberName(revoking) }), t('revoke_bullet_shares', { name: memberName(revoking) })] : []}
        confirmLabel={t('revoke_row')}
        cancelLabel={t('keep')}
        busy={revokeBusy}
        onCancel={() => setRevoking(null)}
        onConfirm={async () => {
          if (!revoking) return;
          setRevokeBusy(true);
          try {
            await api.revoke(revoking.Id);
            changed();
            showSuccessToast(t('done_revoked', { name: memberName(revoking) }));
            setRevoking(null);
          } catch (err) {
            showErrorToast(text.failure(err));
          } finally {
            setRevokeBusy(false);
          }
        }}
      />
    </PageShell>
  );
}
