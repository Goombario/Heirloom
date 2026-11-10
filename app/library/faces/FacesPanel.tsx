'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { getDataClient } from '@/lib/data';
import { Banner, Button, EmptyState, showChangeToast, showSuccessToast, showInfoToast, showErrorToast } from '@/app/components/ui';
import { useIsMobile } from '@/app/hooks/useIsMobile';
import { Skeleton } from '@/app/components/SkeletonLoader';
import MediaLightbox from '@/app/components/lightbox/MediaLightbox';
import LibraryPanel, { LIBRARY_BODY_GRID } from '@/app/library/sections/LibraryPanel';
import { MobileFacesQueue } from './MobileFacesQueue';
import FaceQueuePanel, { faceQueueGroupAnchor } from './FaceQueuePanel';
import {
  FaceDecisionRow, FaceResolvedRow, FaceRowsHeader, FaceSettledRow, type FaceRowActions, type SettledFaceRow,
} from './FaceDecisionRows';
import { buildFaceRows, isConfirmAllRow, NO_SPLITS, type FaceRow, type FaceRowSplits } from './faceRows';
import { useFaceQueue } from './useFaceQueue';
import type { FaceDismissReason, Media, MediaFaceCandidate } from '@/lib/db/schema';
import type { FaceConfirmBatchResult } from '@/lib/data/types';
import type { FacePersonRef } from '@/lib/db/queries/media-faces';

function FacesSkeleton() {
  return (
    <div data-testid="faces-panel" aria-busy="true" className={LIBRARY_BODY_GRID}>
      <LibraryPanel label="">
        <Skeleton className="mx-2 mb-3 h-4 w-[70%] rounded-[3px]" />
        <Skeleton className="h-9 w-full rounded-md" />
      </LibraryPanel>
      <div className="card flex min-w-0 flex-col gap-3 p-4">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-[72px] w-full rounded-md" />)}
      </div>
    </div>
  );
}

/**
 * Library → Faces: the review queue for face regions read out of photo
 * metadata (#487), as decision rows (#1156). The Library shell owns the header and
 * tab strip; this component owns the panel and rows so it can be lazy-loaded.
 *
 * A row holds the person picked on it, and Tag confirms with that person: picking
 * alone writes nothing. Splitting a face off ("Not {person}") or a shared name into
 * one row per face ("Choose for each face") is page state too, each with Undo.
 */
export interface FacesPanelProps {
  treeId: number | null;
  canEdit: boolean;
  onPendingCountChange?: (count: number) => void;
}

type ConfirmOutcomeCounts = { confirmed: number; skipped: number; failed: number };

function confirmOutcomeCounts(result: Pick<FaceConfirmBatchResult, 'results'>): ConfirmOutcomeCounts {
  return result.results.reduce<ConfirmOutcomeCounts>((counts, item) => {
    counts[item.status]++;
    return counts;
  }, { confirmed: 0, skipped: 0, failed: 0 });
}

function confirmedIdsOf(result: Pick<FaceConfirmBatchResult, 'results'>): number[] {
  return result.results.filter(item => item.status === 'confirmed').map(item => item.candidateId);
}

/** A settled row and where it stood, so it stays in place among the live rows. */
export type SettledEntry = SettledFaceRow & { index: number };

function FacesPanel({ treeId, canEdit, onPendingCountChange }: FacesPanelProps) {
  const ft = useTranslations('faceTags');
  const tc = useTranslations('common');
  const [resolvedView, setResolvedView] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [splits, setSplits] = useState<FaceRowSplits>(NO_SPLITS);
  const [picks, setPicks] = useState<ReadonlyMap<string, FacePersonRef>>(new Map());
  const [settled, setSettled] = useState<SettledEntry[]>([]);
  const [photo, setPhoto] = useState<MediaFaceCandidate | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const isMobile = useIsMobile();
  // Phones report every action as the change toast with Undo (#1126); desktop keeps its toasts.
  const say = useCallback((tone: 'success' | 'info', message: string, undo?: () => void) => {
    if (isMobile) { showChangeToast({ message, onUndo: undo }); return; }
    const action = undo ? { label: ft('action_undo'), onClick: undo } : undefined;
    if (tone === 'success') showSuccessToast(message, action); else showInfoToast(message, action);
  }, [isMobile, ft]);

  const { groups, pendingTotal, loading, error, confirm, dismiss, undo, reload } = useFaceQueue(treeId, resolvedView);

  useEffect(() => { onPendingCountChange?.(pendingTotal); }, [onPendingCountChange, pendingTotal]);

  // Splits, picks and summaries belong to one tree's queue.
  const [shownTree, setShownTree] = useState(treeId);
  if (shownTree !== treeId) {
    setShownTree(treeId);
    setSplits(NO_SPLITS);
    setPicks(new Map());
    setSettled([]);
  }

  // The hook sets `loading: true` on every reload, including after each decision.
  // Only the very first load shows the skeleton; later reloads dim the list in place.
  const [initialLoad, setInitialLoad] = useState(true);
  useEffect(() => {
    if (!loading) setInitialLoad(false);
  }, [loading]);

  const rows = useMemo(() => (resolvedView ? [] : buildFaceRows(groups, splits, picks)), [resolvedView, groups, splits, picks]);
  const confirmAllRows = useMemo(() => rows.filter(isConfirmAllRow), [rows]);
  const confirmAllCount = confirmAllRows.reduce((n, row) => n + row.candidates.length, 0);

  // Live rows with each settled summary back at the place its row stood. An entry's
  // index is its row's place in this merged list when it settled, so earlier
  // summaries keep their slots and inserting in index order rebuilds the list.
  const items = useMemo(() => {
    const list: ({ row: FaceRow } | { settled: SettledEntry })[] = rows.map(row => ({ row }));
    for (const entry of [...settled].sort((a, b) => a.index - b.index)) {
      list.splice(Math.min(Math.max(entry.index, 0), list.length), 0, { settled: entry });
    }
    return list;
  }, [rows, settled]);

  const handleUndo = useCallback(async (ids: number[]) => {
    setSettled(list => list.filter(entry => !entry.candidates.some(c => ids.includes(c.Id))));
    try {
      const { restored, skipped } = await undo(ids);
      if (restored > 0) say('success', ft('toast_undone', { count: restored }));
      if (skipped > 0) say('info', ft('undo_withheld', { count: skipped }));
    } catch {
      showErrorToast(ft('action_failed'));
    }
  }, [undo, ft, say]);

  const notifyConfirmOutcome = useCallback((result: Pick<FaceConfirmBatchResult, 'results'>) => {
    const counts = confirmOutcomeCounts(result);
    const confirmedIds = confirmedIdsOf(result);
    const undoConfirmed = confirmedIds.length > 0 ? () => { void handleUndo(confirmedIds); } : undefined;

    if (counts.confirmed > 0 && counts.failed === 0 && counts.skipped === 0) {
      say('success', ft('toast_confirmed_all', { count: counts.confirmed }), undoConfirmed);
    } else if (counts.confirmed > 0) {
      say('info', ft('toast_confirmed_partial', counts), undoConfirmed);
    } else if (counts.failed > 0) {
      showErrorToast(ft('toast_confirmed_failed', { count: counts.failed }));
    } else {
      say('info', ft('toast_confirmed_skipped', { count: counts.skipped }));
    }
  }, [ft, handleUndo, say]);

  const settle = useCallback((row: FaceRow, candidates: MediaFaceCandidate[], outcome: SettledFaceRow['outcome']) => {
    if (candidates.length === 0) return;
    const index = items.findIndex(item => 'row' in item && item.row.key === row.key);
    setSettled(list => [...list, { key: `settled:${row.key}:${candidates[0].Id}`, name: row.group.sourceName ?? tc('unknown'), candidates, outcome, index }]);
    setPicks(map => { if (!map.has(row.key)) return map; const next = new Map(map); next.delete(row.key); return next; });
  }, [items, tc]);

  const handleTag = useCallback(async (row: FaceRow) => {
    const person = row.person;
    if (!person) return;
    setBusy(true);
    try {
      const result = await confirm(row.candidates.map(c => c.Id), person.id);
      const confirmed = new Set(confirmedIdsOf(result));
      settle(row, row.candidates.filter(c => confirmed.has(c.Id)), { kind: 'tagged', person: person.name });
      notifyConfirmOutcome(result);
    } catch {
      showErrorToast(ft('action_failed'));
    } finally {
      setBusy(false);
    }
  }, [confirm, settle, notifyConfirmOutcome, ft]);

  const handleDismiss = useCallback(async (row: FaceRow, candidates: MediaFaceCandidate[], reason: FaceDismissReason) => {
    const ids = candidates.map(c => c.Id);
    setBusy(true);
    try {
      const { dismissed } = await dismiss(ids, reason);
      settle(row, candidates, { kind: 'dismissed', reason });
      say('success', ft('toast_dismissed', { count: dismissed }), () => { void handleUndo(ids); });
    } catch {
      showErrorToast(ft('action_failed'));
    } finally {
      setBusy(false);
    }
  }, [dismiss, settle, say, ft, handleUndo]);

  const handlePick = useCallback((row: FaceRow, person: FacePersonRef) => {
    setPicks(map => new Map(map).set(row.key, person));
  }, []);

  // "Not {person}" moves one face to its own row, which then needs a name.
  const handleSplitNot = useCallback((row: FaceRow, candidate: MediaFaceCandidate) => {
    const notName = row.person?.name ?? row.group.sourceName ?? tc('unknown');
    setSplits(s => ({ ...s, notPerson: new Map(s.notPerson).set(candidate.Id, notName) }));
    setPicks(map => { const next = new Map(map); next.delete(`split:${candidate.Id}`); return next; });
    say('info', ft('toast_split_not'), () => {
      setSplits(s => { const next = new Map(s.notPerson); next.delete(candidate.Id); return { ...s, notPerson: next }; });
    });
  }, [say, ft, tc]);

  const handleEachFace = useCallback((row: FaceRow) => {
    const groupKey = row.group.groupKey;
    setSplits(s => ({ ...s, perFace: new Set(s.perFace).add(groupKey) }));
    say('info', ft('toast_split_each', { name: row.group.sourceName ?? tc('unknown'), count: row.candidates.length }), () => {
      setSplits(s => { const next = new Set(s.perFace); next.delete(groupKey); return { ...s, perFace: next }; });
    });
  }, [say, ft, tc]);

  const handleViewChange = useCallback((nextResolvedView: boolean) => {
    setResolvedView(nextResolvedView);
    setActiveKey(null);
    setSettled([]);
  }, []);

  const handleJump = useCallback((key: string) => {
    setActiveKey(key);
    const node = rowRefs.current.get(key);
    if (!node) return;
    node.focus({ preventScroll: true });
    node.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const handleConfirmAll = useCallback(async () => {
    if (confirmAllRows.length === 0) return;
    setBulkBusy(true);
    const results: FaceConfirmBatchResult['results'] = [];
    const tagged: { row: FaceRow; ids: Set<number> }[] = [];
    let requestError = false;
    try {
      let client: Awaited<ReturnType<typeof getDataClient>> | null = null;
      try {
        client = await getDataClient();
      } catch {
        requestError = true;
      }
      // Rows may each have a different person, so this is one confirmFaces call per
      // row. SEQUENTIAL, not Promise.all: on the hosted build that was N concurrent
      // HTTP mutations, and one rejection used to discard every other group's result
      // (#487 review). A row that fails is counted and reported; the rest stand.
      if (client) {
        for (const row of confirmAllRows) {
          const ids = row.candidates.map(c => c.Id);
          try {
            const result = await client.media.confirmFaces(ids, row.person!.id, treeId);
            results.push(...result.results);
            tagged.push({ row, ids: new Set(confirmedIdsOf(result)) });
          } catch {
            // A row whose request fails during preflight is a retryable failure for
            // every face in it. Keep later rows running and do not offer them to Undo.
            results.push(...ids.map(candidateId => ({
              candidateId,
              status: 'failed' as const,
              code: 'confirm_failed' as const,
              retryable: true as const,
            })));
          }
        }
      }
    } finally {
      for (const { row, ids } of tagged) settle(row, row.candidates.filter(c => ids.has(c.Id)), { kind: 'tagged', person: row.person!.name });
      // Always resync: partial success must not leave already-confirmed rows on screen.
      await reload();
      setBulkBusy(false);
    }
    if (requestError) {
      showErrorToast(ft('action_failed'));
      return;
    }
    notifyConfirmOutcome({ results });
  }, [confirmAllRows, treeId, reload, ft, notifyConfirmOutcome, settle]);

  const actions: FaceRowActions = {
    canEdit,
    busy: busy || bulkBusy,
    treeId,
    onPick: handlePick,
    onTag: (row) => void handleTag(row),
    onDismiss: (row, candidates, reason) => void handleDismiss(row, candidates, reason),
    onSplitNot: handleSplitNot,
    onEachFace: handleEachFace,
    onOpenPhoto: setPhoto,
  };

  if (initialLoad) return isMobile ? <div data-testid="faces-panel" aria-busy="true" className="h-40" /> : <FacesSkeleton />;

  const lightbox = photo && (
    <MediaLightbox items={[{ Id: photo.MediaId, Title: photo.MediaTitle ?? null } as Media]} index={0} treeId={treeId}
      canEdit={canEdit} canDelete={false} context="library" showDeleteAction={false}
      onClose={() => setPhoto(null)} onChangeIndex={() => {}} />
  );

  if (isMobile) {
    return (
      <>
        <MobileFacesQueue
          items={items}
          groups={groups}
          pendingTotal={pendingTotal}
          resolvedView={resolvedView}
          onView={handleViewChange}
          loading={loading}
          error={error}
          actions={actions}
          confirmAllCount={confirmAllCount}
          bulkBusy={bulkBusy}
          onConfirmAll={() => void handleConfirmAll()}
          onUndo={(ids) => void handleUndo(ids)}
        />
        {lightbox}
      </>
    );
  }

  const resolvedFaceCount = groups.reduce((count, group) => count + group.candidateCount, 0);
  const empty = resolvedView ? groups.length === 0 : items.length === 0;

  return (
    <div data-testid="faces-panel" className={LIBRARY_BODY_GRID}>
      <FaceQueuePanel
        rows={rows}
        pendingTotal={pendingTotal}
        resolvedView={resolvedView}
        confirmAllCount={confirmAllCount}
        bulkBusy={bulkBusy}
        canEdit={canEdit}
        activeKey={activeKey}
        onJump={handleJump}
        onViewChange={handleViewChange}
        onConfirmAll={() => void handleConfirmAll()}
      />

      <div className="min-w-0 pb-20">
        <div className="mb-3.5">
          <h2 className="serif m-0 text-xl font-semibold leading-tight text-text">
            {ft(resolvedView ? 'queue_resolved_title' : 'queue_title')}
          </h2>
          <p className="m-0 mt-0.5 text-sm text-text-secondary">
            {resolvedView ? ft('queue_resolved_subtitle', { count: resolvedFaceCount }) : ft('queue_banner')}
          </p>
        </div>

        {error && <Banner tone="error" className="mb-4">{ft('load_failed')}</Banner>}

        {!error && empty ? (
          <EmptyState
            variant="empty"
            title={resolvedView ? undefined : ft('queue_empty_title')}
            message={ft(resolvedView ? 'queue_resolved_empty_body' : 'queue_empty_body')}
            action={resolvedView ? undefined : (
              <Button variant="outline" size="sm" onClick={() => handleViewChange(true)}>{ft('queue_empty_action_resolved')}</Button>
            )}
          />
        ) : (
          // The rows' container (#1175). Not overflow-hidden: the person picker and row menus
          // open as popovers that may reach past its edge.
          <div className="card flex flex-col transition-opacity" style={{ opacity: loading ? 0.6 : 1 }} aria-busy={loading}>
            {resolvedView ? groups.map(group => (
              <FaceResolvedRow key={group.groupKey} name={group.sourceName ?? tc('unknown')} candidates={group.candidates}
                treeId={treeId} canUndo={canEdit} busy={busy} onUndo={() => void handleUndo(group.candidates.map(c => c.Id))} />
            )) : (
              <>
                {rows.length > 0 && <FaceRowsHeader />}
                {items.map(item => 'row' in item ? (
                  <FaceDecisionRow key={item.row.key} row={item.row} actions={actions} anchorId={faceQueueGroupAnchor(item.row.key)}
                    rowRef={(node) => { if (node) rowRefs.current.set(item.row.key, node); else rowRefs.current.delete(item.row.key); }} />
                ) : (
                  <FaceSettledRow key={item.settled.key} row={item.settled} treeId={treeId} canUndo={canEdit} busy={busy}
                    onUndo={() => void handleUndo(item.settled.candidates.map(c => c.Id))} />
                ))}
              </>
            )}
          </div>
        )}
      </div>
      {lightbox}
    </div>
  );
}

export default FacesPanel;
