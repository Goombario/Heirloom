'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { getDataClient } from '@/lib/data';
import type { MediaOwnerFact, MediaOwnerTable } from '@/lib/db/fact-tables';
import type { OwnerGalleryMedia } from '@/lib/db/schema';
import { MediaGallery } from '@/app/components/media/MediaGallery';
import AddMediaModal from '@/app/components/media/AddMediaModal';
import { MobileRow } from '@/app/components/ui';
import { useErrorToast } from '@/app/components/useErrorToast';
import { ImageUp } from '@/lib/icons';

/**
 * A record's media on a phone page that isn't a person (a source, a case): the photo
 * grid opening the viewer, then one Add media row for editors (#1204).
 * The parent draws the section heading; `onCount` tells it how many there are.
 * With `ownerFact` it is a birth, death or marriage panel's media (ADR 0030).
 */
export function MobileOwnerMedia({ ownerTable, ownerId, ownerFact, treeId, canEdit, canDelete, onCount }: {
    ownerTable: MediaOwnerTable;
    ownerId: number;
    /** The owner's vital fact this list is for. Set from the panel, never chosen. */
    ownerFact?: MediaOwnerFact;
    treeId: number | null;
    canEdit: boolean;
    canDelete: boolean;
    onCount?: (count: number) => void;
}) {
    const t = useTranslations('ownerMedia');
    const { reportError } = useErrorToast();
    const [media, setMedia] = useState<OwnerGalleryMedia[]>([]);
    const [adding, setAdding] = useState(false);

    const load = useCallback(async () => {
        try {
            const client = await getDataClient();
            const loaded = await client.media.listGalleryForOwner(ownerTable, ownerId, treeId, ownerFact);
            setMedia(loaded);
            onCount?.(loaded.length);
        } catch (e) {
            reportError(e);
        }
    }, [ownerTable, ownerId, ownerFact, treeId, onCount, reportError]);
    // The list arrives after an await; the rule can't see past the call.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { void load(); }, [load]);

    const unlink = async (id: number) => {
        try {
            const client = await getDataClient();
            await client.media.unlinkFromOwner(id, ownerTable, ownerId, treeId, ownerFact);
            await load();
        } catch (e) {
            reportError(e);
        }
    };

    return (
        <>
            {media.length > 0 && (
                <div className="px-1 pb-1">
                    <MediaGallery
                        items={media}
                        treeId={treeId}
                        lightbox={{
                            context: 'library',
                            canEdit,
                            canDelete,
                            canRemoveFromContext: canEdit,
                            onRemoveFromContext: canEdit ? unlink : undefined,
                            canRemoveItem: (item) => item.IsExplicit && canEdit,
                            showDeleteAction: (item) => item.IsExplicit && canEdit,
                            removeActionLabel: t('remove'),
                            onDeleted: () => { void load(); },
                        }}
                        getAlt={(item) => item.Title ?? t('photo_alt')}
                    />
                </div>
            )}
            {canEdit && (
                <MobileRow icon={<ImageUp />} end="chevron" divided={media.length > 0} label={t('add_button')} onClick={() => setAdding(true)} />
            )}
            {adding && (
                <AddMediaModal target={{ kind: 'owner', ownerTable, ownerId, ownerFact }} treeId={treeId}
                    onClose={() => setAdding(false)} onMediaChanged={() => { void load(); }} onAdded={() => setAdding(false)} />
            )}
        </>
    );
}
