'use client';

import { useCallback, useEffect, useState } from 'react';
import { getDataClient } from '@/lib/data';
import type { FaceGroup } from '@/lib/data/types';
import type { FaceDismissReason } from '@/lib/db/schema';

export interface FaceQueueState {
  groups: FaceGroup[];
  pendingTotal: number;
  /** Faces resolved inside the Recently-resolved window — the review
   *  progress denominator is `pendingTotal + resolvedTotal`. */
  resolvedTotal: number;
  loading: boolean;
  error: string | null;
}

export function useFaceQueue(treeId: number | null, resolved: boolean) {
  const [state, setState] = useState<FaceQueueState>({
    groups: [], pendingTotal: 0, resolvedTotal: 0, loading: true, error: null,
  });

  const reload = useCallback(async () => {
    setState(s => ({ ...s, loading: true, error: null }));
    try {
      const client = await getDataClient();
      const { groups, pendingTotal, resolvedTotal } = await client.media.listFaceQueue({ resolved }, treeId);
      setState({ groups, pendingTotal, resolvedTotal, loading: false, error: null });
    } catch {
      setState(s => ({ ...s, loading: false, error: 'load_failed' }));
    }
  }, [treeId, resolved]);

  // This hook's shape is specified verbatim by the Task 6 brief (#487).
  useEffect(() => { void reload(); }, [reload]);

  const confirm = useCallback(async (candidateIds: number[], personId: number) => {
    try {
      const client = await getDataClient();
      return await client.media.confirmFaces(candidateIds, personId, treeId);
    } finally {
      await reload();
    }
  }, [treeId, reload]);

  const dismiss = useCallback(async (candidateIds: number[], reason: FaceDismissReason) => {
    const client = await getDataClient();
    const result = await client.media.dismissFaces(candidateIds, reason, treeId);
    await reload();
    return result;
  }, [treeId, reload]);

  const undo = useCallback(async (candidateIds: number[]) => {
    const client = await getDataClient();
    const result = await client.media.undoFaces(candidateIds, treeId);
    await reload();
    return result;
  }, [treeId, reload]);

  return { ...state, reload, confirm, dismiss, undo };
}
