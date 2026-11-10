'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, Lock, Mail } from '@/lib/icons';
import { CopperPill, MobileRow, RadioRow, cx } from '@/app/components/ui';
import { ConfirmSheet, Sheet } from '@/app/components/ui/Sheet';
import { Avatar } from '@/app/components/ui/Avatar';
import { ROLES, type Role } from '@/app/components/RolePicker';
import { NotMemberBanner } from './NotMemberBanner';

interface ShareMember {
    /** Unique across shares and pending shares. */
    id: string;
    name: string;
    email: string;
    role: Role;
    /** An address with no account yet (#1228): the share applies at their first sign-in. */
    pending?: boolean;
}

/** A plausible address: something@something.tld. The server has the final word. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Share tree on a phone (#1125): a page, not a modal. A one-row header with Back and
 * "Share tree", then "Sharing {tree}". The invite is an email field, a role picker field
 * whose description shows as a hint, and the copper Invite pill. People with access list
 * the owner first, then each member with the role word; tapping a member opens a sheet with
 * the role radios and a red Remove access behind a confirm card.
 */
export function MobileShareSheet({ open, onClose, treeName, notice = null, owner, members, error, busy, revokingId, onInvite, onRole, onRevoke }: {
    open: boolean;
    onClose: () => void;
    treeName: string | null;
    /** Why this isn't the tree on screen: opened from a tree shared with the user (#932). */
    notice?: string | null;
    owner: { name: string; email: string | null };
    members: ShareMember[];
    error: string | null;
    busy: boolean;
    revokingId: string | null;
    onInvite: (email: string, role: Role) => Promise<boolean>;
    onRole: (id: string, role: Role) => Promise<void>;
    onRevoke: (id: string) => Promise<void>;
}) {
    const t = useTranslations('shareTree');
    const tm = useTranslations('mobileShare');
    const tc = useTranslations('common');
    const ids = useId();
    const [email, setEmail] = useState('');
    const [role, setRole] = useState<Role>('view');
    const [sheet, setSheet] = useState<'role' | 'member' | 'revoke' | null>(null);
    const [memberId, setMemberId] = useState<string | null>(null);
    const member = members.find((m) => m.id === memberId) ?? null;
    const roleLabel = (r: Role) => t(ROLES.find((x) => x.key === r)!.labelKey as Parameters<typeof t>[0]);
    const roleDesc = (r: Role) => t(ROLES.find((x) => x.key === r)!.descKey as Parameters<typeof t>[0]);
    const valid = EMAIL.test(email.trim());

    return (
        <Sheet open={open} onClose={onClose} onBack={onClose} title={tm('title')} size="screen">
            <div className="-mx-4 -mt-3 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]">
                {treeName && <h2 className="m-0 px-4 pt-[18px] serif text-xl font-semibold leading-tight">{tm('sharing', { name: treeName })}</h2>}
                <p className="m-0 px-4 pt-1 text-sm text-text-muted">{t('modal_subtitle')}</p>
                {notice && <p role="note" className="m-0 mx-4 mt-3 rounded-lg px-3.5 py-2.5 text-sm bg-card-alt text-text-secondary">{notice}</p>}

                {error && <p role="alert" className="m-0 mx-4 mt-3 rounded-lg px-3.5 py-2.5 text-sm bg-error-bg text-error">{error}</p>}

                <form className="px-4 pt-4 grid gap-2.5" onSubmit={async (e) => {
                    e.preventDefault();
                    if (!valid || busy) return;
                    if (await onInvite(email.trim(), role)) { setEmail(''); setRole('view'); }
                }}>
                    <label htmlFor={`${ids}-email`} className="text-meta font-semibold text-text-secondary">{t('email_label')}</label>
                    <div className="relative">
                        <Mail className="absolute left-3.5 top-[14px] w-[18px] h-[18px] text-text-muted pointer-events-none" aria-hidden="true" />
                        <input id={`${ids}-email`} type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)}
                            placeholder={t('invite_placeholder')}
                            className="w-full h-[46px] rounded-[10px] border border-border bg-card pl-10 pr-3 text-md text-text input-nozoom focus-ring" />
                    </div>
                    <NotMemberBanner email={email} onNavigate={onClose} />
                    <button type="button" onClick={() => setSheet('role')} aria-haspopup="dialog"
                        className="flex items-center gap-2 w-full h-11 px-3.5 rounded-[10px] border border-border bg-card text-left text-md text-text cursor-pointer focus-ring">
                        <span className="text-sm text-text-muted">{tm('access')}</span>
                        <span className="flex-1 min-w-0 truncate font-semibold">{roleLabel(role)}</span>
                        <ChevronDown className="w-[18px] h-[18px] text-text-muted shrink-0" aria-hidden="true" />
                    </button>
                    <p className="m-0 text-meta text-text-muted">{roleDesc(role)}</p>
                    <CopperPill type="submit" disabled={!valid || busy} className="mt-1">{busy ? t('sharing') : t('invite_button')}</CopperPill>
                </form>

                <h3 className="eyebrow m-0 px-4 pt-6 pb-1.5">{t('access_count', { count: members.length })}</h3>
                <MobileRow lead={<Avatar name={owner.name} size={40} />}
                    label={<span className="font-semibold">{owner.name}</span>} sub={owner.email ?? undefined}
                    value={tm('owner_you')} />
                {members.map((m) => (
                    <MobileRow key={m.id} divided lead={<Avatar name={m.name} size={40} />}
                        label={<span className="font-semibold">{m.name}</span>} sub={m.pending ? t('pending_sub') : m.email !== m.name ? m.email : undefined}
                        value={roleLabel(m.role)} end="chevron" disabled={revokingId === m.id}
                        onClick={() => { setMemberId(m.id); setSheet('member'); }} />
                ))}
                {members.length === 0 && (
                    <div className="grid justify-items-center gap-1 px-6 pt-6 pb-2 text-center">
                        <b className="serif text-lg font-semibold">{t('empty_title')}</b>
                        <p className="m-0 max-w-[32ch] text-sm text-text-muted">{t('empty_body')}</p>
                    </div>
                )}

                <p className="m-0 mt-6 mx-4 flex items-center gap-2 pt-3 border-t border-border text-meta text-text-muted">
                    <Lock className="w-4 h-4 shrink-0" aria-hidden="true" />{t('privacy_note')}
                </p>
            </div>

            <Sheet open={sheet === 'role'} onClose={() => setSheet(null)} title={t('permission_label')}>
                <div role="radiogroup" aria-label={t('permission_label')} className="-mx-4 -mt-3">
                    {ROLES.map((r, i) => (
                        <RadioRow key={r.key} checked={role === r.key} label={roleLabel(r.key)} hint={roleDesc(r.key)} divided={i > 0}
                            onSelect={() => { setRole(r.key); setSheet(null); }} />
                    ))}
                </div>
            </Sheet>

            <Sheet open={sheet === 'member' && member != null} onClose={() => setSheet(null)} title={member?.name ?? ''}>
                {member && (
                    <div className="-mx-4 -mt-3">
                        <div role="radiogroup" aria-label={t('role_label', { email: member.email || member.name })}>
                            {ROLES.map((r, i) => (
                                <RadioRow key={r.key} checked={member.role === r.key} label={roleLabel(r.key)} hint={roleDesc(r.key)} divided={i > 0}
                                    onSelect={() => { setSheet(null); if (r.key !== member.role) void onRole(member.id, r.key); }} />
                            ))}
                        </div>
                        <div className={cx('mt-2 border-t border-border')}>
                            <MobileRow tone="danger" label={t('remove_access')} sub={t('remove_access_desc')} onClick={() => setSheet('revoke')} />
                        </div>
                    </div>
                )}
            </Sheet>
            <ConfirmSheet open={sheet === 'revoke' && member != null} title={t('revoke_confirm_title')}
                body={member ? tm('revoke_body', { name: member.name, tree: treeName ?? '' }) : ''}
                confirmLabel={t('remove_access')} keepLabel={tc('cancel')} busy={revokingId != null}
                onConfirm={async () => { if (member) await onRevoke(member.id); setSheet(null); }}
                onClose={() => setSheet(null)} />
        </Sheet>
    );
}
