'use client';

import { useEffect, useLayoutEffect, useState, useCallback, useRef, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { useTree } from '@/app/contexts/TreeContext';
import { useIsMobile } from '@/app/hooks/useIsMobile';
import { getDataClient } from '@/lib/data';
import { Input } from '@/app/components/ui/Input';
import { Button } from '@/app/components/ui/Button';
import { Banner, EmptyState, InlineDataError, PageShell } from '@/app/components/ui';
import AddMediaModal from '@/app/components/media/AddMediaModal';
import { Search, Plus, ImageUp, AlertTriangle, Check } from '@/lib/icons';
import { Skeleton, SkeletonGrid } from '@/app/components/SkeletonLoader';
import { useLoadPhase } from '@/app/components/useLoadPhase';
import { useLibrarySources } from '@/app/library/useLibrarySources';
import { useMediaStorage } from '@/app/library/useMediaStorage';
import { useSourceFilters, type SourceShow } from '@/app/library/useSourceFilters';
import { useLibraryTab, libraryView, type LibraryView } from '@/app/library/useLibraryTab';
import { useRepositoryList } from '@/app/library/useRepositoryList';
import { usePhotoFilters } from '@/app/library/usePhotoFilters';
import { usePhotoSelection } from '@/app/library/usePhotoSelection';
import { usePhotoBulkDelete } from '@/app/library/usePhotoBulkDelete';
import LibraryHeader from '@/app/library/sections/LibraryHeader';
import LibraryTabs from '@/app/library/sections/LibraryTabs';
import SourcesPanel, { type PanelRepository } from '@/app/library/sections/SourcesPanel';
import SourcesTable from '@/app/library/sections/SourcesTable';
import RepositoryHeader from '@/app/library/sections/RepositoryHeader';
import RepositoriesDialog from '@/app/library/sections/RepositoriesDialog';
import PhotosPanel from '@/app/library/sections/PhotosPanel';
import PhotosGrid from '@/app/library/sections/PhotosGrid';
import { LIBRARY_BODY_GRID } from '@/app/library/sections/LibraryPanel';
import LibraryPhotoSort from '@/app/library/sections/LibraryPhotoSort';
import LibraryPhotoBulkToolbar from '@/app/library/sections/LibraryPhotoBulkToolbar';
import { PHOTO_GRID_COLUMNS_CLASS, PHOTO_GRID_GAP_PX } from '@/app/library/sections/photo-grid-layout';
import RepositoryModal from '@/app/library/RepositoryModal';
import SourceModal from '@/app/library/SourceModal';
import MobileLibrary from '@/app/library/MobileLibrary';
import { errorToastKey } from '@/lib/utils/data-error';
import { useDocumentTitle } from '@/app/hooks/useDocumentTitle';

const PANEL_ROW_WIDTHS = ['50%', '48%', '62%', '44%', '58%', '52%', '46%', '60%', '54%'];

function getDocumentScrollTop() {
  return (document.scrollingElement ?? document.documentElement).scrollTop;
}

function setDocumentScrollTop(top: number) {
  (document.scrollingElement ?? document.documentElement).scrollTop = top;
}

const FacesPanel = dynamic(() => import('@/app/library/faces/FacesPanel'), {
  ssr: false,
  loading: () => (
    <div className="min-h-[320px] w-full" aria-busy="true">
      <Skeleton className="h-[150px] w-full rounded-card" />
    </div>
  ),
});

function LibrarySkeleton({ isPhotos }: { isPhotos: boolean }) {
  return (
    <PageShell busy>
      {/* Header */}
      <div>
        <div className="row justify-between mb-3.5 flex-wrap gap-3">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-7 w-[150px] rounded-[4px]" />
            <Skeleton className="h-3 w-[220px] rounded-[4px]" />
          </div>
        </div>
        {/* Tab strip */}
        <div className="flex gap-[2px] mb-[22px]">
          {[90, 80, 70].map((w, i) => (
            <Skeleton key={i} className="h-[34px] rounded-t-[4px] mr-[2px]" style={{ width: w }} />
          ))}
        </div>
      </div>
      <div className={LIBRARY_BODY_GRID} style={{ minHeight: 'calc(100vh - 220px)' }}>
        {/* Floating panel */}
        <aside className="rounded-panel border border-border bg-card shadow-[var(--shadow-float)] px-3 py-4">
          <Skeleton className="h-[9px] w-[50px] mb-2.5 ml-2 rounded-[2px]" />
          {PANEL_ROW_WIDTHS.map((w, i) => (
            <div key={i} className="flex justify-between items-center py-[7px] px-2 mb-[2px]">
              <Skeleton className="h-[11px] rounded-[3px]" style={{ width: w }} />
              <Skeleton className="h-[9px] w-[18px] rounded-[3px]" />
            </div>
          ))}
        </aside>
        <div>
          {/* Search bar */}
          <div className="flex items-center gap-2.5 mb-3.5 py-2 px-3 rounded-md border border-border bg-card">
            <Skeleton className="w-4 h-4 rounded-[3px]" />
            <Skeleton className="h-3.5 flex-1 rounded-[3px]" />
          </div>
          {isPhotos ? (
            <div className="card overflow-hidden">
              <div className="h-[38px] border-b border-border bg-card-alt" />
              <div className="p-4">
                <SkeletonGrid items={12} columns={null} gap={PHOTO_GRID_GAP_PX} className={PHOTO_GRID_COLUMNS_CLASS} />
              </div>
            </div>
          ) : (
            <div className="card flex flex-col overflow-hidden px-1.5">
              {['55%', '40%', '68%', '48%', '62%', '44%', '58%', '50%'].map((titleW, i) => (
                <div key={i} className="flex items-center gap-2.5 py-3 px-1.5 border-t border-border-light first:border-t-0">
                  <Skeleton className="w-[30px] h-[30px] rounded-md" />
                  <div className="flex flex-1 flex-col gap-1.5">
                    <Skeleton className="h-3.5 rounded-[3px]" style={{ width: titleW }} />
                    <Skeleton className="h-[10px] w-[30%] rounded-[3px]" />
                  </div>
                  <Skeleton className="h-3 w-[110px] rounded-[3px]" />
                  <Skeleton className="h-3 w-8 rounded-[3px]" />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </PageShell>
  );
}

function LibraryPageContent() {
  const t = useTranslations('library');
  const tCommon = useTranslations('common');
  const { activeTreeId, activePermission, currentUserId } = useTree();
  const router = useRouter();
  const searchParams = useSearchParams();
  const canEdit = activePermission !== 'view';
  const canDelete = activePermission === 'owner' || activePermission === 'edit';

  const [uploadOpen, setUploadOpen] = useState(false);
  const [newRepoOpen, setNewRepoOpen] = useState(false);
  const [editRepoId, setEditRepoId] = useState<number | null>(null);
  const { tab, setTab } = useLibraryTab();
  const view = libraryView(tab);
  const [manageReposOpen, setManageReposOpen] = useState(tab === 'repositories');
  // Bumped after a repository is added, edited or deleted so its lists reload.
  const [repoRefreshTick, setRepoRefreshTick] = useState(0);

  const {
    sources,
    photos,
    loading,
    sourceError,
    photoError,
    photoLoading,
    retrySources,
    retryPhotos,
    refetch,
  } = useLibrarySources(activeTreeId, currentUserId !== null);

  const {
    summary: photoStorageSummary,
    loading: photoStorageLoading,
    error: photoStorageError,
    retry: retryPhotoStorage,
    refresh: refreshPhotoStorage,
  } = useMediaStorage(activeTreeId, view === 'photos' && currentUserId !== null);
  const refreshPhotosAndStorage = useCallback(async () => {
    await Promise.all([refetch(), refreshPhotoStorage()]);
  }, [refetch, refreshPhotoStorage]);
  const [photoSearch, setPhotoSearch] = useState('');
  // Keep the queue mounted after its first activation so its pending/resolved
  // view survives switching to another Library tab.
  const [facesActivated, setFacesActivated] = useState(view === 'faces');
  const scrollPositions = useRef(new Map<LibraryView, number>());
  const previousView = useRef<LibraryView>(view);
  const previousTreeId = useRef(activeTreeId);

  // Faces tab badge (#487 review) — lifted here from LibraryTabs, which used to
  // fetch this itself on every page that renders the tab strip. This page never
  // mutates the face queue, so a fetch on treeId change is enough to stay correct.
  const [facesPending, setFacesPending] = useState<number | undefined>(undefined);
  const handlePendingCountChange = useCallback((count: number) => setFacesPending(count), []);
  const selectTab = useCallback((next: LibraryView) => setTab(next), [setTab]);

  // The Show filter (#1154). An old `?tab=uncited` link turns it on, and an old
  // `?tab=repositories` link opens Manage repositories, both over Sources.
  const [show, setShow] = useState<SourceShow>(tab === 'uncited' ? 'uncited' : 'all');
  const [shownTab, setShownTab] = useState(tab);
  if (shownTab !== tab) {
    setShownTab(tab);
    // A browser-history/direct URL transition can activate Faces without a click
    // handler, so retain the mounted panel for later tab switches.
    if (tab === 'faces') setFacesActivated(true);
    if (tab === 'uncited') setShow('uncited');
    if (tab === 'repositories') setManageReposOpen(true);
  }
  useEffect(() => {
    if (tab !== 'uncited' && tab !== 'repositories') return;
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', 'sources');
    router.replace(`/library?${params.toString()}`, { scroll: false });
  }, [tab, searchParams, router]);

  useEffect(() => {
    const handleDocumentScroll = () => {
      // During a tree transition, the old page position is stale for the new
      // data context and must not be captured into the new tab's map.
      if (previousTreeId.current === activeTreeId) {
        scrollPositions.current.set(view, getDocumentScrollTop());
      }
    };
    window.addEventListener('scroll', handleDocumentScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleDocumentScroll);
  }, [activeTreeId, view]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const client = await getDataClient();
        // countOnly (#487 review): the badge is one integer — without it this
        // pulled every pending candidate, every person name, and a full-table
        // name match per ambiguous name on every Library mount.
        const { pendingTotal } = await client.media.listFaceQueue({ resolved: false, countOnly: true }, activeTreeId);
        if (!cancelled) setFacesPending(pendingTotal);
      } catch {
        // The badge is a nudge, not core content — a failed count just stays absent.
      }
    })();
    return () => { cancelled = true; };
  }, [activeTreeId]);

  // Preserve each view's position while the shared shell swaps its panel. A
  // tree switch is a new data context, so stale positions must not leak into it.
  useLayoutEffect(() => {
    const treeChanged = previousTreeId.current !== activeTreeId;
    if (treeChanged) {
      scrollPositions.current.clear();
      previousTreeId.current = activeTreeId;
      setDocumentScrollTop(0);
    }
    if (treeChanged) {
      previousView.current = view;
      return;
    }
    if (previousView.current === view) return;
    previousView.current = view;
    const position = scrollPositions.current.get(view) ?? 0;
    setDocumentScrollTop(position);
  }, [activeTreeId, view]);

  const {
    search: sourceSearch,
    setSearch: setSourceSearch,
    typeFilter,
    setTypeFilter,
    clearFilters,
    typeCounts,
    filteredSources,
    tabCounts,
  } = useSourceFilters(sources, show);
  const {
    tagFilter,
    setTagFilter,
    sort,
    setSort,
    visiblePhotos,
    photoCounts,
    clearPhotoFilters,
    typeFilter: mediaType,
    setTypeFilter: setMediaType,
  } = usePhotoFilters(photos, photoSearch);
  const reviewLargestPhotos = useCallback(() => {
    setSort('size-desc');
  }, [setSort]);
  const visibleIds = useMemo(() => visiblePhotos.map((photo) => photo.Id), [visiblePhotos]);
  const {
    mode: photoSelectionMode,
    selectedIds: selectedPhotoIds,
    enter: enterPhotoSelection,
    exit: exitPhotoSelection,
    toggle: togglePhotoSelection,
    selectVisible: selectVisiblePhotos,
    clear: clearPhotoSelection,
    retain: retainPhotoSelection,
  } = usePhotoSelection({ visibleIds, active: view === 'photos', treeId: activeTreeId });
  const {
    busy: bulkBusy,
    cleanupWarningCount: bulkCleanupWarningCount,
    requestError: bulkRequestError,
    visibleFailures: visibleBulkFailures,
    failedIds: failedPhotoIds,
    deleteSelected: deleteSelectedPhotos,
  } = usePhotoBulkDelete({
    treeId: activeTreeId,
    tab: view,
    photos,
    visibleIds,
    selectedIds: selectedPhotoIds,
    retainSelection: retainPhotoSelection,
    exitSelection: exitPhotoSelection,
    refresh: refreshPhotosAndStorage,
  });
  const allVisiblePhotosSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedPhotoIds.has(id));

  const search = view === 'photos' ? photoSearch : sourceSearch;
  const setSearch = view === 'photos' ? setPhotoSearch : setSourceSearch;

  // `?source=<id>` opens the source detail as a `SourceModal` over the list,
  // which stays mounted behind the scrim. Opening sets the param (history
  // entry, so back/forward + deep links work); closing clears it.
  const sourceParam = searchParams.get('source');
  const openSourceId = sourceParam && /^\d+$/.test(sourceParam) ? Number(sourceParam) : null;

  // `?repo=<id>` is the repository view of the Sources table (#1154): the panel's
  // Repository filter, deep-linkable, with back/forward stepping through picks.
  const repoParam = searchParams.get('repo');
  const repoId = repoParam && /^\d+$/.test(repoParam) ? Number(repoParam) : null;

  const pushParams = useCallback((edit: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchParams.toString());
    edit(params);
    const qs = params.toString();
    router.push(qs ? `/library?${qs}` : '/library', { scroll: false });
  }, [router, searchParams]);

  const openSource = useCallback((id: number) => {
    pushParams((params) => params.set('source', String(id)));
  }, [pushParams]);

  const closeSource = useCallback(() => {
    pushParams((params) => params.delete('source'));
  }, [pushParams]);

  const selectRepo = useCallback((id: number | null) => {
    pushParams((params) => {
      params.delete('source');
      // A repository is a Sources filter, so picking one from another tab lands there.
      params.set('tab', 'sources');
      if (id === null) params.delete('repo');
      else params.set('repo', String(id));
    });
  }, [pushParams]);

  const repositories = useRepositoryList(activeTreeId, currentUserId !== null && view === 'sources', repoRefreshTick);
  const selectedRepo = repoId === null ? null : repositories?.find((r) => r.Id === repoId) ?? null;
  // A repository that is gone (deleted, or a stale link) drops out of the URL.
  useEffect(() => {
    if (repoId === null || repositories === null || selectedRepo !== null) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete('repo');
    const qs = params.toString();
    router.replace(qs ? `/library?${qs}` : '/library', { scroll: false });
  }, [repoId, repositories, selectedRepo, searchParams, router]);

  // Repository counts come from the loaded sources, so they agree with the table.
  const panelRepositories = useMemo<PanelRepository[]>(() => {
    const counts = new Map<number, number>();
    for (const source of sources) {
      if (source.RepositoryId != null) counts.set(source.RepositoryId, (counts.get(source.RepositoryId) ?? 0) + 1);
    }
    return (repositories ?? [])
      .filter((r) => (counts.get(r.Id) ?? 0) > 0 || r.Id === repoId)
      .map((r) => ({ id: r.Id, name: r.Name, count: counts.get(r.Id) ?? 0 }));
  }, [sources, repositories, repoId]);

  const tableSources = useMemo(
    () => repoId === null ? filteredSources : filteredSources.filter((s) => s.RepositoryId === repoId),
    [filteredSources, repoId],
  );
  const sourceFilterActive = sourceSearch.trim() !== '' || typeFilter !== null || show !== 'all' || repoId !== null;
  const clearSourceFilters = useCallback(() => {
    clearFilters();
    setShow('all');
    if (repoId !== null) selectRepo(null);
  }, [clearFilters, repoId, selectRepo]);

  const refreshRepositories = useCallback(() => {
    setRepoRefreshTick((n) => n + 1);
    void refetch();
  }, [refetch]);

  useDocumentTitle(t('title'));

  const goToNewSource = useCallback(() => { router.push('/library/new'); }, [router]);
  const addSourceToRepo = useCallback((name: string) => {
    router.push(`/library/new?repository=${encodeURIComponent(name)}`);
  }, [router]);

  // delay: 0 — skeleton-first, so a hard reload ships LibrarySkeleton in the prerendered
  // HTML instead of the blank surface the `pending` branch below paints. Only Sources
  // waits for the source list; Photos and Faces paint their own loading states (#1157).
  const phase = useLoadPhase(currentUserId === null || (view === 'sources' && loading), { delay: 0 });
  if (phase === 'loading' || phase === 'pending') {
    return phase === 'loading'
      ? <LibrarySkeleton isPhotos={view === 'photos'} />
      : <PageShell busy />;
  }

  const sourcesEmpty = sourceError != null && sources.length === 0 ? null : (
    sources.length === 0 ? (
      <EmptyState
        variant="empty"
        title={t('empty_sources_title')}
        message={t('empty_sources_hint')}
        action={canEdit ? (
          <Button variant="outline" size="sm" onClick={goToNewSource}>{t('add_source')}</Button>
        ) : undefined}
      />
    ) : selectedRepo && !sourceSearch.trim() && typeFilter === null && show === 'all' ? (
      <EmptyState variant="empty" message={t('repo_no_sources')} />
    ) : show === 'uncited' && !sourceSearch.trim() && typeFilter === null && repoId === null ? (
      <EmptyState variant="empty" message={t('empty_uncited')} />
    ) : (
      <EmptyState
        variant="filtered"
        message={t('empty_no_match')}
        clearLabel={tCommon('clear_filters')}
        onClear={clearSourceFilters}
      />
    )
  );

  return (
    <PageShell>
      {/* Header + tabs */}
      <div className="mb-[22px]">
        <LibraryHeader />
        <LibraryTabs
          activeTab={view}
          tabCounts={loading
            ? { faces: facesPending }
            : { sources: tabCounts.sources, photos: photos.length, faces: facesPending }}
          onSelect={selectTab}
        />
      </div>

      {(view === 'faces' || facesActivated) && (
        <div
          hidden={view !== 'faces'}
          aria-hidden={view !== 'faces' || undefined}
          role="tabpanel"
          id="library-panel-faces"
          aria-labelledby="library-tab-faces"
        >
          <FacesPanel
            treeId={activeTreeId}
            canEdit={canEdit}
            onPendingCountChange={handlePendingCountChange}
          />
        </div>
      )}

      {view !== 'faces' && (
        <div className={LIBRARY_BODY_GRID} style={{ minHeight: 'calc(100vh - 220px)' }}>
          {view === 'sources' ? (
            <SourcesPanel
              totalCount={tabCounts.sources}
              uncitedCount={tabCounts.uncited}
              show={show}
              setShow={setShow}
              typeCounts={typeCounts}
              typeFilter={typeFilter}
              setTypeFilter={setTypeFilter}
              repositories={panelRepositories}
              repoId={repoId}
              setRepoId={selectRepo}
              canEdit={canEdit}
              onAddRepository={() => setNewRepoOpen(true)}
              onManageRepositories={() => setManageReposOpen(true)}
            />
          ) : (
            <PhotosPanel
              tagFilter={tagFilter}
              setTagFilter={setTagFilter}
              typeFilter={mediaType}
              setTypeFilter={setMediaType}
              photoCounts={photoCounts}
              storage={{
                summary: photoStorageSummary,
                loading: photoStorageLoading,
                error: photoStorageError,
                onRetry: () => { void retryPhotoStorage(); },
                onReviewLargest: reviewLargestPhotos,
              }}
            />
          )}

          <div
            role="tabpanel"
            id={`library-panel-${view}`}
            aria-labelledby={`library-tab-${view}`}
            tabIndex={0}
            className={`min-w-0 ${view === 'photos' && photoSelectionMode === 'select' ? 'pb-32' : 'pb-[18px]'}`}
          >
            {/* Toolbar: a white search field like People's, then the tab's actions; the main one goes last (#748, #1175). */}
            <div className="flex items-center gap-2 mb-3.5">
              <div className="flex-1 min-w-0">
                <Input
                  icon={<Search size={16} aria-hidden="true" />}
                  placeholder={view === 'photos' ? t('search_photos_placeholder') : t('search_sources_placeholder')}
                  aria-label={view === 'photos' ? t('search_photos_placeholder') : t('search_sources_placeholder')}
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
              {view === 'sources' && canEdit && (
                <Button
                  variant="primary"
                  size="md"
                  icon={<Plus size={15} aria-hidden="true" />}
                  onClick={goToNewSource}
                >
                  {t('add_source_fab_label')}
                </Button>
              )}
              {view === 'photos' && (
                <>
                  <LibraryPhotoSort sort={sort} setSort={setSort} />
                  <LibraryPhotoBulkToolbar
                    canDelete={canDelete}
                    selectionMode={photoSelectionMode === 'select'}
                    selectedCount={selectedPhotoIds.size}
                    visibleCount={visibleIds.length}
                    allVisibleSelected={allVisiblePhotosSelected}
                    busy={bulkBusy}
                    onEnter={enterPhotoSelection}
                    onDone={exitPhotoSelection}
                    onSelectAll={selectVisiblePhotos}
                    onClear={clearPhotoSelection}
                    onDelete={deleteSelectedPhotos}
                  />
                  {canEdit && (
                    <Button
                      variant="primary"
                      size="md"
                      icon={<ImageUp size={15} aria-hidden="true" />}
                      onClick={() => setUploadOpen(true)}
                    >
                      {t('upload_photo')}
                    </Button>
                  )}
                </>
              )}
            </div>

            {view === 'photos' ? (
              <>
                {(bulkRequestError || visibleBulkFailures.length > 0 || bulkCleanupWarningCount > 0) && (
                  <div data-testid="photo-bulk-outcomes" className="mb-3 space-y-2">
                    {bulkRequestError && (
                      <Banner tone="error" icon={<AlertTriangle size={16} />}>
                        {bulkRequestError}
                      </Banner>
                    )}
                    {visibleBulkFailures.length > 0 && (
                      <Banner tone="error" icon={<AlertTriangle size={16} />}>
                        <ul className="space-y-1">
                          {visibleBulkFailures.map((failure) => (
                            <li key={failure.id}>{t('delete_failed_item', { title: failure.title })}</li>
                          ))}
                        </ul>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={deleteSelectedPhotos}
                          disabled={bulkBusy}
                          className="mt-2 min-h-11 md:min-h-0"
                        >
                          {t('retry_failed')}
                        </Button>
                      </Banner>
                    )}
                    {bulkCleanupWarningCount > 0 && (
                      <Banner tone="warning" icon={<Check size={16} />}>
                        {t('cleanup_warning', { count: bulkCleanupWarningCount })}
                      </Banner>
                    )}
                  </div>
                )}
                <section data-testid="library-photo-grid" aria-labelledby="library-photo-grid-title" className="card overflow-hidden">
                  {/* The grid's container (#1175): a card-alt band names the view and counts it. */}
                  <div className="flex min-h-[38px] items-center justify-between gap-3 border-b border-border bg-card-alt px-4 py-2">
                    <h2 id="library-photo-grid-title" className="serif m-0 text-sm font-semibold text-text">
                      {t(mediaType === 'documents' ? 'media_grid_documents'
                        : mediaType === 'photos' ? 'media_grid_photos'
                        : tagFilter === 'tagged' ? 'photo_grid_tagged' : tagFilter === 'untagged' ? 'photo_grid_untagged' : 'photo_grid_all')}
                    </h2>
                    {!photoLoading && (
                      <span className="text-meta text-text-muted tabular-nums">{t('photo_count', { count: visiblePhotos.length })}</span>
                    )}
                  </div>
                  <div className="p-4">
                  {photoError != null && (
                    <InlineDataError
                      className="mb-3"
                      message={tCommon(errorToastKey(photoError))}
                      retryLabel={tCommon('retry')}
                      onRetry={() => { void retryPhotos(); }}
                    />
                  )}
                  {(photoError == null || visiblePhotos.length > 0) && (
                    <PhotosGrid
                      photos={visiblePhotos}
                      loading={photoLoading}
                      treeId={activeTreeId}
                      canEdit={canEdit}
                      canDelete={canDelete}
                      onPrimaryChanged={refreshPhotosAndStorage}
                      showFileSizes={sort === 'size-desc'}
                      selectionMode={photoSelectionMode === 'select'}
                      selectionDisabled={bulkBusy}
                      selectedIds={selectedPhotoIds}
                      failedIds={failedPhotoIds}
                      onToggleSelection={togglePhotoSelection}
                      emptyState={photos.length === 0 ? (
                        <EmptyState
                          variant="empty"
                          inset
                          message={t('empty_no_photos')}
                          action={canEdit ? (
                            <Button variant="outline" size="sm" onClick={() => setUploadOpen(true)}>{t('upload_photo')}</Button>
                          ) : undefined}
                        />
                      ) : (
                        <EmptyState
                          variant="filtered"
                          inset
                          message={t('empty_no_photo_match')}
                          clearLabel={tCommon('clear_filters')}
                          onClear={() => { setPhotoSearch(''); clearPhotoFilters(); }}
                        />
                      )}
                    />
                  )}
                  </div>
                </section>
              </>
            ) : (
              <>
                {sourceError != null && (
                  <InlineDataError
                    className="mb-3"
                    message={tCommon(errorToastKey(sourceError))}
                    retryLabel={tCommon('retry')}
                    onRetry={() => { void retrySources(); }}
                  />
                )}
                {selectedRepo && (
                  <RepositoryHeader
                    name={selectedRepo.Name}
                    address={selectedRepo.Address}
                    count={panelRepositories.find((r) => r.id === selectedRepo.Id)?.count ?? 0}
                    canEdit={canEdit}
                    onEdit={() => setEditRepoId(selectedRepo.Id)}
                    onAddSource={() => addSourceToRepo(selectedRepo.Name)}
                  />
                )}
                {show === 'uncited' && sources.length > 0 && (
                  <p data-testid="library-uncited-note" className="m-0 mt-1 mb-4 border-l-[3px] border-evidence pl-3.5 text-sm text-text-secondary">
                    {t('uncited_note')}
                  </p>
                )}
                {(sourceError == null || sources.length > 0) && (
                  tableSources.length === 0 ? sourcesEmpty : (
                    <div className="card overflow-hidden">
                      <SourcesTable
                        sources={tableSources}
                        treeId={activeTreeId}
                        onOpen={openSource}
                        hideRepository={selectedRepo !== null}
                      />
                    </div>
                  )
                )}
                {sourceFilterActive && tableSources.length > 0 && (
                  <p className="mt-3 text-meta text-text-muted tabular-nums">
                    {t('sources_shown', { shown: tableSources.length, total: sources.length })}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {openSourceId !== null && (
        <SourceModal
          key={openSourceId}
          sourceId={openSourceId}
          treeId={activeTreeId}
          canEdit={canEdit}
          canDelete={canDelete}
          onClose={closeSource}
          onChanged={refetch}
        />
      )}

      {manageReposOpen && (
        <RepositoriesDialog
          treeId={activeTreeId}
          canEdit={canEdit}
          refreshKey={repoRefreshTick}
          onOpenRepo={(id) => { setManageReposOpen(false); selectRepo(id); }}
          onAddRepository={() => { setManageReposOpen(false); setNewRepoOpen(true); }}
          onClose={() => setManageReposOpen(false)}
        />
      )}

      {(editRepoId !== null || newRepoOpen) && (
        <RepositoryModal
          key={editRepoId ?? 'new-repo'}
          repositoryId={editRepoId}
          treeId={activeTreeId}
          canEdit={canEdit}
          canDelete={canDelete}
          onClose={() => { setEditRepoId(null); setNewRepoOpen(false); }}
          onChanged={refreshRepositories}
          onOpenSource={(id) => { setEditRepoId(null); openSource(id); }}
        />
      )}

      {/* Owner-less upload → a plain library Media (no PersonId, no MediaLink).
          It surfaces in this Photos grid immediately (getAllMedia has no owner
          filter) and can be attached to any owner later from Add media. */}
      {uploadOpen && (
        <AddMediaModal
          target={{ kind: 'library' }}
          treeId={activeTreeId}
          storageSummary={photoStorageSummary}
          onMediaChanged={() => { void refreshPhotosAndStorage(); }}
          onClose={() => setUploadOpen(false)}
          onAdded={() => { setUploadOpen(false); }}
        />
      )}
    </PageShell>
  );
}

export default function LibraryPage() {
  // The fallback is the same skeleton the content renders while loading, NOT a text
  // line. It matters only in the static export, where `useSearchParams()` in
  // LibraryPageContent forces this fallback into the prerendered HTML — so it, not the
  // content's own loading branch, is the first frame on a hard load. (In the hosted
  // build the content renders server-side without suspending and this never fires,
  // which is why the content also needs its own skeleton-first `delay: 0`.)
  //
  // isPhotos: the tab lives in ?tab=, which is exactly what is unavailable here;
  // Photos is the default tab (#1157), so it is the right guess.
  return (
    <Suspense fallback={<LibrarySkeleton isPhotos />}>
      <LibraryRoute />
    </Suspense>
  );
}

/** Phones get their own Library (#1119); the switch remounts, so neither keeps the other's hooks. */
function LibraryRoute() {
  return useIsMobile() ? <MobileLibrary /> : <LibraryPageContent />;
}
