'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { PlaceUses } from '@/lib/db/queries/places';

/*
 * Deleting a place (#1229) is only for a place nothing uses, so a delete never
 * unlinks a record. A place in use says what still uses it instead, and points at
 * Move records for its records.
 */

export function placeUnused(uses: PlaceUses): boolean {
    return uses.records + uses.places + uses.notes + uses.media === 0;
}

export function PlaceInUseHint({ place, uses, className }: { place: string; uses: PlaceUses; className?: string }) {
    const t = useTranslations('places');
    const locale = useLocale();
    const parts = [
        uses.records > 0 && t('delete_place_uses_records', { count: uses.records }),
        uses.places > 0 && t('delete_place_uses_places', { count: uses.places }),
        uses.notes > 0 && t('delete_place_uses_notes', { count: uses.notes }),
        uses.media > 0 && t('delete_place_uses_media', { count: uses.media }),
    ].filter((p): p is string => typeof p === 'string');
    const list = new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(parts);
    return (
        <p className={`text-meta text-text-muted ${className ?? ''}`}>
            {t('delete_place_in_use', { place, uses: list })}
            {uses.records > 0 && ` ${t('delete_place_move_first')}`}
        </p>
    );
}
