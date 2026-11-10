'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { getDataClient } from '@/lib/data';
import type { AuditedChange } from '@/lib/data/types';
import { showErrorToast, showSuccessToast } from '@/app/components/ui/Toast';

/**
 * Confirm a relationship removal with a toast that offers Undo (#788). Undo
 * reverts the removal's own audit entry, the same revert the audit log runs,
 * then `onUndone` reloads the view. With no audit entry there is nothing to
 * revert, so the toast has no action.
 */
export function useUndoRemoval(treeId: number | null | undefined) {
    const t = useTranslations('common');
    return useCallback((change: AuditedChange, message: string, onUndone: () => void) => {
        const { auditId } = change;
        if (auditId == null) {
            showSuccessToast(message);
            return;
        }
        showSuccessToast(message, {
            label: t('undo'),
            onClick: () => {
                void (async () => {
                    try {
                        const client = await getDataClient();
                        await client.audit.revert([auditId], treeId);
                        onUndone();
                        showSuccessToast(t('undo_done'));
                    } catch {
                        showErrorToast(t('undo_failed'));
                    }
                })();
            },
        });
    }, [t, treeId]);
}
