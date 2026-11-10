'use client';

import { useCallback } from 'react';
import { getDataClient } from '@/lib/data';
import { isRecordGone } from '@/lib/utils/data-error';
import { useErrorToast } from '@/app/components/useErrorToast';
import { showChangeToast } from '@/app/components/ui';

interface ChangeToast {
    message: string;
    /** What it was, e.g. "1871 · Göteborg". */
    detail?: string;
}

/**
 * Runs one phone-page write and reports it the mobile way (#1047, #1048): reload the
 * record, then the Undo toast. Undo reverts exactly the audit entries the write
 * returned (#1044). Contributors can't revert, so they get the plain confirmation.
 * Resolves to whether the write went through; a failure is reported here.
 */
export function useChange({ treeId, canUndo, onChanged }: {
    treeId: number | null;
    canUndo: boolean;
    onChanged: () => Promise<void> | void;
}) {
    const { reportError } = useErrorToast();

    const fail = useCallback((e: unknown) => {
        // The person was deleted under the page (a GEDCOM overwrite import): reload
        // so the not-found state shows instead of a toast.
        if (isRecordGone(e)) { window.location.reload(); return; }
        reportError(e);
    }, [reportError]);

    return useCallback(async (write: () => Promise<{ auditIds: number[] }>, toast: ChangeToast): Promise<boolean> => {
        let auditIds: number[];
        try {
            ({ auditIds } = await write());
        } catch (e) {
            fail(e);
            return false;
        }
        try { await onChanged(); } catch { /* the page shows its own load error */ }
        const undo = canUndo && auditIds.length > 0
            ? async () => {
                try {
                    const client = await getDataClient();
                    await client.audit.revert(auditIds, treeId);
                    await onChanged();
                } catch (e) {
                    fail(e);
                }
            }
            : undefined;
        showChangeToast({ ...toast, onUndo: undo });
        return true;
    }, [canUndo, fail, onChanged, treeId]);
}

export type RunChange = ReturnType<typeof useChange>;
