'use client';

import { useTranslations } from 'next-intl';
import type { PlaceDetail } from '@/lib/data/types';
import { osmKindLabel } from '@/lib/places/osm-kind';

/**
 * What kind of place this is (#45): the FORM's own word when the import kept one,
 * else the geocoder match's kind (ADR 0050), else null and nothing is shown.
 */
export function usePlaceKind(detail: Pick<PlaceDetail, 'kind' | 'osmKind'>): string | null {
    const t = useTranslations('placeKinds');
    if (detail.kind) return detail.kind;
    const label = osmKindLabel(detail.osmKind);
    return label ? t(label) : null;
}
