'use client';

import { useState, useEffect, useCallback, useId, useRef } from 'react';
import { useTranslations } from 'next-intl';
import Modal from '@/app/components/Modal';
import ConfirmDialog from '@/app/components/ConfirmDialog';
import { Button, fieldClass, InlineDataError } from '@/app/components/ui';
import { getDataClient } from '@/lib/data';
import { useErrorToast } from '@/app/components/useErrorToast';
import { X } from '@/lib/icons';
import { ValidationError } from '@/lib/validation';
import type { Repository } from '@/lib/data/types';
import { ExternalLink } from '@/app/components/ExternalLink';
import { contactHref } from '@/lib/utils/contact-links';

interface RepositoryModalProps {
    /** The repository to view/edit, or `null` to create a new one. */
    repositoryId: number | null;
    treeId: number | null;
    canEdit: boolean;
    canDelete: boolean;
    onClose: () => void;
    /** Called after a successful create/rename/address edit or delete, to refresh the list. */
    onChanged: () => void;
    /** Open one of the repository's sources in the source modal. */
    onOpenSource: (id: number) => void;
}

/** The small caps label over each field and the sources list. */
const FIELD_LABEL = 'muted text-[10px] uppercase tracking-[0.06em]';

type RepoSource = { Id: number; Title: string | null };
type Contacts = { Website: string; Phone: string; Email: string };
const NO_CONTACTS: Contacts = { Website: '', Phone: '', Email: '' };
const CONTACT_FIELDS = [
    { key: 'Website', type: 'url', label: 'repo_field_website', autoComplete: 'url' },
    { key: 'Phone', type: 'tel', label: 'repo_field_phone', autoComplete: 'tel' },
    { key: 'Email', type: 'email', label: 'repo_field_email', autoComplete: 'email' },
] as const;

/** A contact field as the API takes it: trimmed, and null when blank. */
const contactValue = (v: string) => v.trim() || null;

/** View/edit a single repository (archive): rename, edit address and contacts, list its sources, delete. Also creates a new one when `repositoryId` is null. */
export default function RepositoryModal({
    repositoryId, treeId, canEdit, canDelete, onClose, onChanged, onOpenSource,
}: RepositoryModalProps) {
    const isNew = repositoryId === null;
    const scopeKey = `${treeId ?? 'default'}:${repositoryId ?? 'new'}`;
    const t = useTranslations('library');
    const tc = useTranslations('common');
    const [repo, setRepo] = useState<Repository | null>(null);
    const [sources, setSources] = useState<RepoSource[]>([]);
    const [name, setName] = useState('');
    const [address, setAddress] = useState('');
    const [contacts, setContacts] = useState<Contacts>(NO_CONTACTS);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [loadError, setLoadError] = useState(false);
    const [confirmingDelete, setConfirmingDelete] = useState(false);
    const titleId = useId();
    const nameId = useId();
    const addressId = useId();
    const contactId = useId();
    const [sourcesError, setSourcesError] = useState(false);
    const [editorKey, setEditorKey] = useState(isNew ? scopeKey : null);
    const [sourcesKey, setSourcesKey] = useState<string | null>(isNew ? scopeKey : null);
    const repoRequest = useRef(0);
    const sourcesRequest = useRef(0);
    const { redirectIfUnauthorized } = useErrorToast();

    const load = useCallback(async () => {
        if (repositoryId === null) return; // create mode — nothing to load
        const request = ++repoRequest.current;
        setLoadError(false);
        try {
            const client = await getDataClient();
            const r = await client.repositories.get(repositoryId, treeId);
            if (repoRequest.current !== request) return;
            setRepo(r);
            setName(r.Name);
            setAddress(r.Address ?? '');
            setContacts({ Website: r.Website ?? '', Phone: r.Phone ?? '', Email: r.Email ?? '' });
            setEditorKey(scopeKey);
        } catch (e) {
            if (repoRequest.current !== request) return;
            if (redirectIfUnauthorized(e)) return;
            setLoadError(true);
        }
    }, [repositoryId, treeId, redirectIfUnauthorized, scopeKey]);

    const loadSources = useCallback(async () => {
        if (repositoryId === null) return;
        const request = ++sourcesRequest.current;
        setSourcesError(false);
        try {
            const client = await getDataClient();
            const loaded = await client.repositories.sources(repositoryId, treeId);
            if (sourcesRequest.current !== request) return;
            setSources(loaded);
            setSourcesKey(scopeKey);
        } catch (e) {
            if (sourcesRequest.current !== request) return;
            if (redirectIfUnauthorized(e)) return;
            setSourcesError(true);
        }
    }, [repositoryId, treeId, redirectIfUnauthorized, scopeKey]);

    useEffect(() => {
        repoRequest.current += 1;
        sourcesRequest.current += 1;
        setRepo(null);
        setName('');
        setAddress('');
        setContacts(NO_CONTACTS);
        setSources([]);
        setError(null);
        setLoadError(false);
        setSourcesError(false);
        setEditorKey(isNew ? scopeKey : null);
        setSourcesKey(isNew ? scopeKey : null);
    }, [scopeKey, isNew]);

    useEffect(() => {
        void load();
        void loadSources();
    }, [load, loadSources]);

    const editorReady = editorKey === scopeKey;
    const currentSources = sourcesKey === scopeKey ? sources : [];

    async function save() {
        if (!editorReady || !name.trim() || busy) return;
        setBusy(true);
        setError(null);
        try {
            const client = await getDataClient();
            const input = {
                Name: name.trim(), Address: address.trim() || null,
                Website: contactValue(contacts.Website), Phone: contactValue(contacts.Phone), Email: contactValue(contacts.Email),
            };
            if (repositoryId === null) {
                await client.repositories.create(input, treeId);
            } else {
                await client.repositories.update(repositoryId, input, treeId);
            }
            onChanged();
            onClose();
        } catch (e) {
            if (redirectIfUnauthorized(e)) return;
            // The server refuses a second repository of the same name (#1232).
            setError(e instanceof ValidationError
                ? (/already exists/i.test(e.message) ? t('repo_name_taken') : e.message)
                : t('repo_save_failed'));
        } finally {
            setBusy(false);
        }
    }

    async function remove() {
        if (!editorReady || repositoryId === null || busy) return;
        setConfirmingDelete(false);
        setBusy(true);
        setError(null);
        try {
            const client = await getDataClient();
            await client.repositories.remove(repositoryId, treeId);
            onChanged();
            onClose();
        } catch (e) {
            if (redirectIfUnauthorized(e)) return;
            setError(t('repo_delete_failed'));
        } finally {
            setBusy(false);
        }
    }

    const dirty = isNew
        ? name.trim().length > 0
        : editorReady && repo != null && (name.trim() !== repo.Name || (address.trim() || null) !== (repo.Address ?? null)
            || CONTACT_FIELDS.some(({ key }) => contactValue(contacts[key]) !== (repo[key] ?? null)));
    const savedWebsite = contactHref('Website', repo?.Website);

    return (
        <Modal open onClose={onClose} size="md" labelledBy={titleId}>
            <div className="bg-card rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[86vh]">
                <div className="p-4 border-b border-border flex items-center justify-between gap-3">
                    <h3 id={titleId} className="serif text-lg font-semibold text-text">{isNew ? t('repo_create_title') : t('repo_modal_title')}</h3>
                    <button
                        type="button"
                        onClick={onClose}
                        className="p-1.5 rounded-lg text-text-muted hover:bg-hover-surface transition-colors shrink-0"
                        aria-label={tc('close')}
                        title={tc('close')}
                    >
                        <X className="w-4 h-4" aria-hidden="true" />
                    </button>
                </div>

                <div className="p-4 overflow-y-auto flex-1 min-h-0 flex flex-col gap-[14px]">
                    <div>
                        <label htmlFor={nameId} className={`${FIELD_LABEL} block mb-1`}>
                            {t('repo_field_name')}
                        </label>
                        <input
                            id={nameId}
                            type="text"
                            value={editorReady ? name : ''}
                            onChange={e => setName(e.target.value)}
                            disabled={!canEdit}
                            className={fieldClass()}
                        />
                    </div>
                    <div>
                        <label htmlFor={addressId} className={`${FIELD_LABEL} block mb-1`}>
                            {t('repo_field_address')}
                        </label>
                        <textarea
                            id={addressId}
                            value={editorReady ? address : ''}
                            onChange={e => setAddress(e.target.value)}
                            disabled={!canEdit}
                            rows={2}
                            className={`${fieldClass()} resize-y`}
                            placeholder={t('repo_address_placeholder')}
                        />
                    </div>
                    {CONTACT_FIELDS.map(({ key, type, label, autoComplete }) => (
                        <div key={key}>
                            <div className="flex items-baseline justify-between gap-3 mb-1">
                                <label htmlFor={`${contactId}-${key}`} className={`${FIELD_LABEL} block`}>
                                    {t(label)}
                                </label>
                                {key === 'Website' && savedWebsite && editorReady && (
                                    <ExternalLink href={savedWebsite} className="text-meta text-link hover:underline">
                                        {t('repo_visit_website')}
                                    </ExternalLink>
                                )}
                            </div>
                            <input
                                id={`${contactId}-${key}`}
                                type={type}
                                value={editorReady ? contacts[key] : ''}
                                onChange={e => { const value = e.target.value; setContacts(c => ({ ...c, [key]: value })); }}
                                disabled={!canEdit}
                                autoComplete={autoComplete}
                                className={fieldClass()}
                                placeholder={key === 'Website' ? t('repo_website_placeholder') : undefined}
                            />
                        </div>
                    ))}

                    {!isNew && loadError && (
                        <InlineDataError
                            message={t('repo_load_failed')}
                            retryLabel={tc('retry')}
                            onRetry={() => { void load(); }}
                            className="mb-1"
                        />
                    )}

                    {!isNew && (
                    <div>
                        <div className={`${FIELD_LABEL} mb-1.5`}>
                            {t('repo_sources_heading', { count: currentSources.length })}
                        </div>
                        {sourcesError ? (
                            <InlineDataError
                                message={t('repo_load_failed')}
                                retryLabel={tc('retry')}
                                onRetry={() => { void loadSources(); }}
                            />
                        ) : currentSources.length === 0 ? (
                            <div className="serif muted text-sm italic">{t('repo_no_sources')}</div>
                        ) : (
                            <div className="flex flex-col">
                                {currentSources.map(s => (
                                    <button
                                        key={s.Id}
                                        type="button"
                                        onClick={() => onOpenSource(s.Id)}
                                        className="text-left py-[6px] px-0 text-sm"
                                        style={{
                                            color: 'var(--text)',
                                            background: 'none', border: 'none', borderBottom: '1px solid var(--border-light)',
                                            cursor: 'pointer', fontFamily: 'inherit',
                                        }}
                                    >
                                        {s.Title ?? t('untitled_source')}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                    )}

                    {error && <div role="alert" className="text-sm" style={{ color: 'var(--color-error)' }}>{error}</div>}
                </div>

                {canEdit && (
                    <div className="p-3 border-t border-border bg-card-alt flex items-center gap-3">
                        {!isNew && canDelete && (
                            <Button variant="danger" size="sm" onClick={() => setConfirmingDelete(true)} disabled={busy || !editorReady}>{tc('delete')}</Button>
                        )}
                        <div className="flex gap-2" style={{ marginLeft: 'auto' }}>
                            <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>{tc('cancel')}</Button>
                            <Button variant="primary" size="sm" onClick={save} disabled={busy || !editorReady || !name.trim() || !dirty}>
                                {busy ? tc('saving') : isNew ? tc('create') : tc('save_changes')}
                            </Button>
                        </div>
                    </div>
                )}
            </div>
            <ConfirmDialog
                open={confirmingDelete}
                variant="calm"
                tone="danger"
                elevated
                title={t('repo_delete_title')}
                body={t('repo_delete_confirm')}
                confirmLabel={tc('delete')}
                busy={busy}
                onConfirm={remove}
                onCancel={() => setConfirmingDelete(false)}
            />
        </Modal>
    );
}
