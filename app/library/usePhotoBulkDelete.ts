'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { getDataClient } from '@/lib/data';
import type { MediaDeleteBatchResult } from '@/lib/services/media';
import type { LibraryPhotoDeleteFailure } from '@/app/library/sections/LibraryPhotoBulkToolbar';
import type { LibraryTab } from '@/app/library/useLibraryTab';
import type { MediaWithPerson } from '@/lib/db/schema';

/**
 * Deleting the selected Library photos in chunks of 100, keeping per-photo failures
 * for a retry. Shared by the desktop toolbar and the phone's red Delete bar (#1119).
 */
export function usePhotoBulkDelete({ treeId, tab, photos, visibleIds, selectedIds, retainSelection, exitSelection, refresh }: {
  treeId: number | null;
  tab: LibraryTab;
  photos: Pick<MediaWithPerson, 'Id' | 'Title'>[];
  visibleIds: number[];
  selectedIds: ReadonlySet<number>;
  retainSelection: (ids: number[]) => void;
  exitSelection: () => void;
  refresh: () => Promise<unknown>;
}) {
  const t = useTranslations('library');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkFailures, setBulkFailures] = useState<LibraryPhotoDeleteFailure[]>([]);
  const [bulkCleanupWarningCount, setBulkCleanupWarningCount] = useState(0);
  const [bulkRequestError, setBulkRequestError] = useState<string | null>(null);
  const bulkGeneration = useRef(0);
  const visiblePhotoIdSet = useMemo(() => new Set(visibleIds), [visibleIds]);
  const visibleBulkFailures = useMemo(
    () => bulkFailures.filter((failure) => visiblePhotoIdSet.has(failure.id) && selectedIds.has(failure.id)),
    [bulkFailures, selectedIds, visiblePhotoIdSet],
  );
  const failedPhotoIds = useMemo(() => new Set(visibleBulkFailures.map((failure) => failure.id)), [visibleBulkFailures]);

  useEffect(() => {
    // A tab/tree transition starts a fresh bulk operation context. The
    // selection hook clears its IDs in the same transition; clear stale outcome
    // banners as well so they cannot follow a photo into another tree/tab.
    bulkGeneration.current += 1;
    setBulkBusy(false);
    setBulkFailures([]);
    setBulkCleanupWarningCount(0);
    setBulkRequestError(null);
  }, [treeId, tab]);

  useEffect(() => {
    // A filter can hide a failed item after a partial response. Do not leave a
    // retry action or failure marker that could reappear when that filter is
    // later removed; retry state follows the current visible selection.
    setBulkFailures((previous) => {
      const next = previous.filter((failure) => visiblePhotoIdSet.has(failure.id) && selectedIds.has(failure.id));
      return next.length === previous.length ? previous : next;
    });
  }, [selectedIds, visiblePhotoIdSet]);

  const deleteSelectedPhotos = useCallback(async () => {
    const ids = [...selectedIds].sort((left, right) => left - right);
    if (ids.length === 0) return;
    const operationGeneration = bulkGeneration.current;
    setBulkBusy(true);
    setBulkRequestError(null);
    const allResults: MediaDeleteBatchResult['results'] = [];
    let requestFailed = false;
    let unattemptedIds: number[] = [];
    try {
      const client = await getDataClient();
      if (operationGeneration !== bulkGeneration.current) return;
      for (let start = 0; start < ids.length; start += 100) {
        const chunk = ids.slice(start, start + 100);
        try {
          const result = await client.media.removeMany(chunk, treeId);
          if (operationGeneration !== bulkGeneration.current) return;
          allResults.push(...result.results);
        } catch {
          requestFailed = true;
          unattemptedIds = ids.slice(start);
          break;
        }
      }

      // Any completed request can change the visible list, including an
      // all-skipped terminal response. Refresh exactly once after the chunk
      // sequence, while preserving authoritative item outcomes if refresh fails.
      if (allResults.length > 0) {
        try {
          await refresh();
        } catch {
          // The deletion result is authoritative; a refresh can be retried by
          // the library focus/refetch lifecycle without changing outcomes.
        }
        if (operationGeneration !== bulkGeneration.current) return;
      }

      const aggregate: MediaDeleteBatchResult = {
        results: allResults,
        deletedCount: allResults.filter((item) => item.status === 'deleted').length,
        skippedCount: allResults.filter((item) => item.status === 'skipped').length,
        failedCount: allResults.filter((item) => item.status === 'failed').length,
        cleanupWarningCount: allResults.filter(
          (item) => item.status === 'deleted' && item.cleanupWarning !== null,
        ).length,
      };
      const failures = aggregate.results
        .filter((item): item is Extract<typeof item, { status: 'failed' }> => item.status === 'failed' && item.retryable)
        .map((item) => ({
          id: item.id,
          title: photos.find((photo) => photo.Id === item.id)?.Title ?? t('photo_alt'),
          code: item.code,
          retryable: true as const,
        }));
      const knownFailureIds = new Set(failures.map((failure) => failure.id));
      for (const id of unattemptedIds) {
        if (knownFailureIds.has(id)) continue;
        failures.push({
          id,
          title: photos.find((photo) => photo.Id === id)?.Title ?? t('photo_alt'),
          code: 'delete_failed',
          retryable: true,
        });
      }
      setBulkFailures(failures);
      setBulkCleanupWarningCount(aggregate.cleanupWarningCount);
      retainSelection(failures.map((failure) => failure.id));
      if (requestFailed) setBulkRequestError(t('delete_request_failed'));
      if (!requestFailed && aggregate.failedCount === 0) exitSelection();
    } catch {
      // Request-wide failures happen before item outcomes are available. Keep
      // the current selection intact so the user can retry without reselecting.
      if (operationGeneration === bulkGeneration.current) setBulkRequestError(t('delete_request_failed'));
    } finally {
      if (operationGeneration === bulkGeneration.current) setBulkBusy(false);
    }
  }, [treeId, exitSelection, photos, refresh, retainSelection, selectedIds, t]);

  return {
    busy: bulkBusy,
    cleanupWarningCount: bulkCleanupWarningCount,
    requestError: bulkRequestError,
    visibleFailures: visibleBulkFailures,
    failedIds: failedPhotoIds,
    deleteSelected: deleteSelectedPhotos,
  };
}
