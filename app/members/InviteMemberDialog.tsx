'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import Modal from '@/app/components/Modal';
import { Banner, Button, DialogActions, DialogHeader, Input } from '@/app/components/ui';
import { Info } from '@/lib/icons';
import type { MemberRole } from '@/lib/db/queries/members';
import { CopySignInLink } from './CopySignInLink';
import { useMemberText } from './memberText';
import { RolePickerRows } from './RolePickerRows';

/**
 * Invite member (desktop): a Google address and the role as radio rows, Member first.
 * No email goes out; the next step offers the normal sign-in link to send yourself.
 */
export function InviteMemberDialog({ open, initialEmail = '', onClose, onInvite }: {
  open: boolean;
  /** Share tree's "Invite them too" arrives with the address filled in. */
  initialEmail?: string;
  onClose: () => void;
  onInvite: (email: string, role: MemberRole) => Promise<unknown>;
}) {
  if (!open) return null;
  return <InviteMemberDialogBody initialEmail={initialEmail} onClose={onClose} onInvite={onInvite} />;
}

function InviteMemberDialogBody({ initialEmail, onClose, onInvite }: {
  initialEmail: string;
  onClose: () => void;
  onInvite: (email: string, role: MemberRole) => Promise<unknown>;
}) {
  const t = useTranslations('members');
  const tc = useTranslations('common');
  const text = useMemberText();
  const titleId = useId();
  const [email, setEmail] = useState(initialEmail);
  const [role, setRole] = useState<MemberRole>('member');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invited, setInvited] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onInvite(email, role);
      setInvited(email.trim().toLowerCase());
    } catch (err) {
      setError(text.failure(err));
    } finally {
      setBusy(false);
    }
  };

  if (invited) {
    const name = invited.split('@')[0];
    return (
      <Modal open onClose={onClose} labelledBy={titleId}>
        <div className="bg-card rounded-2xl shadow-xl overflow-hidden">
          <div className="p-6 grid gap-4">
            <DialogHeader title={t('invited_title', { name })} titleId={titleId} onClose={onClose} />
            <p className="m-0 text-text-secondary">
              {t.rich('invited_body', { name, email: invited, b: (c) => <b className="text-text">{c}</b> })}
            </p>
            <CopySignInLink />
            <p className="m-0 text-meta text-text-muted">{t('invited_hint', { name })}</p>
          </div>
          <DialogActions>
            <Button variant="primary" onClick={onClose}>{tc('done')}</Button>
          </DialogActions>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} disableClose={busy} labelledBy={titleId}>
      <form onSubmit={submit} className="bg-card rounded-2xl shadow-xl overflow-hidden" noValidate>
        <div className="p-6 grid gap-4">
          <DialogHeader title={t('invite_title')} titleId={titleId} onClose={onClose} closeDisabled={busy} />
          <Input
            type="email"
            label={t('email_label')}
            hint={t('email_hint')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            required
          />
          <div>
            <span className="block text-sm font-medium text-text-secondary mb-1.5">{t('role_label')}</span>
            <RolePickerBox role={role} onChange={setRole} />
          </div>
          <Banner tone="info" icon={<Info className="w-4 h-4" />}>{t('invite_note')}</Banner>
          {error && <Banner tone="error">{error}</Banner>}
        </div>
        <DialogActions>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>{tc('cancel')}</Button>
          <Button type="submit" variant="primary" disabled={busy || !email.trim()}>{t('invite_short')}</Button>
        </DialogActions>
      </form>
    </Modal>
  );
}

function RolePickerBox({ role, onChange }: { role: MemberRole; onChange: (role: MemberRole) => void }) {
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <RolePickerRows value={role} onChange={onChange} />
    </div>
  );
}
