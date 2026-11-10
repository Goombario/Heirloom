'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { DATA_MODE } from '@/lib/data';
import { useMyTrees } from '@/app/hooks/useMyTrees';
import { useTreeDisplayName } from '@/app/hooks/useTreeDisplayName';
import { useDesktopMode } from '@/app/hooks/useDesktopMode';

/**
 * What "Erase all data" deletes, spelled out (#1230): every tree the person owns
 * by name, who loses access to them, and the audit log. Sharing exists only on
 * the hosted build, so the share lines show only there.
 */
export default function EraseAllSummary({ open }: { open: boolean }) {
    const t = useTranslations('options');
    const locale = useLocale();
    const { trees } = useMyTrees(open);
    const displayName = useTreeDisplayName();
    const isDesktop = useDesktopMode();
    const sharing = DATA_MODE !== 'local' && !isDesktop;
    const [sharedWith, setSharedWith] = useState<number | null>(null);

    useEffect(() => {
        if (!open || !sharing) return;
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch('/api/sharing');
                if (!res.ok) return;
                const data = await res.json() as { shares?: { SharedWithId: number }[]; pending?: { Email: string }[] };
                const people = new Set<string>([
                    ...(data.shares ?? []).map((s) => `user:${s.SharedWithId}`),
                    ...(data.pending ?? []).map((p) => `email:${p.Email.toLowerCase()}`),
                ]);
                if (!cancelled) setSharedWith(people.size);
            } catch {
                // Leave the count out; the line still says access goes.
            }
        })();
        return () => { cancelled = true; };
    }, [open, sharing]);

    const names = new Intl.ListFormat(locale, { type: 'conjunction' }).format(trees.map((tree) => displayName(tree.Name)));

    return (
        <div>
            <p className="m-0">{t('erase_summary_lead')}</p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
                <li>{trees.length > 0 ? t('erase_item_trees', { count: trees.length, names }) : t('erase_item_trees_unknown')}</li>
                <li>{t('erase_item_contents')}</li>
                {sharing && (
                    <li>{sharedWith == null ? t('erase_item_shares_unknown') : t('erase_item_shares', { count: sharedWith })}</li>
                )}
                <li>{t('erase_item_audit')}</li>
            </ul>
            <p className="m-0 mt-3">
                {sharing ? `${t('erase_kept_shared')} ` : ''}{t('erase_one_tree_hint')}
            </p>
        </div>
    );
}
