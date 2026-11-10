'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/app/components/ui';
import { FamilySearch } from '@/app/components/FamilySearch';
import { escapeToCancel } from '@/app/hooks/useEditorFocusReturn';

/**
 * The "Move to another family…" panel on a child row (#796, ED-8). Search a
 * family by a partner's name; each result names both partners with their years,
 * so two same-named couples can be told apart. Picking one moves the child in a
 * single audited step (the parent owns the move and its Undo).
 */
export function MoveChildPanel({ childName, familyId, treeId, busy, onPick, onCancel }: {
    childName: string;
    familyId: number;
    treeId: number | null;
    busy: boolean;
    onPick: (family: { id: number; label: string }) => void;
    onCancel: () => void;
}) {
    const t = useTranslations('families');
    const tc = useTranslations('common');

    return (
        <div className="inline-panel mx-3 mb-3 flex flex-col gap-2" role="group" aria-label={t('move_child_named', { name: childName })} onKeyDown={escapeToCancel(() => onCancel())}>
            <FamilySearch
                treeId={treeId}
                excludeFamilyId={familyId}
                disabled={busy}
                autoFocus
                autofillKey="move-child-family-search"
                onPick={(f) => onPick({ id: f.Id, label: [f.husbandName, f.wifeName].filter(Boolean).join(' & ') || tc('unknown') })}
            />
            <div className="row gap-2">
                <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>{tc('cancel')}</Button>
            </div>
        </div>
    );
}
