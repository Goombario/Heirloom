'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { getDataClient } from '@/lib/data';
import type { Repository } from '@/lib/data/types';
import type { SourceWithCitationCount } from '@/lib/db/queries/sources';
import { NotFoundError } from '@/lib/data/errors';
import { useTree } from '@/app/contexts/TreeContext';
import RecordNotFound from '@/app/components/RecordNotFound';
import { Skeleton } from '@/app/components/SkeletonLoader';
import { RecordBand } from '@/app/components/mobile/RecordBand';
import { InlineDataError, MobileRow, PageShell } from '@/app/components/ui';
import { Head, Section } from '@/app/people/view/mobile/panes';
import { Landmark, Plus } from '@/lib/icons';
import { QuietRow } from '@/app/components/mobile/RecordBand';
import { contactHref } from '@/lib/utils/contact-links';
import { SourceRow, sourceHref } from '../MobileLibrary';
import { RepositorySheet } from './RepositorySheet';
import { SourceFormSheet } from './SourceFormSheet';

/**
 * The repository page on phones (#1119): the same band with "Repository" as the
 * eyebrow and the address under the name, then Contact when it has a website, phone
 * or email (ADR 0049), then Sources held, each opening its page,
 * and "Add a source here", which opens New source with this repository picked. The
 * pencil opens the repository sheet and a red Delete.
 */
export function MobileRepositoryPage({ repositoryId }: { repositoryId: number }) {
    const t = useTranslations('mobileLibrary');
    const tl = useTranslations('library');
    const tc = useTranslations('common');
    const router = useRouter();
    const { activeTreeId, activePermission } = useTree();
    const editor = activePermission !== 'view';
    const canDelete = activePermission === 'owner' || activePermission === 'edit';
    const [repo, setRepo] = useState<Repository | null>(null);
    const [held, setHeld] = useState<SourceWithCitationCount[]>([]);
    const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'failed'>('loading');
    const [sheet, setSheet] = useState<'edit' | 'new' | null>(null);

    const load = useCallback(async () => {
        try {
            const client = await getDataClient();
            const [r, { sources }] = await Promise.all([
                client.repositories.get(repositoryId, activeTreeId),
                client.sources.list<SourceWithCitationCount>({ withCounts: true, treeId: activeTreeId }),
            ]);
            setRepo(r);
            setHeld(sources.filter((s) => s.RepositoryId === repositoryId).sort((a, b) => (a.Title ?? '').localeCompare(b.Title ?? '')));
            setState('ready');
        } catch (e) {
            setState(e instanceof NotFoundError ? 'missing' : 'failed');
        }
    }, [repositoryId, activeTreeId]);
    // The record arrives after an await; the rule can't see past the call.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { void load(); }, [load]);

    if (state === 'missing') return <RecordNotFound record="source" />;
    if (!repo) {
        return (
            <PageShell variant="detail" busy={state === 'loading'} contentClassName="hidden" topBar={(
                <div className="mp-root md:hidden">
                    <div className="hero-dark mp-slim-bar !rounded-none !p-0 !shadow-none h-[170px]" />
                    {state === 'failed'
                        ? <div className="px-4 pt-4"><InlineDataError message={tl('repo_load_failed')} retryLabel={tc('retry')} onRetry={() => { void load(); }} /></div>
                        : <div className="grid gap-3 p-4"><Skeleton className="h-4 w-[60%]" /><Skeleton className="h-4 w-[80%]" /></div>}
                </div>
            )} />
        );
    }

    return (
        <PageShell variant="detail" contentClassName="hidden" topBar={(
            <div className="mp-root md:hidden overflow-x-clip" style={{ paddingBottom: 'calc(2rem + env(safe-area-inset-bottom, 0px))' }}>
                <RecordBand
                    eyebrow={<><Landmark aria-hidden="true" />{tl('repo_modal_title')}</>}
                    title={repo.Name}
                    line={repo.Address?.trim() || <span className="opacity-75">{tl('repo_no_address')}</span>}
                    onEdit={editor ? () => setSheet('edit') : undefined}
                    editLabel={t('edit_repository')}
                />
                {(repo.Website || repo.Phone || repo.Email) && (
                    <Section first>
                        <Head title={t('contact')} />
                        {(['Website', 'Phone', 'Email'] as const).filter((key) => repo[key]).map((key) => (
                            <QuietRow key={key} label={tl(`repo_field_${key.toLowerCase() as 'website' | 'phone' | 'email'}`)}
                                href={contactHref(key, repo[key]) ?? undefined}>{repo[key]}</QuietRow>
                        ))}
                    </Section>
                )}
                <Section first={!(repo.Website || repo.Phone || repo.Email)}>
                    <Head title={t('sources_held')} count={held.length} />
                    {held.length === 0 && <p className="m-0 px-4 pb-2.5 pt-1 text-sm text-text-muted">{t('repo_empty')}</p>}
                    {held.map((s, i) => <SourceRow key={s.Id} source={s} divided={i > 0} leave />)}
                    {editor && (
                        <MobileRow icon={<Plus />} end="chevron" divided={held.length > 0} label={t('add_source_here')} sub={t('add_source_here_sub')}
                            onClick={() => setSheet('new')} />
                    )}
                </Section>
                <RepositorySheet open={sheet === 'edit'} repository={repo} canDelete={canDelete} onClose={() => setSheet(null)}
                    onSaved={() => { setSheet(null); void load(); }}
                    onDeleted={() => { setSheet(null); router.replace('/library?tab=repositories'); }} />
                <SourceFormSheet open={sheet === 'new'} source={null} initialRepository={repo.Name} onClose={() => setSheet(null)}
                    onSaved={(saved) => { setSheet(null); router.push(sourceHref(saved.Id)); }} />
            </div>
        )} />
    );
}
