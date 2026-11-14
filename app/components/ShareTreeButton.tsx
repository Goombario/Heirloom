'use client';

import { useState, useEffect, useCallback, useId } from 'react';
import { useSession } from 'next-auth/react';
import { useTranslations } from 'next-intl';
import { useTreeDisplayName } from '@/app/hooks/useTreeDisplayName';
import { DATA_MODE } from '@/lib/data';
import { useDesktopMode } from '@/app/hooks/useDesktopMode';
import { useTree } from '@/app/contexts/TreeContext';
import { useMyTrees } from '@/app/hooks/useMyTrees';
import { X, Mail, Lock, Users, Info } from '@/lib/icons';
import Modal from '@/app/components/Modal';
import ConfirmDialog from '@/app/components/ConfirmDialog';
import RolePicker, { ROLES, type Role } from '@/app/components/RolePicker';
import { Button } from '@/app/components/ui/Button';
import { Input } from '@/app/components/ui/Input';
import { Badge } from '@/app/components/ui/Badge';
import { Avatar } from '@/app/components/ui/Avatar';
import { Select } from '@/app/components/ui/Select';
import { showChangeToast } from '@/app/components/ui/Toast';
import { useIsMobile } from '@/app/hooks/useIsMobile';
import { MobileShareSheet } from '@/app/components/share/MobileShareSheet';
import { NotMemberBanner } from '@/app/components/share/NotMemberBanner';
import { ScrollArea } from '@/app/components/ui';

interface Share {
  Id: number;
  OwnerId: number;
  SharedWithId: number;
  /** The shared tree (null only on pre-backfill legacy rows = default tree). */
  TreeId: number | null;
  TreeName: string | null;
  Permission: Role;
  CreatedAt: string;
  sharedWithUser: {
    Id: number;
    Email: string;
    Name: string | null;
  } | null;
}

/** A share for an address with no account yet (#1228); applied at their first sign-in. */
interface PendingShare {
  Id: number;
  TreeId: number;
  Email: string;
  Permission: Role;
}

/** One roster row: a real share or a pending one. `key` is unique across both. */
interface Grant {
  key: string;
  pending: boolean;
  id: number;
  treeId: number | null;
  name: string;
  email: string;
  permission: Role;
}

function grantsOf(shares: Share[], pending: PendingShare[]): Grant[] {
  return [
    ...shares.map((share) => ({
      key: `s${share.Id}`,
      pending: false,
      id: share.Id,
      treeId: share.TreeId,
      name: share.sharedWithUser?.Name || share.sharedWithUser?.Email || '',
      email: share.sharedWithUser?.Email || '',
      permission: share.Permission,
    })),
    ...pending.map((row) => ({
      key: `p${row.Id}`,
      pending: true,
      id: row.Id,
      treeId: row.TreeId,
      name: row.Email,
      email: row.Email,
      permission: row.Permission,
    })),
  ];
}

const grantUrl = (grant: Grant) => (grant.pending ? `/api/sharing/pending/${grant.id}` : `/api/sharing/${grant.id}`);

interface ShareTreeButtonProps {
  forceOpen?: boolean;
  onClose?: () => void;
  /** Portal the modal to document.body at z-80 (above the mobile nav drawer).
   *  Used when opened from the drawer, whose Vaul `transform` would otherwise
   *  trap a non-elevated `position:fixed` overlay inside the 308px panel. */
  elevated?: boolean;
}

export default function ShareTreeButton({ forceOpen, onClose, elevated }: ShareTreeButtonProps) {
  const { data: session } = useSession();
  const isDesktop = useDesktopMode();
  const { activeTreeId, activeTreeName, activeOwnerName } = useTree();
  const { trees: myTrees } = useMyTrees();
  const [isOpen, setIsOpen] = useState(false);
  // A tree picked in the modal (#932); null = the default below. Reset on close.
  const [pickedTreeId, setPickedTreeId] = useState<number | null>(null);
  const [email, setEmail] = useState('');
  const [permission, setPermission] = useState<Role>('view');
  const [grants, setGrants] = useState<Grant[]>([]);
  const [loading, setLoading] = useState(false);
  const [revokingKey, setRevokingKey] = useState<string | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<Grant | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const t = useTranslations('shareTree');
  const tc = useTranslations('common');
  const treeName = useTreeDisplayName();
  const titleId = useId();
  const isMobile = useIsMobile();

  // The modal always shares a tree the user OWNS: the one picked in the modal,
  // else the active tree when it's one of their own, otherwise their default
  // tree (index 0 — trees are Id ASC). Only the owner may share a tree
  // (createShareService). null (trees not loaded yet) lets the server default
  // to the default tree.
  const defaultTreeId = myTrees[0]?.Id ?? null;
  const ownsActive = activeTreeId != null && myTrees.some((tree) => tree.Id === activeTreeId);
  const picked = pickedTreeId != null && myTrees.some((tree) => tree.Id === pickedTreeId) ? pickedTreeId : null;
  const shareTreeId = picked ?? (ownsActive ? activeTreeId : defaultTreeId);
  const shareTreeName = treeName(myTrees.find((tree) => tree.Id === shareTreeId)?.Name);
  // Opened from a tree shared with the user: say why another tree is selected
  // instead of switching silently (#932).
  const fallbackNote = activeTreeId != null && !ownsActive && myTrees.length > 0
    ? (activeOwnerName
      ? t('not_your_tree', { tree: treeName(activeTreeName) ?? '', owner: activeOwnerName })
      : t('not_your_tree_no_owner', { tree: treeName(activeTreeName) ?? '' }))
    : null;

  // Roster scoped to the tree being shared (legacy null-TreeId rows = default tree).
  const visibleShares = shareTreeId == null
    ? grants
    : grants.filter((grant) => (grant.treeId ?? defaultTreeId) === shareTreeId);

  useEffect(() => {
    if (forceOpen) setIsOpen(true);
  }, [forceOpen]);

  const loadShares = useCallback(async () => {
    try {
      const response = await fetch('/api/sharing');
      if (!response.ok) {
        throw new Error('Failed to load shares');
      }
      const data = await response.json() as { shares?: Share[]; pending?: PendingShare[] };
      setGrants(grantsOf(data.shares || [], data.pending || []));
    } catch (err) {
      console.error('Error loading shares:', err);
      setGrants([]);
      setError(t('failed_load'));
    }
  }, [t]);

  // Fetch shares when modal opens
  useEffect(() => {
    if (isOpen && session) {
      loadShares();
    }
  }, [isOpen, session, loadShares]);

  const roleLabel = useCallback(
    (role: Role) => {
      const entry = ROLES.find((r) => r.key === role);
      return entry ? t(entry.labelKey as Parameters<typeof t>[0]) : role;
    },
    [t],
  );

  const handleClose = useCallback(() => {
    setIsOpen(false);
    setPickedTreeId(null);
    onClose?.();
  }, [onClose]);

  const handleShare = async (e: React.FormEvent) => {
    e.preventDefault();
    await invite(email, permission);
  };

  /** Resolves whether the invite went through. */
  const invite = async (invitedEmail: string, role: Role): Promise<boolean> => {
    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      const response = await fetch('/api/sharing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: invitedEmail, permission: role, treeId: shareTreeId }),
      });

      const data = await response.json() as { error?: string; pending?: PendingShare };
      if (!response.ok) {
        throw new Error(data.error || t('failed_share'));
      }

      const message = data.pending
        ? t('pending_hint', { email: invitedEmail })
        : t('invited_hint', { email: invitedEmail });
      if (isMobile) showChangeToast({ message });
      else setSuccess(message);
      setEmail('');
      setPermission('view');
      await loadShares(); // Reload shares list
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failed_share'));
      return false;
    } finally {
      setLoading(false);
    }
  };

  const handleRoleChange = async (grant: Grant, role: Role) => {
    setError(null);
    setSuccess(null);
    const userEmail = grant.email;
    try {
      const response = await fetch(grantUrl(grant), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permission: role }),
      });

      if (!response.ok) {
        throw new Error(t('failed_role'));
      }

      if (isMobile) showChangeToast({ message: t('role_changed', { email: userEmail, role: roleLabel(role) }) });
      else setSuccess(t('role_changed', { email: userEmail, role: roleLabel(role) }));
      await loadShares();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failed_role'));
      await loadShares();
    }
  };

  const handleRevoke = async (target = pendingRevoke) => {
    if (!target) return;
    const userEmail = target.email || target.name;

    setRevokingKey(target.key);
    try {
      const response = await fetch(grantUrl(target), {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error(t('failed_revoke'));
      }

      if (isMobile) showChangeToast({ message: t('revoke_success', { email: userEmail }) });
      else setSuccess(t('revoke_success', { email: userEmail }));
      await loadShares();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failed_revoke'));
      await loadShares();
    } finally {
      setRevokingKey(null);
      setPendingRevoke(null);
    }
  };

  // Deployment-mode gating (spec §6): sharing is authenticated-web-only.
  // Local/static (no /api/sharing) and desktop (dead backend) never mount the
  // modal; no session ⇒ no modal. Hooks above run unconditionally first.
  if (DATA_MODE === 'local' || isDesktop || !session) {
    return null;
  }

  if (isMobile) {
    const memberOf = (grant: Grant) => ({
      id: grant.key,
      name: grant.name,
      email: grant.email,
      role: grant.permission,
      pending: grant.pending,
    });
    const grantFor = (key: string) => visibleShares.find((grant) => grant.key === key);
    return (
      <MobileShareSheet
        open={isOpen}
        onClose={handleClose}
        treeName={shareTreeName || null}
        notice={fallbackNote}
        owner={{ name: session.user?.name || t('you'), email: session.user?.email ?? null }}
        members={visibleShares.map(memberOf)}
        error={error}
        busy={loading}
        revokingId={revokingKey}
        onInvite={invite}
        onRole={async (key, role) => {
          const grant = grantFor(key);
          if (grant) await handleRoleChange(grant, role);
        }}
        onRevoke={async (key) => {
          const grant = grantFor(key);
          if (grant) await handleRevoke(grant);
        }}
      />
    );
  }

  return (
    <>
      <Modal open={isOpen} onClose={handleClose} size="md" labelledBy={titleId} elevated={elevated}>
        <div className="bg-card rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[86vh]">
          {/* Header */}
          <div className="flex items-start justify-between gap-4 p-5 border-b border-border">
            <div className="min-w-0">
              {/* The tree being shared is the title, not a subtitle-weight line,
                  so nobody invites someone to the wrong tree (#932). */}
              <h2 id={titleId} className="serif text-xl font-semibold text-text break-words">
                {shareTreeName
                  ? t.rich('modal_title_tree', { name: shareTreeName, tree: (chunks) => <span className="italic">{chunks}</span> })
                  : t('modal_title')}
              </h2>
              <p className="mt-1 text-sm text-text-secondary">{t('modal_subtitle')}</p>
              {myTrees.length > 1 && (
                <Select<number>
                  className="mt-3"
                  label={t('tree_picker_label')}
                  valueLabel={shareTreeName}
                  options={myTrees.map((tree) => ({ key: String(tree.Id), value: tree.Id, label: treeName(tree.Name) }))}
                  isSelected={(id) => id === shareTreeId}
                  onSelect={(id) => { setPickedTreeId(id); setSuccess(null); setError(null); }}
                />
              )}
            </div>
            <button
              type="button"
              onClick={handleClose}
              aria-label={tc('close')}
              title={tc('close')}
              className="shrink-0 flex items-center justify-center w-11 h-11 -mr-2 -mt-2 rounded-full text-text-muted hover:bg-hover-surface hover:text-text transition-colors focus-ring"
            >
              <X className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>

          {/* Body */}
          <ScrollArea className="p-5 flex-1">
            {fallbackNote && (
              <p role="note" className="mb-4 p-3 rounded-lg bg-card-alt text-sm text-text-secondary flex gap-2 items-start">
                <Info className="w-4 h-4 shrink-0 mt-0.5 text-text-muted" aria-hidden="true" />
                <span>{fallbackNote}</span>
              </p>
            )}
            {/* Status callouts */}
            {error && (
              <div role="alert" className="mb-4 p-3 rounded-lg bg-error-bg text-error text-sm">
                {error}
              </div>
            )}
            {success && (
              <div role="status" className="mb-4 p-3 rounded-lg bg-success-bg text-success text-sm">
                {success}
              </div>
            )}

            {/* Invite row */}
            <form onSubmit={handleShare} className="mb-6">
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('invite_placeholder')}
                required
                aria-label={t('email_label')}
                icon={<Mail className="w-4 h-4" aria-hidden="true" />}
                wrapClassName="mb-3"
              />
              <NotMemberBanner email={email} onNavigate={handleClose} className="mb-3" />
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <RolePicker
                  value={permission}
                  onChange={setPermission}
                  triggerLabel={t('permission_label')}
                />
                <Button type="submit" disabled={loading} className="sm:ml-auto justify-center">
                  {loading ? t('sharing') : t('invite_button')}
                </Button>
              </div>
            </form>

            {/* Roster */}
            <div>
              <p className="eyebrow mb-3">
                {t('access_count', { count: visibleShares.length })}
              </p>

              <div className="space-y-1">
                {/* Owner row (pinned) */}
                <div className="flex items-center gap-3 p-2 rounded-lg">
                  <Avatar name={session.user?.name || t('you')} size={40} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-text truncate">
                      {session.user?.name || t('you')}
                    </p>
                    {session.user?.email && (
                      <p className="text-sm text-text-secondary truncate">{session.user.email}</p>
                    )}
                  </div>
                  <Badge tone="neutral">{t('owner')}</Badge>
                </div>

                {/* Collaborator rows / empty state */}
                {visibleShares.length === 0 ? (
                  <div className="text-center py-8 px-4">
                    <div className="w-12 h-12 rounded-full bg-card-alt mx-auto mb-3 flex items-center justify-center">
                      <Users className="w-6 h-6 text-text-muted" aria-hidden="true" />
                    </div>
                    <p className="font-medium text-text">{t('empty_title')}</p>
                    <p className="mt-1 text-sm text-text-secondary">{t('empty_body')}</p>
                  </div>
                ) : (
                  visibleShares.map((grant, index) => {
                    const { name, email: userEmail } = grant;
                    return (
                      <div key={grant.key} className="flex items-center gap-3 p-2 rounded-lg">
                        <Avatar name={name} size={40} />
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-text truncate">{name}</p>
                          {grant.pending ? (
                            <p className="text-sm text-text-secondary truncate">{t('pending_sub')}</p>
                          ) : userEmail && (
                            <p className="text-sm text-text-secondary truncate">{userEmail}</p>
                          )}
                        </div>
                        <RolePicker
                          value={grant.permission}
                          onChange={(role) => handleRoleChange(grant, role)}
                          onRemove={() => setPendingRevoke(grant)}
                          dropUp={visibleShares.length > 2 && index >= visibleShares.length / 2}
                          disabled={revokingKey === grant.key}
                          triggerLabel={t('role_label', { email: userEmail || name })}
                        />
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </ScrollArea>

          {/* Footer */}
          <div className="flex items-center gap-2 p-4 border-t border-border bg-card-alt">
            <Lock className="w-4 h-4 shrink-0 text-text-muted" aria-hidden="true" />
            <span className="text-xs text-text-secondary">{t('privacy_note')}</span>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={pendingRevoke != null}
        variant="calm"
        tone="danger"
        title={t('revoke_confirm_title')}
        body={pendingRevoke ? t('revoke_confirm', { email: pendingRevoke.email || pendingRevoke.name }) : ''}
        confirmLabel={tc('confirm')}
        busy={revokingKey != null}
        elevated
        onConfirm={() => handleRevoke()}
        onCancel={() => setPendingRevoke(null)}
      />
    </>
  );
}
