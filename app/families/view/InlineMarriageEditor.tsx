'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { escapeToCancel, useFocusFirstField } from '@/app/hooks/useEditorFocusReturn';
import { useTranslations } from 'next-intl';
import DateInput from '@/app/components/DateInput';
import { hasUncommittedDate } from '@/app/components/date-input/DateInput';
import { factPlaceEntry, factPlaceKey } from '@/lib/places/place-key';
import LocationField from '@/app/components/LocationField';
import { getDataClient } from '@/lib/data';
import type { PinChainRow } from '@/lib/data/types';
import type { HierarchyLevel } from '@/lib/geocode/photon';
import { useErrorToast } from '@/app/components/useErrorToast';
import { EditorActions, FieldLabel, fieldClass } from '@/app/components/ui';
import { OwnerMediaCard } from '@/app/components/media/OwnerMediaCard';

interface InlineMarriageEditorProps {
    familyId: number;
    treeId: number | null;
    marriageDate: string | null;
    marriagePlace: string | null;
    /** The place the marriage points at (#1186). */
    marriagePlaceId?: number | null;
    /**
     * Already-translated name for this union's kind ("marriage", "common-law
     * partnership", …), supplied by the timeline so the caption reads correctly
     * for a non-marriage family. Passed in rather than derived here so the row
     * and the editor it opens can never disagree.
     */
    kindLabel: string;
    /** Whether the user may delete media in the lightbox (adding and removing links needs only edit). */
    canDelete: boolean;
    /** People whose tagged photos the media picker suggests first. */
    relevantPersonIds?: readonly number[];
    /** False leaves out the photos, which load through the data client (the a11y harness can't). */
    withMedia?: boolean;
    /** Refresh the family after a photo is added or removed, so the row shows it. */
    onMediaChanged?: () => void;
    onCancel: () => void;
    onSaved: () => void;
}

/**
 * Inline editor for the marriage "started" anchor (date + place), matching the
 * look of InlineEventEditor. Marriage is stored on Families columns (not an Events
 * row), so this writes via families.update rather than the events client.
 */
export default function InlineMarriageEditor({ familyId, treeId, marriageDate, marriagePlace, marriagePlaceId = null, kindLabel, canDelete, relevantPersonIds, withMedia = true, onMediaChanged, onCancel, onSaved }: InlineMarriageEditorProps) {
    const t = useTranslations('editFamily');
    const te = useTranslations('eventEdit');
    const tc = useTranslations('common');
    const fieldId = useId();
    const [date, setDate] = useState(marriageDate ?? '');
    const [place, setPlace] = useState(marriagePlace ?? '');
    const [placeResolution, setPlaceResolution] = useState<HierarchyLevel[] | null | undefined>(undefined);
    const [placeChains, setPlaceChains] = useState<Record<string, PinChainRow[]>>({});
    // The place the marriage links to (#1186): the saved one, then the one picked.
    const [placeId, setPlaceId] = useState<number | null>(marriagePlaceId);
    const [saving, setSaving] = useState(false);
    // First field on open, Escape cancels (#798, KB-2).
    const panelRef = useRef<HTMLDivElement>(null);
    useFocusFirstField(panelRef);
    const { reportError } = useErrorToast();

    // Read-only lookup for the already-saved pin chain (edit-mode pin display) —
    // only runs when there's a place already saved on the family.
    useEffect(() => {
        // By the place the marriage points at: two places may share a name (#1186).
        const key = factPlaceKey(marriagePlace, marriagePlaceId);
        if (key == null) return;
        let cancelled = false;
        (async () => {
            try {
                const client = await getDataClient();
                const chains = await client.places.pinChains([key], treeId);
                if (!cancelled) setPlaceChains(chains);
            } catch {
                // Best-effort — a failed lookup just means no badge shows this session.
            }
        })();
        return () => { cancelled = true; };
    }, [marriagePlace, marriagePlaceId, treeId]);

    const handleSave = async () => {
        setSaving(true);
        try {
            const client = await getDataClient();
            const saved = await client.families.update(familyId, { MarriageDate: date || null, MarriagePlace: place || null, MarriagePlaceId: place ? placeId : null }, treeId);
            if (placeResolution !== undefined && place.trim()) {
                try {
                    // To the place the saved marriage points at (#1186).
                    const leaf = saved.MarriagePlaceId;
                    if (placeResolution === null) {
                        await client.places.geocodeUpsert({ name: place, placeId: leaf, latitude: null, longitude: null, pinSuppressed: true }, treeId);
                    } else if (placeResolution.length > 0) {
                        if (leaf != null) await client.places.geocodeUpsertHierarchy(placeResolution, treeId, { leafId: leaf });
                        else await client.places.geocodeUpsertHierarchy(placeResolution, treeId);
                    }
                } catch {
                    // Non-fatal — coordinates are a cache, not user content.
                }
            }
            onSaved();
        } catch (e) {
            reportError(e);
        } finally {
            setSaving(false);
        }
    };

    // Escape asks before discarding edits, including a date typed but not yet blurred (#861).
    const onKeyDown = escapeToCancel((panel) => {
        if (saving) return;
        const dirty = date !== (marriageDate ?? '') || place !== (marriagePlace ?? '') || placeId !== marriagePlaceId || hasUncommittedDate(panel);
        if (!dirty || window.confirm(tc('unsaved_changes_confirm'))) onCancel();
    });

    // The collections pattern's inline panel (#760), the same one InlineEventEditor uses.
    return (
        <div ref={panelRef} className="inline-panel my-2 flex flex-col gap-3" role="group" aria-label={t('editing_start', { kind: kindLabel })} onKeyDown={onKeyDown}>
            <div className="grid grid-cols-1 gap-3">
                <FieldLabel label={t('date_label')} fullLabel={t('started_date')} htmlFor={`${fieldId}-date`}>
                    <DateInput id={`${fieldId}-date`} value={date} onChange={setDate} className={fieldClass()} />
                </FieldLabel>
                <FieldLabel label={t('place_label')} fullLabel={t('started_place')} htmlFor={`${fieldId}-place`}>
                    <LocationField
                        id={`${fieldId}-place`}
                        value={place}
                        onChange={setPlace}
                        onResolve={setPlaceResolution}
                        onRemove={() => setPlaceResolution(null)}
                        initialChain={factPlaceEntry(placeChains, place, placeId) ?? null}
                        placeId={placeId}
                        onPlaceIdChange={setPlaceId}
                        treeId={treeId}
                        className={fieldClass()}
                        placeholder={t('place_placeholder')}
                    />
                </FieldLabel>
            </div>
            {/* The marriage's own photos (ADR 0030). They save as they are added, like
                an event's, so Save and Cancel don't apply to them. */}
            {withMedia && (
                <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-2)' }}>{te('field_media')}</label>
                    <OwnerMediaCard ownerTable="Families" ownerId={familyId} ownerFact="Marriage" treeId={treeId} canEdit canDelete={canDelete} relevantPersonIds={relevantPersonIds} onChanged={onMediaChanged} />
                </div>
            )}
            <EditorActions size="sm" onSave={handleSave} onCancel={onCancel} saving={saving} />
        </div>
    );
}
