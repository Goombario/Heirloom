'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { getDataClient } from '@/lib/data';
import type { AuditedChange } from '@/lib/data/types';
import { showErrorToast, showSuccessToast } from '@/app/components/ui/Toast';

/**
 * The one Undo for a removal or unlink (#788, #55): a toast that offers Undo.
 * Undo reverts the change's own audit entries, the same revert the audit log
 * runs, then `onUndone` reloads the view. Pass several changes when one action
 * made several (a desktop unlink of two links, a multi-add): one Undo reverts
 * them all. With no audit entry there is nothing to revert, so the toast has
 * no action. Desktop pages use this rather than a confirm dialog for unlinks.
 */
export function useUndoRemoval(treeId: number | null | undefined) {
    const t = useTranslations('common');
    return useCallback((change: AuditedChange | AuditedChange[], message: string, onUndone: () => void) => {
        const auditIds = (Array.isArray(change) ? change : [change])
            .map((c) => c.auditId)
            .filter((id): id is number => id != null);
        if (auditIds.length === 0) {
            showSuccessToast(message);
            return;
        }
        showSuccessToast(message, {
            label: t('undo'),
            onClick: () => {
                void (async () => {
                    try {
                        const client = await getDataClient();
                        await client.audit.revert(auditIds, treeId);
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
