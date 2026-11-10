'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTreeExport } from '@/app/components/tree/useTreeExport';
import { TreeData, TreeNode, FocusTrees } from '@/app/components/tree/types';
import { treeDepth, focusMaxDepth, pruneTreeDepth, pruneFocusDepth } from '@/lib/tree/pruneDepth';
import { useTree } from '@/app/contexts/TreeContext';
import { getDataClient } from '@/lib/data';
import { dataCache } from '@/lib/data/cache';
import { buildTreeCacheKey, parseTreeMode } from '@/app/components/tree/treeCache';
import { errorToastKey } from '@/lib/utils/data-error';
import { NotFoundError } from '@/lib/data/errors';
import { bestModeFor, type TreeMode } from './tree-page-helpers';
import { useDocumentScrollLock } from '@/app/hooks/useDocumentScrollLock';
import { useTranslations } from 'next-intl';
import { useErrorToast } from '@/app/components/useErrorToast';
import { useDocumentTitle } from '@/app/hooks/useDocumentTitle';

export function useTreeData() {
    const { activeTreeId, currentUserId } = useTree();
    const tCommon = useTranslations('common');
    const { redirectIfUnauthorized } = useErrorToast();
    const [treeData, setTreeData] = useState<TreeData | null>(null);
    const [loading, setLoading] = useState(true);
    const [isSavingTree, setIsSavingTree] = useState(false);
    const [fitViewVersion, setFitViewVersion] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [selectedRootId, setSelectedRootId] = useState<number | null>(null);
    const [mode, setMode] = useState<TreeMode>('descendants');
    const [selectedPersonId, setSelectedPersonId] = useState<number | null>(null);
    // Generation-depth limit. null = show all generations (the default). Reset
    // whenever the tree identity (root or mode) changes.
    const [depth, setDepthState] = useState<number | null>(null);
    // Card orientation (vertical portrait cards vs horizontal bars). A display
    // preference applied to descendants/ancestors; persisted like other tree prefs.
    const [orientation, setOrientationState] = useState<'vertical' | 'horizontal'>('vertical');
    // DEBUG (horizontal bar review aid — dev-only rail control): tune the zoom
    // threshold at which bars go name-only.
    const [barZoomThreshold, setBarZoomThreshold] = useState(0.6);

    const searchParams = useSearchParams();

    // Lock page scroll while on the tree page (prevents iOS Safari bounce/overscroll).
    useDocumentScrollLock(true, { overscrollBehavior: 'none', restoreScroll: false });

    // Restore persisted orientation on mount.
    useEffect(() => {
        const saved = localStorage.getItem('tree:orientation');
        if (saved === 'horizontal' || saved === 'vertical') setOrientationState(saved);
    }, []);

    const setOrientation = useCallback((o: 'vertical' | 'horizontal') => {
        setOrientationState(o);
        localStorage.setItem('tree:orientation', o);
        setFitViewVersion((v) => v + 1); // reframe — the bar layout has a different extent
    }, []);

    // Focus view is vertical-only (Phase 1). Adopt vertical as the *session* state
    // on entering focus rather than overriding it at render time only: the rail
    // showed neither orientation as active while focus rendered vertical, so
    // toggling back to root/leaf view snapped the canvas to horizontal bars —
    // which reads as "the root-view toggle forced horizontal layout". A mode
    // toggle must never change the layout you are looking at.
    //
    // Deliberately NOT setOrientation(): that persists. Focus is often entered by
    // the server's suggestedMode rather than by choice, so persisting here would
    // silently rewrite a horizontal user's saved preference for every future
    // session. A reload still restores whatever they actually chose.
    useEffect(() => {
        if (mode === 'focus') {
            setOrientationState('vertical');
            setFitViewVersion((v) => v + 1);
        }
    }, [mode]);

    const { exportAsJPEG, isExporting, setReactFlowInstance, containerRef } = useTreeExport();

    const lastLoadKeyRef = useRef<string | null>(null);
    const loadGenerationRef = useRef(0);

    const loadTree = useCallback(async (rootId?: number, viewMode?: TreeMode, options?: { silent?: boolean }) => {
        const generation = ++loadGenerationRef.current;
        const silent = options?.silent ?? false;
        const modeParam = viewMode || mode;

        const cacheKey = (rootId != null && viewMode !== undefined)
            ? buildTreeCacheKey(activeTreeId, rootId, viewMode)
            : null;
        const cached = (!silent && cacheKey) ? dataCache.get<TreeData>(cacheKey) : undefined;
        const haveCache = cached !== undefined;

        if (haveCache) {
            setTreeData(cached);
            setSelectedRootId(cached.currentRootId);
            setMode(cached.currentMode);
            lastLoadKeyRef.current = `${activeTreeId}:${cached.currentRootId}:${cached.currentMode}`;
            setError(null);
            setLoading(false);
            setFitViewVersion((v) => v + 1);
        } else if (silent) {
            setIsSavingTree(true);
            setError(null);
        } else {
            setLoading(true);
            setError(null);
            // A cache miss is a new tree/root/mode boundary. Hide the old
            // tree immediately so it cannot remain actionable while the
            // requested tree is loading. Same-key revalidation normally
            // hits the cache above and intentionally keeps stale data.
            setTreeData(null);
            // Keep the requested identity available to retry(). For an
            // explicit navigation this is the new root; an initial/default
            // load has no root to retain.
            setSelectedRootId(rootId ?? null);
            setMode(modeParam);
            setSelectedPersonId(null);
        }

        try {
            const client = await getDataClient();
            if (loadGenerationRef.current !== generation) return;
            const data = await client.tree.get({ id: rootId, mode: modeParam, treeId: activeTreeId });
            if (loadGenerationRef.current !== generation) return;
            setSelectedRootId(data.currentRootId);

            let resolvedMode = data.currentMode;
            if (viewMode === undefined && data.suggestedMode && data.suggestedMode !== modeParam) {
                resolvedMode = data.suggestedMode;
                setMode(data.suggestedMode);
                lastLoadKeyRef.current = `${activeTreeId}:${data.currentRootId}:${data.suggestedMode}`;
                try {
                    const reloadData = await client.tree.get({ id: data.currentRootId, mode: data.suggestedMode, treeId: activeTreeId });
                    if (loadGenerationRef.current !== generation) return;
                    setTreeData(reloadData);
                    dataCache.set(buildTreeCacheKey(activeTreeId, data.currentRootId, data.suggestedMode), reloadData);
                } catch (reloadError) {
                    if (loadGenerationRef.current !== generation) return;
                    if (redirectIfUnauthorized(reloadError)) return;
                    // The initial tree response is a valid fallback when the
                    // suggested-mode refinement fails; keep that established
                    // behavior rather than turning an optional refinement into
                    // a blocking load failure.
                    setTreeData(data);
                }
            } else {
                setTreeData(data);
                setMode(data.currentMode);
                lastLoadKeyRef.current = `${activeTreeId}:${data.currentRootId}:${data.currentMode}`;
                dataCache.set(buildTreeCacheKey(activeTreeId, data.currentRootId, data.currentMode), data);
            }

            if (data.currentRootId) {
                localStorage.setItem('selectedRootPerson', data.currentRootId.toString());
                localStorage.setItem('selectedRootMode', resolvedMode);
            }

            if (!silent && !haveCache) {
                setFitViewVersion((v) => v + 1);
            }
        } catch (err) {
            if (loadGenerationRef.current !== generation) return;
            if (redirectIfUnauthorized(err)) return;
            if (err instanceof NotFoundError) {
                if (haveCache) return;
                setTreeData(null);
                return;
            }
            // A failed revalidation keeps the current/cached tree visible while
            // exposing a translated error for the canvas to render and retry.
            setError(tCommon(errorToastKey(err)));
        } finally {
            if (loadGenerationRef.current !== generation) return;
            if (silent) {
                setIsSavingTree(false);
            } else if (!haveCache) {
                setLoading(false);
            }
        }
    }, [mode, activeTreeId, redirectIfUnauthorized, tCommon]);

    // Keep a ref to the latest loadTree so the mount effect doesn't re-fire when
    // loadTree is recreated due to mode changes.
    const loadTreeRef = useRef(loadTree);
    loadTreeRef.current = loadTree;

    // Load tree on mount - priority: URL param > localStorage > default
    useEffect(() => {
        if (currentUserId !== null) {
            const urlRootId = searchParams.get('rootId');
            const urlMode = parseTreeMode(searchParams.get('mode'));
            const requestedKey = (urlRootId && urlMode) ? `${activeTreeId}:${urlRootId}:${urlMode}` : null;
            if (requestedKey && requestedKey === lastLoadKeyRef.current) return;
            if (urlRootId) {
                loadTreeRef.current(parseInt(urlRootId, 10), urlMode ?? undefined);
            } else {
                const savedRootId = localStorage.getItem('selectedRootPerson');
                const restoredMode = parseTreeMode(localStorage.getItem('selectedRootMode'));
                if (savedRootId) {
                    loadTreeRef.current(parseInt(savedRootId, 10), urlMode ?? restoredMode ?? undefined);
                } else {
                    loadTreeRef.current(undefined, urlMode ?? undefined);
                }
            }
        }
    }, [searchParams, activeTreeId, currentUserId]);

    const tNav = useTranslations('nav');
    const titleRoot = treeData?.roots.find(r => r.id === treeData.currentRootId);
    useDocumentTitle(treeData ? (titleRoot?.name ?? tNav('tree')) : null);

    // Reflect the resolved root + view mode in the URL.
    useEffect(() => {
        const rootId = treeData?.currentRootId;
        if (rootId == null) return;
        const params = new URLSearchParams(window.location.search);
        if (params.get('rootId') !== String(rootId) || params.get('mode') !== mode) {
            params.set('rootId', String(rootId));
            params.set('mode', mode);
            window.history.replaceState(null, '', `/tree?${params.toString()}`);
        }
    }, [treeData, mode]);

    /**
     * Re-root / change direction without router.push. In the prod build, router.push to the same
     * /tree pathname with only a query change is a no-op when /tree was the hard-load entry, so we
     * load directly and sync the URL via the history API. lastLoadKeyRef is set synchronously so
     * the searchParams effect (Next feeds pushState into useSearchParams) no-ops.
     */
    const navigateTree = useCallback(
        (rootId: number, viewMode: TreeMode) => {
            lastLoadKeyRef.current = `${activeTreeId}:${rootId}:${viewMode}`;
            window.history.pushState(window.history.state, '', `/tree?rootId=${rootId}&mode=${viewMode}`);
            loadTree(rootId, viewMode);
        },
        [activeTreeId, loadTree],
    );

    /** Re-root the tree to a person (from search or sidebar focus), closing the sidebar. */
    const selectPerson = useCallback((personId: number) => {
        setSelectedPersonId(null);
        localStorage.setItem('selectedRootPerson', personId.toString());
        const info = treeData?.allPeople?.find(p => p.id === personId);
        navigateTree(personId, bestModeFor(info));
    }, [treeData, navigateTree]);

    const handlePersonClick = useCallback((id: number) => {
        setSelectedPersonId(id);
    }, []);

    const handleSidebarDataChanged = useCallback(() => {
        if (selectedRootId) loadTree(selectedRootId, mode, { silent: true });
    }, [selectedRootId, mode, loadTree]);

    function handleModeChange(newMode: TreeMode) {
        if (newMode !== mode && selectedRootId) {
            navigateTree(selectedRootId, newMode);
        }
    }

    function handleExport() {
        if (selectedRootId) exportAsJPEG(selectedRootId);
    }

    const retry = useCallback(() => {
        void loadTree(selectedRootId ?? undefined, mode);
    }, [loadTree, selectedRootId, mode]);

    // --- Generation-depth control -------------------------------------------
    // Loading a different root or switching direction is a fresh tree; go back
    // to "show all" so the depth limit never carries over to an unrelated view.
    useEffect(() => { setDepthState(null); }, [selectedRootId, mode]);

    // The tree's natural extent — drives the slider maximum ("all gens").
    const maxDepth = useMemo(() => {
        if (!treeData) return 0;
        if (mode === 'focus' && treeData.focusTrees) return focusMaxDepth(treeData.focusTrees);
        return treeDepth(treeData.tree);
    }, [treeData, mode]);

    // -1 means "no pruning" (helpers return the input by identity, so the layout
    // memo is not invalidated when showing everything).
    const effectiveDepth = depth == null || depth >= maxDepth ? -1 : depth;

    const displayTree = useMemo<TreeNode | null>(
        () => (treeData ? pruneTreeDepth(treeData.tree, effectiveDepth) : null),
        [treeData, effectiveDepth],
    );
    const displayFocusTrees = useMemo<FocusTrees | undefined>(
        () => (treeData?.focusTrees ? pruneFocusDepth(treeData.focusTrees, effectiveDepth) : undefined),
        [treeData, effectiveDepth],
    );

    // Commit a new depth (called on slider release) and re-fit the canvas so the
    // now-larger/smaller tree is reframed. Snapping to maxDepth means "all".
    const setDepth = useCallback((value: number) => {
        setDepthState(value >= maxDepth ? null : Math.max(1, value));
        setFitViewVersion((v) => v + 1);
    }, [maxDepth]);

    return {
        treeData,
        loading,
        error,
        retry,
        isSavingTree,
        fitViewVersion,
        selectedRootId,
        mode,
        selectedPersonId,
        setSelectedPersonId,
        selectPerson,
        handlePersonClick,
        handleSidebarDataChanged,
        handleModeChange,
        handleExport,
        isExporting,
        setReactFlowInstance,
        containerRef,
        // Depth control
        displayTree,
        displayFocusTrees,
        depth: depth ?? maxDepth,
        maxDepth,
        setDepth,
        // Orientation control
        orientation,
        setOrientation,
        // DEBUG bar-review controls
        barZoomThreshold,
        setBarZoomThreshold,
    };
}
