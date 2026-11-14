'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { getDataClient } from '@/lib/data';
import type { Repository } from '@/lib/data/types';
import { useTree } from '@/app/contexts/TreeContext';
import { useErrorToast } from '@/app/components/useErrorToast';
import { MobileRow, showChangeToast } from '@/app/components/ui';
import { ConfirmSheet, Sheet } from '@/app/components/ui/Sheet';
import { Trash2 } from '@/lib/icons';

const CONTACTS = [
    { key: 'Website', type: 'url', label: 'repo_field_website', inputMode: 'url' },
    { key: 'Phone', type: 'tel', label: 'repo_field_phone', inputMode: 'tel' },
    { key: 'Email', type: 'email', label: 'repo_field_email', inputMode: 'email' },
] as const;

/**
 * The phone repository sheet (#1119): Name, Address, Website, Phone and Email (ADR 0049), Save as the copper pill, and
 * for an existing repository Delete as the last red row, which asks once. Its sources
 * stay, just without a repository.
 */
export function RepositorySheet(props: {
    open: boolean;
    /** The repository to edit, or null to add one. */
    repository: Repository | null;
    onClose: () => void;
    onSaved: (id: number) => void;
    onDeleted?: () => void;
    canDelete?: boolean;
}) {
    // A fresh form on every open.
    const [opened, setOpened] = useState(0);
    const [wasOpen, setWasOpen] = useState(props.open);
    if (props.open !== wasOpen) { setWasOpen(props.open); if (props.open) setOpened((n) => n + 1); }
    return <Body key={opened} {...props} />;
}

function Body({ open, repository, onClose, onSaved, onDeleted, canDelete = false }: Parameters<typeof RepositorySheet>[0]) {
    const t = useTranslations('library');
    const tm = useTranslations('mobileLibrary');
    const { activeTreeId } = useTree();
    const { reportError } = useErrorToast();
    const ids = useId();
    const [name, setName] = useState(repository?.Name ?? '');
    const [address, setAddress] = useState(repository?.Address ?? '');
    const [contacts, setContacts] = useState({
        Website: repository?.Website ?? '', Phone: repository?.Phone ?? '', Email: repository?.Email ?? '',
    });
    const [busy, setBusy] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const dirty = name.trim() !== (repository?.Name ?? '') || address.trim() !== (repository?.Address ?? '')
        || CONTACTS.some(({ key }) => contacts[key].trim() !== (repository?.[key] ?? ''));

    const save = async () => {
        if (!name.trim() || busy) return;
        setBusy(true);
        try {
            const client = await getDataClient();
            const input = {
                Name: name.trim(), Address: address.trim() || null,
                Website: contacts.Website.trim() || null, Phone: contacts.Phone.trim() || null, Email: contacts.Email.trim() || null,
            };
            const saved = repository
                ? await client.repositories.update(repository.Id, input, activeTreeId)
                : await client.repositories.create(input, activeTreeId);
            showChangeToast({ message: repository ? tm('repo_saved') : tm('repo_added') });
            onSaved(saved.Id);
        } catch (e) {
            reportError(e);
        } finally {
            setBusy(false);
        }
    };
    const remove = async () => {
        if (!repository) return;
        setBusy(true);
        try {
            const client = await getDataClient();
            await client.repositories.remove(repository.Id, activeTreeId);
            showChangeToast({ message: tm('repo_deleted') });
            setConfirming(false);
            onDeleted?.();
        } catch (e) {
            reportError(e);
        } finally {
            setBusy(false);
        }
    };

    const field = 'w-full h-11 rounded-[10px] border border-border bg-surface px-3 text-md text-text placeholder:text-text-muted input-nozoom focus-ring';
    return (
        <Sheet open={open} onClose={onClose} title={repository ? tm('edit_repository') : t('repo_create_title')} size="full"
            dirty={dirty} onSave={save} saveDisabled={busy || !name.trim()}>
            <div className="grid gap-4 pt-1">
                <label className="grid gap-1.5" htmlFor={`${ids}-name`}>
                    <span className="text-meta font-semibold text-text-secondary">{t('repo_field_name')}</span>
                    <input id={`${ids}-name`} className={field} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" maxLength={500} />
                </label>
                <label className="grid gap-1.5" htmlFor={`${ids}-address`}>
                    <span className="text-meta font-semibold text-text-secondary">{t('repo_field_address')} <span className="font-normal text-text-muted">· {tm('optional')}</span></span>
                    <input id={`${ids}-address`} className={field} value={address} onChange={(e) => setAddress(e.target.value)} placeholder={t('repo_address_placeholder')} autoComplete="off" />
                </label>
                {CONTACTS.map(({ key, type, label, inputMode }) => (
                    <label key={key} className="grid gap-1.5" htmlFor={`${ids}-${key}`}>
                        <span className="text-meta font-semibold text-text-secondary">{t(label)} <span className="font-normal text-text-muted">· {tm('optional')}</span></span>
                        <input id={`${ids}-${key}`} className={field} type={type} inputMode={inputMode} value={contacts[key]}
                            onChange={(e) => { const value = e.target.value; setContacts((c) => ({ ...c, [key]: value })); }}
                            placeholder={key === 'Website' ? t('repo_website_placeholder') : undefined} autoComplete="off" />
                    </label>
                ))}
            </div>
            {repository && canDelete && (
                <div className="-mx-4 mt-5 border-t border-border">
                    <MobileRow icon={<Trash2 />} tone="danger" label={tm('delete_repository')} onClick={() => setConfirming(true)} />
                </div>
            )}
            {repository && (
                <ConfirmSheet open={confirming} title={tm('delete_repository_title', { name: repository.Name })} body={t('repo_delete_confirm')}
                    confirmLabel={tm('delete_repository')} onConfirm={remove} onClose={() => setConfirming(false)} busy={busy} />
            )}
        </Sheet>
    );
}
