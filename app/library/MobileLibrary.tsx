'use client';

// The Library on phones (#1119, option C "two lists"): a Sources | Photos switch under
// the list header. Uncited is a chip on Sources, repositories live behind the
// Repository chip (and their own Manage repositories page), and the Faces queue opens
// from a row above the photo grid. A source or repository opens its own page.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { useTree } from '@/app/contexts/TreeContext';
import { getDataClient } from '@/lib/data';
import type { RepositoryWithCount } from '@/lib/data/types';
import type { SourceWithCitationCount } from '@/lib/db/queries/sources';
import {
    ChoiceSheet, CopperPill, EmptyState, InlineDataError, MobileListToggleChip, MobileListDivider,
    MobileListFilters, MobileListHeader, MobileListMeta, MobileRow, PageShell, RadioRow, SegmentedControl, SortSheet, cx,
} from '@/app/components/ui';
import { ConfirmSheet, Sheet } from '@/app/components/ui/Sheet';
import { SkeletonList } from '@/app/components/SkeletonLoader';
import AddMediaModal from '@/app/components/media/AddMediaModal';
import { useLoadPhase } from '@/app/components/useLoadPhase';
import { useDocumentTitle } from '@/app/hooks/useDocumentTitle';
import { ChevronRight, HardDrive, Landmark, Plus, ImageUp, ScanFace, Trash2 } from '@/lib/icons';
import { formatMediaBytes } from '@/lib/media/format-bytes';
import { foldForSearch } from '@/lib/utils/search-fold';
import { errorToastKey } from '@/lib/utils/data-error';
import { useLibrarySources } from './useLibrarySources';
import { useLibraryTab } from './useLibraryTab';
import { LIBRARY_SOURCES_HREF } from './links';
import { useSourceFilters } from './useSourceFilters';
import { usePhotoFilters, type PhotoSort } from './usePhotoFilters';
import { usePhotoSelection } from './usePhotoSelection';
import { usePhotoBulkDelete } from './usePhotoBulkDelete';
import { useMediaStorage } from './useMediaStorage';
import { SOURCE_TYPES, SourceTypeIcon, sourceTypeLabel } from './sourceTypes';
import PhotosGrid from './sections/PhotosGrid';
import MediaStorageCard from './sections/MediaStorageCard';
import { RepositorySheet } from './mobile/RepositorySheet';
import { SourceFormSheet } from './mobile/SourceFormSheet';

const FacesPanel = dynamic(() => import('@/app/library/faces/FacesPanel'), { ssr: false });

export const sourceHref = (id: number) => `/library/view?id=${id}`;
export const repositoryHref = (id: number) => `/library/repository?id=${id}`;

type SourceSort = 'title' | 'type' | 'cites' | 'added';

/** The first letter a title files under; digits and symbols file under #. */
function letterOf(title: string): string {
    const c = foldForSearch(title.trim()).charAt(0).toUpperCase();
    return /[A-ZА-ЯЁ]/.test(c) ? c : '#';
}

export default function MobileLibrary() {
    const t = useTranslations('library');
    const tm = useTranslations('mobileLibrary');
    const router = useRouter();
    const { activeTreeId, activePermission, currentUserId } = useTree();
    const canEdit = activePermission !== 'view';
    const canDelete = activePermission === 'owner' || activePermission === 'edit';
    const { sources, photos, loading, sourceError, photoError, photoLoading, retrySources, retryPhotos, refetch } =
        useLibrarySources(activeTreeId, currentUserId !== null);
    const { tab, setTab } = useLibraryTab();
    useDocumentTitle(t('title'));
    // A source or repository is a page on phones; links made for the desktop modal
    // (`?source=`, `?repo=`) go there.
    const searchParams = useSearchParams();
    const linkedSource = searchParams.get('source');
    const linkedRepo = searchParams.get('repo');
    // /library/new on a phone lands here with ?new=1 (#1127): the New source sheet opens.
    // The flag leaves the URL before the sheet opens, so the sheet's history step sits on Sources.
    const [newSource, setNewSource] = useState(false);
    const wantsNew = searchParams.has('new');
    useEffect(() => {
        if (!wantsNew) return;
        window.history.replaceState(window.history.state, '', LIBRARY_SOURCES_HREF);
        // eslint-disable-next-line react-hooks/set-state-in-effect -- reads the URL once on arrival
        setNewSource(true);
    }, [wantsNew]);
    useEffect(() => {
        if (linkedSource && /^\d+$/.test(linkedSource)) router.replace(sourceHref(Number(linkedSource)));
        else if (linkedRepo && /^\d+$/.test(linkedRepo)) router.replace(repositoryHref(Number(linkedRepo)));
    }, [linkedSource, linkedRepo, router]);

    // Uncited was a tab; on a phone it is a chip on Sources, so an old ?tab=uncited
    // link lands on Sources with the chip on.
    const [uncited, setUncited] = useState(tab === 'uncited');
    const view = tab === 'uncited' ? 'sources' : tab;

    const [facesPending, setFacesPending] = useState(0);
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const client = await getDataClient();
                const { pendingTotal } = await client.media.listFaceQueue({ resolved: false, countOnly: true }, activeTreeId);
                if (!cancelled) setFacesPending(pendingTotal);
            } catch { /* the row is a nudge; without the count it stays hidden */ }
        })();
        return () => { cancelled = true; };
    }, [activeTreeId]);

    const phase = useLoadPhase(currentUserId === null || loading, { delay: 0 });

    if (view === 'repositories') return <RepositoriesPage canEdit={canEdit} />;
    if (view === 'faces') {
        return (
            <PageShell topBar={<MobileListHeader title={tm('faces')} />} contentClassName="max-md:p-0!">
                <FacesPanel treeId={activeTreeId} canEdit={canEdit} onPendingCountChange={setFacesPending} />
            </PageShell>
        );
    }

    return (
        <PageShell topBar={<MobileListHeader title={t('title')} />} contentClassName="max-md:p-0!" busy={phase === 'loading'}>
            <div className="px-4 pt-2.5 pb-0 bg-surface">
                <SegmentedControl
                    aria-label={tm('library_view')}
                    fullWidth
                    value={view}
                    onChange={(v) => setTab(v as 'sources' | 'photos')}
                    options={[{ v: 'sources', l: t('tab_sources_label') }, { v: 'photos', l: t('tab_photos_label') }]}
                />
            </div>
            {phase !== 'ready' ? (
                phase === 'loading' ? <div className="pt-4"><SkeletonList rows={8} /></div> : null
            ) : view === 'photos' ? (
                <PhotosView
                    photos={photos}
                    photoError={photoError}
                    photoLoading={photoLoading}
                    retryPhotos={retryPhotos}
                    refetch={refetch}
                    canEdit={canEdit}
                    canDelete={canDelete}
                    facesPending={facesPending}
                    onFaces={() => setTab('faces')}
                />
            ) : (
                <SourcesView
                    sources={sources}
                    sourceError={sourceError}
                    retrySources={retrySources}
                    canEdit={canEdit}
                    uncited={uncited}
                    setUncited={setUncited}
                    onManageRepos={() => setTab('repositories')}
                    onAddSource={() => setNewSource(true)}
                />
            )}
            {/* Save opens the new source's page, where Cite on lives. The sheet stays open
                through the push: closing it would take its history step back and undo it. */}
            <SourceFormSheet open={newSource} source={null} onClose={() => setNewSource(false)}
                onSaved={(s) => router.push(sourceHref(s.Id))} />
        </PageShell>
    );
}

/* ── Sources ──────────────────────────────────────────────────────────────── */

function SourcesView({ sources, sourceError, retrySources, canEdit, uncited, setUncited, onManageRepos, onAddSource }: {
    sources: SourceWithCitationCount[];
    sourceError: unknown;
    retrySources: () => void | Promise<void>;
    canEdit: boolean;
    uncited: boolean;
    setUncited: (on: boolean) => void;
    onManageRepos: () => void;
    onAddSource: () => void;
}) {
    const t = useTranslations('library');
    const tm = useTranslations('mobileLibrary');
    const tc = useTranslations('common');
    const { search, setSearch, typeFilter, setTypeFilter, repoFilter, setRepoFilter, typeCounts, repositories, filteredSources } =
        useSourceFilters(sources);
    const [sort, setSort] = useState<SourceSort>('title');
    const [ascending, setAscending] = useState(true);
    const [sheet, setSheet] = useState<'sort' | 'type' | 'repo' | 'newRepo' | null>(null);

    const typeLabel = useCallback((type: string | null) => sourceTypeLabel(type, t), [t]);
    const shown = useMemo(() => {
        const list = uncited ? filteredSources.filter((s) => s.citationCount === 0) : filteredSources;
        const title = (s: SourceWithCitationCount) => s.Title?.trim() || t('untitled_source');
        const byTitle = (a: SourceWithCitationCount, b: SourceWithCitationCount) => title(a).localeCompare(title(b));
        const cmp: Record<SourceSort, (a: SourceWithCitationCount, b: SourceWithCitationCount) => number> = {
            title: byTitle,
            type: (a, b) => typeLabel(a.Type).localeCompare(typeLabel(b.Type)) || byTitle(a, b),
            // Most first reads as "ascending" in the sheet's own words.
            cites: (a, b) => b.citationCount - a.citationCount || byTitle(a, b),
            // Ids grow as sources are added, so the newest has the highest.
            added: (a, b) => b.Id - a.Id,
        };
        return [...list].sort((a, b) => (ascending ? 1 : -1) * cmp[sort](a, b));
    }, [filteredSources, uncited, sort, ascending, t, typeLabel]);

    const anyChip = uncited || typeFilter != null || repoFilter != null;
    const clearAll = () => { setUncited(false); setTypeFilter(null); setRepoFilter(null); };
    const columns = [
        { key: 'title', label: tm('sort_title'), hint: tm('sort_title_hint'), orders: [tm('order_az'), tm('order_za')] as [string, string] },
        { key: 'type', label: tm('sort_type'), hint: tm('sort_type_hint'), orders: [tm('order_az'), tm('order_za')] as [string, string] },
        { key: 'cites', label: tm('sort_cites'), hint: tm('sort_cites_hint'), orders: [tm('order_most'), tm('order_fewest')] as [string, string] },
        { key: 'added', label: tm('sort_added'), hint: tm('sort_added_hint'), orders: [tm('order_newest'), tm('order_oldest')] as [string, string] },
    ];
    const col = columns.find((c) => c.key === sort)!;
    const divider = (s: SourceWithCitationCount) => sort === 'title' ? letterOf(s.Title ?? '') : sort === 'type' ? typeLabel(s.Type) : null;

    return (
        <>
            <MobileListFilters value={search} onChange={setSearch} placeholder={tm('filter_sources')}>
                <MobileListToggleChip label={t('tab_uncited_label')} on={uncited} clearLabel={tc('clear_filter_named', { name: t('tab_uncited_label') })}
                    onTap={() => setUncited(!uncited)} onClear={() => setUncited(false)} />
                <MobileListToggleChip label={typeFilter ? typeLabel(typeFilter) : tm('chip_type')} on={typeFilter != null} clearLabel={tc('clear_filter_named', { name: typeFilter ? typeLabel(typeFilter) : '' })}
                    onTap={() => setSheet('type')} onClear={() => setTypeFilter(null)} />
                <MobileListToggleChip label={repoFilter ?? t('filter_repository')} on={repoFilter != null} clearLabel={tc('clear_filter_named', { name: repoFilter ?? '' })}
                    onTap={() => setSheet('repo')} onClear={() => setRepoFilter(null)} />
                {anyChip && <button type="button" onClick={clearAll} className="shrink-0 min-h-11 -my-[5px] px-2 text-sm font-semibold text-link cursor-pointer focus-ring rounded-full">{tm('clear_all')}</button>}
            </MobileListFilters>

            {sourceError != null && (
                <div className="px-4 pt-3"><InlineDataError message={t('failed_load_source')} retryLabel={tc('retry')} onRetry={() => { void retrySources(); }} /></div>
            )}
            {shown.length === 0 ? (
                sources.length === 0 ? (
                    <div className="px-4 pt-6"><EmptyState variant="empty" title={t('empty_sources_title')} message={t('empty_sources_hint')} /></div>
                ) : (
                    <div className="px-4 pt-6"><EmptyState variant="filtered" message={t('empty_no_match')} clearLabel={tc('clear_filters')}
                        onClear={() => { clearAll(); setSearch(''); }} /></div>
                )
            ) : (
                <>
                    <MobileListMeta
                        count={shown.length !== sources.length ? tm('count_of', { shown: shown.length, total: sources.length }) : tm('sources_count', { count: sources.length })}
                        sortLabel={`${col.label} · ${col.orders[ascending ? 0 : 1]}`}
                        onSort={() => setSheet('sort')}
                    />
                    {uncited && <p className="m-0 px-4 pt-0.5 pb-2 text-sm leading-normal text-text-secondary">{tm('uncited_hint')}</p>}
                    <ul className="m-0 p-0 list-none">
                        {shown.map((s, i) => {
                            const d = divider(s);
                            const prev = i > 0 ? divider(shown[i - 1]) : null;
                            const newGroup = d != null && d !== prev;
                            return (
                                <li key={s.Id}>
                                    {newGroup && <MobileListDivider>{d}</MobileListDivider>}
                                    <SourceRow source={s} divided={i > 0 && !newGroup} />
                                </li>
                            );
                        })}
                    </ul>
                </>
            )}
            {canEdit && (
                <>
                    <div className="h-24" aria-hidden="true" />
                    <CopperPill floating icon={<Plus aria-hidden="true" />} onClick={onAddSource}>{t('add_source')}</CopperPill>
                </>
            )}

            <SortSheet open={sheet === 'sort'} onClose={() => setSheet(null)} title={tm('sort_by')} columns={columns}
                column={sort} ascending={ascending} onChange={(c, asc) => { setSort(c as SourceSort); setAscending(asc); }} />
            <ChoiceSheet open={sheet === 'type'} onClose={() => setSheet(null)} title={tm('chip_type')} searchPlaceholder={tm('find_type')}
                emptyLabel={tm('no_types')} onPick={(v) => { setTypeFilter(v); setSheet(null); }}
                options={[...SOURCE_TYPES, ...[...typeCounts.keys()].filter((k) => !(SOURCE_TYPES as readonly string[]).includes(k))]
                    .filter((k) => typeCounts.has(k)).map((k) => ({ value: k, label: typeLabel(k), count: typeCounts.get(k) }))} />
            <Sheet open={sheet === 'repo'} onClose={() => setSheet(null)} title={t('filter_repository')}>
                <div role="radiogroup" aria-label={t('filter_repository')} className="-mx-4 -mt-3">
                    <RadioRow checked={repoFilter == null} label={t('filter_all_repositories')} divided={false}
                        onSelect={() => { setRepoFilter(null); setSheet(null); }} />
                    {repositories.map(([name, count]) => (
                        <RadioRow key={name} checked={repoFilter === name} label={name} hint={t('source_count', { count })} divided
                            onSelect={() => { setRepoFilter(name); setSheet(null); }} />
                    ))}
                </div>
                <div className="-mx-4 mt-2 border-t border-border">
                    {canEdit && <MobileRow icon={<Plus />} end="chevron" label={t('repo_add')} onClick={() => setSheet('newRepo')} />}
                    <MobileRow icon={<Landmark />} end="chevron" divided={canEdit} label={tm('manage_repositories')} onClick={() => { setSheet(null); onManageRepos(); }} />
                </div>
                <RepositorySheet open={sheet === 'newRepo'} repository={null} onClose={() => setSheet('repo')}
                    onSaved={(id) => { setSheet(null); window.location.assign(repositoryHref(id)); }} />
            </Sheet>
        </>
    );
}

/** A source row: type tile, serif title, then type · repository · citations, and the text's opening. */
export function SourceRow({ source: s, divided, leave = false }: { source: SourceWithCitationCount; divided: boolean; leave?: boolean }) {
    const t = useTranslations('library');
    const tm = useTranslations('mobileLibrary');
    const where = s.RepositoryName;
    return (
        <MobileRow
            href={sourceHref(s.Id)}
            divided={divided}
            end={leave ? 'leave' : 'none'}
            className="min-h-[62px] py-2.5"
            lead={(
                <span aria-hidden="true" className="grid place-items-center w-10 h-10 shrink-0 rounded-[10px] bg-surface-2 text-text-secondary [&_svg]:w-[19px] [&_svg]:h-[19px]">
                    <SourceTypeIcon sourceType={s.Type} strokeWidth={1.6} />
                </span>
            )}
            label={<span className="serif font-semibold text-md leading-tight text-text line-clamp-2">{s.Title?.trim() || t('untitled_source')}</span>}
            sub={(
                <span className="grid gap-0.5">
                    <span className="truncate">
                        {sourceTypeLabel(s.Type, t)}
                        {where && <> · {where}</>}
                        {' · '}
                        {s.citationCount > 0
                            ? <><span className="font-mono">{s.citationCount}</span> {tm('cited')}</>
                            : <span className="text-[color:var(--color-date)]">{tm('not_cited')}</span>}
                    </span>
                    {s.Contents && <span className="italic text-text-secondary line-clamp-2 whitespace-normal">“{s.Contents}”</span>}
                </span>
            )}
        />
    );
}

/* ── Photos ───────────────────────────────────────────────────────────────── */

function PhotosView({ photos, photoError, photoLoading, retryPhotos, refetch, canEdit, canDelete, facesPending, onFaces }: {
    photos: ReturnType<typeof useLibrarySources>['photos'];
    photoError: unknown;
    photoLoading: boolean;
    retryPhotos: () => void | Promise<void>;
    refetch: () => Promise<unknown>;
    canEdit: boolean;
    canDelete: boolean;
    facesPending: number;
    onFaces: () => void;
}) {
    const t = useTranslations('library');
    const tm = useTranslations('mobileLibrary');
    const tc = useTranslations('common');
    const locale = useLocale();
    const { activeTreeId } = useTree();
    const [search, setSearch] = useState('');
    const { tagFilter, setTagFilter, sort, setSort, visiblePhotos, photoCounts, clearPhotoFilters, typeFilter, setTypeFilter } = usePhotoFilters(photos, search);
    const storage = useMediaStorage(activeTreeId, true);
    const refresh = useCallback(async () => { await Promise.all([refetch(), storage.refresh()]); }, [refetch, storage]);
    const visibleIds = useMemo(() => visiblePhotos.map((p) => p.Id), [visiblePhotos]);
    const selection = usePhotoSelection({ visibleIds, active: true, treeId: activeTreeId });
    const selecting = selection.mode === 'select';
    const bulk = usePhotoBulkDelete({
        treeId: activeTreeId, tab: 'photos', photos, visibleIds, selectedIds: selection.selectedIds,
        retainSelection: selection.retain, exitSelection: selection.exit, refresh,
    });
    const [sheet, setSheet] = useState<'sort' | 'storage' | 'delete' | null>(null);
    const [uploadOpen, setUploadOpen] = useState(false);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selection.selectedIds.has(id));
    const count = selection.selectedIds.size;

    const sorts: { v: PhotoSort; l: string; hint?: string }[] = [
        { v: 'recent', l: tm('sort_added'), hint: tm('sort_recent_hint') },
        { v: 'title-asc', l: tm('sort_title_az') },
        { v: 'title-desc', l: tm('sort_title_za') },
        { v: 'size-desc', l: tm('sort_largest'), hint: tm('sort_largest_hint') },
    ];
    const used = storage.summary;

    return (
        <>
            <MobileListFilters value={search} onChange={setSearch} placeholder={tm('filter_photos')}>
                <MobileListToggleChip label={tm('chip_tagged')} on={tagFilter === 'tagged'} clearLabel={tc('clear_filter_named', { name: tm('chip_tagged') })}
                    onTap={() => setTagFilter(tagFilter === 'tagged' ? 'all' : 'tagged')} onClear={() => setTagFilter('all')} />
                <MobileListToggleChip label={tm('chip_untagged')} on={tagFilter === 'untagged'} clearLabel={tc('clear_filter_named', { name: tm('chip_untagged') })}
                    onTap={() => setTagFilter(tagFilter === 'untagged' ? 'all' : 'untagged')} onClear={() => setTagFilter('all')} />
                <MobileListToggleChip label={tm('chip_documents')} on={typeFilter === 'documents'} clearLabel={tc('clear_filter_named', { name: tm('chip_documents') })}
                    onTap={() => setTypeFilter(typeFilter === 'documents' ? 'all' : 'documents')} onClear={() => setTypeFilter('all')} />
            </MobileListFilters>

            {facesPending > 0 && !selecting && (
                <button type="button" onClick={onFaces}
                    className="flex w-full min-h-14 items-center gap-3 px-4 py-2.5 text-left cursor-pointer active:bg-surface-2 focus-ring-inset">
                    <span aria-hidden="true" className="grid place-items-center w-[34px] h-[34px] shrink-0 rounded-[9px] bg-surface-2 text-text [&_svg]:w-[18px] [&_svg]:h-[18px]"><ScanFace /></span>
                    <span className="flex-1 min-w-0 grid gap-px">
                        <span className="text-base font-semibold text-text">{tm('faces_to_confirm')}</span>
                        <span className="text-meta text-text-muted">{tm('faces_hint')}</span>
                    </span>
                    <span className="font-mono text-meta font-medium text-[color:var(--color-date)]">{facesPending}</span>
                    <ChevronRight className="w-[18px] h-[18px] shrink-0 text-text-muted" aria-hidden="true" />
                </button>
            )}
            {photoError != null && (
                <div className="px-4 pt-3"><InlineDataError message={tc(errorToastKey(photoError))} retryLabel={tc('retry')} onRetry={() => { void retryPhotos(); }} /></div>
            )}

            {selecting ? (
                <div className="md:hidden flex items-center justify-between gap-3 px-4 pt-3 pb-1 text-meta text-text-muted">
                    <span className="font-mono">{t('selected_count', { count })}</span>
                    <span className="flex items-center gap-3.5">
                        <MetaLink onClick={() => (allSelected ? selection.clear() : selection.selectVisible())}>
                            {allSelected ? t('clear_selection') : tm('select_all', { count: visibleIds.length })}
                        </MetaLink>
                        <MetaLink ink onClick={selection.exit}>{tc('done')}</MetaLink>
                    </span>
                </div>
            ) : (
                <div className="md:hidden flex items-center justify-between gap-3 px-4 pt-3 pb-1 text-meta text-text-muted">
                    <span className="font-mono">{visiblePhotos.length !== photos.length ? tm('count_of', { shown: visiblePhotos.length, total: photos.length }) : tm('photos_count', { count: photos.length })}</span>
                    <span className="flex items-center gap-3.5">
                        {canDelete && photos.length > 0 && <MetaLink onClick={selection.enter}>{t('select')}</MetaLink>}
                        <MetaLink onClick={() => setSheet('sort')} dialog>{sorts.find((s) => s.v === sort)?.l}</MetaLink>
                    </span>
                </div>
            )}
            {bulk.requestError && <p role="alert" className="m-0 px-4 py-2 text-sm text-error">{bulk.requestError}</p>}
            {bulk.visibleFailures.length > 0 && (
                <p role="alert" className="m-0 px-4 py-2 text-sm text-error">{t('delete_failed_item', { title: bulk.visibleFailures[0].title })}</p>
            )}

            <div className="pt-1.5">
                <PhotosGrid
                    phone
                    photos={visiblePhotos}
                    loading={photoLoading}
                    treeId={activeTreeId}
                    canEdit={canEdit}
                    canDelete={canDelete}
                    onPrimaryChanged={() => { void refresh(); }}
                    showFileSizes={sort === 'size-desc'}
                    selectionMode={selecting}
                    selectionDisabled={bulk.busy}
                    selectedIds={selection.selectedIds}
                    failedIds={bulk.failedIds}
                    onToggleSelection={selection.toggle}
                    emptyState={photos.length === 0
                        ? <div className="px-4 pt-6"><EmptyState variant="empty" message={t('empty_no_photos')} /></div>
                        : <div className="px-4 pt-6"><EmptyState variant="filtered" message={t('empty_no_photo_match')} clearLabel={tc('clear_filters')} onClear={() => { setSearch(''); clearPhotoFilters(); }} /></div>}
                />
            </div>

            {!selecting && (
                <MobileRow className="mt-3.5 border-t border-border" icon={<HardDrive />} end="chevron" label={tm('storage')}
                    sub={[
                        used ? (used.limitBytes != null
                            ? tm('storage_used_of', { used: formatMediaBytes(used.usedBytes, locale), limit: formatMediaBytes(used.limitBytes, locale) })
                            : tm('storage_used', { used: formatMediaBytes(used.usedBytes, locale) })) : null,
                        tm('tagged_of', { tagged: photoCounts.tagged, total: photoCounts.total }),
                    ].filter(Boolean).join(' · ')}
                    onClick={() => setSheet('storage')} />
            )}
            <div aria-hidden="true" className={selecting ? 'h-28' : 'h-24'} />

            {selecting ? (
                <div className="md:hidden fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-3 border-t border-border bg-card px-4 pt-1.5 shadow-[0_-6px_18px_rgba(0,0,0,0.08)]"
                    style={{ paddingBottom: 'calc(10px + env(safe-area-inset-bottom, 0px))' }}>
                    <span className="text-sm text-text-secondary">{t('selected_count', { count })}</span>
                    <button type="button" disabled={count === 0 || bulk.busy} onClick={() => setSheet('delete')}
                        className="inline-flex items-center gap-2 min-h-11 px-0.5 text-base font-semibold text-error cursor-pointer disabled:opacity-40 disabled:cursor-default focus-ring rounded-lg [&_svg]:w-[18px] [&_svg]:h-[18px]">
                        <Trash2 aria-hidden="true" />{bulk.busy ? t('deleting_selected') : t('delete_selected_short', { count })}
                    </button>
                </div>
            ) : canEdit && (
                <CopperPill floating icon={<ImageUp aria-hidden="true" />} onClick={() => setUploadOpen(true)}>{tm('upload_photos')}</CopperPill>
            )}

            <Sheet open={sheet === 'sort'} onClose={() => setSheet(null)} title={tm('sort_by')}>
                <div role="radiogroup" aria-label={tm('sort_by')} className="-mx-4 -mt-3">
                    {sorts.map((s, i) => (
                        <RadioRow key={s.v} checked={sort === s.v} label={s.l} hint={s.hint} divided={i > 0} onSelect={() => { setSort(s.v); setSheet(null); }} />
                    ))}
                </div>
            </Sheet>
            <Sheet open={sheet === 'storage'} onClose={() => setSheet(null)} title={tm('storage')}>
                <MediaStorageCard summary={storage.summary} loading={storage.loading} error={storage.error}
                    onRetry={() => { void storage.retry(); }} onReviewLargest={() => { setSort('size-desc'); setSheet(null); }} />
            </Sheet>
            <ConfirmSheet open={sheet === 'delete'} title={t('delete_selected_title')} body={t('delete_selected_body', { count })}
                confirmLabel={t('delete_selected_confirm')} busy={bulk.busy}
                onConfirm={async () => { await bulk.deleteSelected(); setSheet(null); }} onClose={() => setSheet(null)} />
            {uploadOpen && (
                <AddMediaModal target={{ kind: 'library' }} treeId={activeTreeId} storageSummary={storage.summary} onMediaChanged={() => { void refresh(); }}
                    onClose={() => setUploadOpen(false)} onAdded={() => setUploadOpen(false)} />
            )}
        </>
    );
}

function MetaLink({ onClick, ink, dialog, children }: { onClick: () => void; ink?: boolean; dialog?: boolean; children: React.ReactNode }) {
    return (
        <button type="button" onClick={onClick} aria-haspopup={dialog ? 'dialog' : undefined}
            className={cx('min-h-11 min-w-11 px-0.5 text-sm font-semibold cursor-pointer rounded-lg focus-ring whitespace-nowrap', ink ? 'text-text' : 'text-link')}>
            {children}
        </button>
    );
}

/* ── Repositories ─────────────────────────────────────────────────────────── */

function RepositoriesPage({ canEdit }: { canEdit: boolean }) {
    const t = useTranslations('library');
    const tm = useTranslations('mobileLibrary');
    const tc = useTranslations('common');
    const { activeTreeId } = useTree();
    const [repos, setRepos] = useState<RepositoryWithCount[] | null>(null);
    const [failed, setFailed] = useState(false);
    const [query, setQuery] = useState('');
    const [byName, setByName] = useState(true);
    const [sheet, setSheet] = useState<'sort' | 'new' | null>(null);
    const load = useCallback(async () => {
        try {
            const client = await getDataClient();
            setRepos(await client.repositories.list(activeTreeId));
            setFailed(false);
        } catch { setFailed(true); }
    }, [activeTreeId]);
    // The list arrives after an await; the rule can't see past the call.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { void load(); }, [load]);
    const q = foldForSearch(query.trim());
    const shown = (repos ?? [])
        .filter((r) => !q || foldForSearch(r.Name).includes(q) || foldForSearch(r.Address ?? '').includes(q))
        .sort((a, b) => byName ? a.Name.localeCompare(b.Name) : b.SourceCount - a.SourceCount || a.Name.localeCompare(b.Name));

    return (
        <PageShell topBar={<MobileListHeader title={t('tab_repositories_label')} />} contentClassName="max-md:p-0!">
            <MobileListFilters value={query} onChange={setQuery} placeholder={tm('filter_repositories')} />
            {failed && <div className="px-4 pt-3"><InlineDataError message={t('repo_load_failed')} retryLabel={tc('retry')} onRetry={() => { void load(); }} /></div>}
            {repos == null ? (!failed && <div className="pt-4"><SkeletonList rows={6} /></div>) : repos.length === 0 ? (
                <div className="px-4 pt-6"><EmptyState variant="empty" message={t('empty_no_repos')} /></div>
            ) : shown.length === 0 ? (
                <div className="px-4 pt-6"><EmptyState variant="filtered" message={tm('no_repo_match')} clearLabel={tc('clear_search')} onClear={() => setQuery('')} /></div>
            ) : (
                <>
                    <MobileListMeta count={shown.length !== repos.length ? tm('count_of', { shown: shown.length, total: repos.length }) : tm('repositories_count', { count: repos.length })}
                        sortLabel={byName ? tm('sort_repo_name') : tm('sort_repo_sources')} onSort={() => setSheet('sort')} />
                    <ul className="m-0 p-0 list-none">
                        {shown.map((r, i) => (
                            <li key={r.Id}>
                                <MobileRow href={repositoryHref(r.Id)} divided={i > 0} className="min-h-[62px]"
                                    lead={<span aria-hidden="true" className="grid place-items-center w-10 h-10 shrink-0 rounded-[10px] bg-surface-2 text-text-secondary [&_svg]:w-[19px] [&_svg]:h-[19px]"><Landmark strokeWidth={1.6} /></span>}
                                    label={<span className="serif font-semibold text-md">{r.Name}</span>}
                                    sub={<>{r.Address?.trim() || t('repo_no_address')} · <span className="font-mono">{r.SourceCount}</span> {tm('sources_word', { count: r.SourceCount })}</>} />
                            </li>
                        ))}
                    </ul>
                </>
            )}
            {canEdit && (
                <>
                    <div className="h-24" aria-hidden="true" />
                    <CopperPill floating icon={<Plus aria-hidden="true" />} onClick={() => setSheet('new')}>{t('repo_add')}</CopperPill>
                </>
            )}
            <Sheet open={sheet === 'sort'} onClose={() => setSheet(null)} title={tm('sort_by')}>
                <div role="radiogroup" aria-label={tm('sort_by')} className="-mx-4 -mt-3">
                    <RadioRow checked={byName} label={tm('sort_repo_name')} divided={false} onSelect={() => { setByName(true); setSheet(null); }} />
                    <RadioRow checked={!byName} label={tm('sort_repo_sources')} divided onSelect={() => { setByName(false); setSheet(null); }} />
                </div>
            </Sheet>
            <RepositorySheet open={sheet === 'new'} repository={null} onClose={() => setSheet(null)}
                onSaved={(id) => { setSheet(null); window.location.assign(repositoryHref(id)); }} />
        </PageShell>
    );
}
