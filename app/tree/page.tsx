'use client';

import { Suspense, useCallback, useRef } from 'react';
import type { ReactFlowInstance } from 'reactflow';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import PersonSidebar from '@/app/components/tree/PersonSidebar';
import { useTree } from '@/app/contexts/TreeContext';
import { useLoadPhase } from '@/app/components/useLoadPhase';
import { Button, Card, InlineDataError, PageShell } from '@/app/components/ui';
import { Plus } from '@/lib/icons';
import { useTreeData } from './useTreeData';
import { useTreeSearch } from './useTreeSearch';
import { useTreeDisplayPrefs } from './useTreeDisplayPrefs';
import { useUnsavedChangesGuard } from '@/app/components/UnsavedChangesProvider';
import { TreeHeader } from './TreeHeader';
import { useIsMobile } from '@/app/hooks/useIsMobile';
import type { TreeDisplayProps } from './TreeDisplayControls';
import { TreeOverlays } from './TreeOverlays';
import type { TreeRootFace } from './TreeControlBar';
import type { TreeNode } from '@/app/components/tree/types';
import { READABLE_ZOOM } from '@/lib/tree/fitView';

const TreeVisualization = dynamic(() => import('@/app/components/tree/TreeVisualization'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full">
      <div className="skeleton w-full h-full" aria-hidden="true" />
    </div>
  ),
});

function TreePageContent() {
  const { activePermission } = useTree();
  const t = useTranslations('treeView');
  const tCommon = useTranslations('common');
  const isMobile = useIsMobile();
  const data = useTreeData();
  const {
    treeData, loading, error, retry, mode, selectedRootId, selectedPersonId, isSavingTree,
    isExporting, fitViewVersion, containerRef, selectPerson, setSelectedPersonId,
    handlePersonClick, handleSidebarDataChanged, handleModeChange, handleExport, setReactFlowInstance,
    displayTree, displayFocusTrees, depth, maxDepth, setDepth,
    orientation, setOrientation,
    barZoomThreshold, setBarZoomThreshold,
  } = data;
  // Focus view is vertical-only (Phase 1). useTreeData also commits 'vertical' to the
  // stored preference on entering focus; this guard covers the render before that
  // effect lands, so the canvas never flashes bars.
  const effectiveOrientation = mode === 'focus' ? 'vertical' : orientation;
  // Every action that replaces the sidebar/focused person (search, canvas
  // double-click, and the sidebar's Focus person button) comes through this
  // one callback. The sidebar editor is registered in the shared provider, so
  // this produces one prompt and leaves the current draft intact on cancel.
  const { guardNavigation } = useUnsavedChangesGuard(false);
  const guardedPersonSelect = useCallback((personId: number) => {
    if (!guardNavigation()) return false;
    selectPerson(personId);
    return true;
  }, [guardNavigation, selectPerson]);
  const guardedSidebarSelect = useCallback((personId: number) => {
    if (!guardNavigation()) return;
    handlePersonClick(personId);
  }, [guardNavigation, handlePersonClick]);
  const search = useTreeSearch(treeData?.allPeople, guardedPersonSelect);
  const { setShowDropdown } = search;
  const { colorblindMode, showAgeIndicator, setShowAgeIndicator } = useTreeDisplayPrefs();

  const phase = useLoadPhase(loading);

  // Bring into view (#71): move the canvas back to the root person, at no less than
  // a readable zoom, without refetching or laying the tree out again.
  const flowRef = useRef<ReactFlowInstance | null>(null);
  const onFlowReady = useCallback((instance: ReactFlowInstance) => {
    flowRef.current = instance;
    setReactFlowInstance(instance);
  }, [setReactFlowInstance]);
  const bringIntoView = useCallback(() => {
    const flow = flowRef.current;
    if (!flow || selectedRootId == null) return;
    const node = flow.getNodes().find((n) => (n.data as { person?: { id?: number } } | undefined)?.person?.id === selectedRootId);
    if (!node) return;
    const x = (node.positionAbsolute?.x ?? node.position.x) + (node.width ?? 0) / 2;
    const y = (node.positionAbsolute?.y ?? node.position.y) + (node.height ?? 0) / 2;
    flow.setCenter(x, y, { zoom: Math.max(flow.getZoom(), READABLE_ZOOM), duration: 300 });
  }, [selectedRootId]);

  const currentPersonInfo = treeData?.allPeople?.find(p => p.id === selectedRootId);
  const rootFace: TreeRootFace | null = findInTree(treeData?.tree, selectedRootId);
  // The chrome renders before the data does, so its controls must read as
  // "not yet" rather than as "unavailable": without this, the mode buttons were
  // clickable but inert (handleModeChange needs a root), Focus View claimed
  // "· n/a", and the search dropdown said "no people found" on a populated tree.
  const chromeReady = treeData !== null;
  const canViewDescendants = currentPersonInfo?.hasDescendants ?? true;
  const canViewAncestors = currentPersonInfo?.hasAncestors ?? true;
  // Focus view needs a connection in EITHER direction, not both. A leaf (no
  // descendants) still renders a valid Stage-D focus view: the centre cluster is
  // rooted at the parent, so the focus person simply appears as a childless node.
  // Requiring both directions used to disable the control for every leaf.
  const canFocus = (currentPersonInfo?.hasAncestors || currentPersonInfo?.hasDescendants) ?? false;
  // One settings bundle for the Display menu and the Display sheet below lg (#936).
  const display: TreeDisplayProps = {
    orientation: effectiveOrientation,
    onOrientationChange: setOrientation,
    orientationDisabled: mode === 'focus',
    barZoomThreshold,
    onBarZoomThresholdChange: setBarZoomThreshold,
    depth,
    maxDepth,
    onDepthCommit: setDepth,
    showAges: showAgeIndicator,
    onShowAgesChange: setShowAgeIndicator,
  };

  return (
    // On a phone the tree's own header replaces the app bar (#1122), so the page takes the whole height.
    <PageShell variant="workspace" className="flex flex-col overflow-hidden" style={{ height: isMobile ? '100dvh' : 'calc(100dvh - var(--nav-h))' }}>
      <TreeHeader
        mode={mode}
        ready={chromeReady}
        canViewDescendants={canViewDescendants}
        canViewAncestors={canViewAncestors}
        canFocus={canFocus}
        onModeChange={handleModeChange}
        currentPersonInfo={currentPersonInfo}
        rootFace={rootFace}
        onBringIntoView={bringIntoView}
        canExport={activePermission !== 'view'}
        onExport={handleExport}
        isExporting={isExporting}
        selectedRootId={selectedRootId}
        search={search}
        display={display}
      />

      {/* Tree container: canvas + person panel (no left rail since #71). */}
      <div className="flex-1 flex overflow-hidden relative">

        {/* Canvas wrapper. The control bar above renders immediately —
            only this interior waits on the fetch. */}
        <div ref={containerRef} className="flex-1 relative">
          {selectedPersonId !== null && treeData && (
            <PersonSidebar
              personId={selectedPersonId}
              onClose={() => setSelectedPersonId(null)}
              onFocusPerson={guardedPersonSelect}
              onDataChanged={handleSidebarDataChanged}
            />
          )}

          {error && !treeData ? (
            <div className="h-full flex items-center justify-center p-4">
              <div className="w-full max-w-[520px] space-y-3">
                <InlineDataError
                  message={error}
                  retryLabel={tCommon('retry')}
                  onRetry={retry}
                />
                <div className="text-center">
                  <Link href="/" className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-link hover:bg-hover-surface rounded-lg transition-colors">{tCommon('back_home')}</Link>
                </div>
              </div>
            </div>
          ) : phase === 'ready' && !treeData ? (
            <div className="h-full flex items-center justify-center p-4">
              <Card pad={false} className="p-8 text-center max-w-[360px]" style={{ width: '100%' }}>
                <h2 className="text-md font-bold mb-2" style={{ color: 'var(--text)' }}>{t('no_tree')}</h2>
                <p className="muted text-sm mb-4">{t('no_tree_desc')}</p>
                <Link href="/people/new"><Button variant="primary" size="md" icon={<Plus className="w-4 h-4" aria-hidden="true" />}>{t('add_first')}</Button></Link>
              </Card>
            </div>
          ) : !treeData ? (
            // Canvas-only loading state — same skeleton the dynamic import falls back
            // to, so the chrome stays put and only this region swaps.
            <div className="h-full p-2" role="status" aria-busy="true" aria-label={t('loading')}>
              <div className="skeleton w-full h-full rounded-lg" aria-hidden="true" />
            </div>
          ) : (
          <>
            {error && (
              <InlineDataError
                className="absolute left-3 right-3 top-3 z-10"
                message={error}
                retryLabel={tCommon('retry')}
                onRetry={retry}
              />
            )}
            <TreeVisualization
              treeData={displayTree ?? treeData.tree}
              mode={mode}
              orientation={effectiveOrientation}
              focusTrees={displayFocusTrees}
              onReady={onFlowReady}
              onPersonClick={guardedSidebarSelect}
              onPersonDoubleClick={guardedPersonSelect}
              onPaneClick={() => setShowDropdown(false)}
              sidebarSelectedId={selectedPersonId}
              colorblindMode={colorblindMode}
              showAgeIndicator={showAgeIndicator}
              barZoomThreshold={barZoomThreshold}
              fitViewVersion={fitViewVersion}
              isExporting={isExporting}
            />
          </>
          )}
        </div>
      </div>

      <TreeOverlays isSavingTree={isSavingTree} isExporting={isExporting} />
    </PageShell>
  );
}

/** The root person's face for the control bar: the tree root, or the first match below it. */
function findInTree(node: TreeNode | null | undefined, id: number | null): TreeRootFace | null {
  if (!node || id == null) return null;
  const stack: TreeNode[] = [node];
  while (stack.length > 0) {
    const n = stack.pop() as TreeNode;
    if (n.id === id) return { photoMediaId: n.photoMediaId, focalX: n.focalX, focalY: n.focalY, focalRadius: n.focalRadius, sex: n.sex };
    for (const sp of n.spouses ?? []) if (sp.id === id) return { photoMediaId: sp.photoMediaId, focalX: sp.focalX, focalY: sp.focalY, focalRadius: sp.focalRadius, sex: sp.sex };
    if (n.children) stack.push(...n.children);
  }
  return null;
}

function TreeSuspenseFallback() {
  const t = useTranslations('treeView');
  return (
    <div style={{ minHeight: 'calc(100dvh - var(--nav-h))', background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span className="muted text-base">{t('loading')}</span>
    </div>
  );
}

export default function TreePage() {
  return (
    <Suspense fallback={<TreeSuspenseFallback />}>
      <TreePageContent />
    </Suspense>
  );
}
