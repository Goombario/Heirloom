import type { MediaTagWithPerson } from '@/lib/db/schema';
import { displayFullName } from '@/lib/utils/names';

export type LightboxTag = MediaTagWithPerson;

export interface DrawRect { x: number; y: number; w: number; h: number }

export interface FaceRegionInput {
    RegionX: number; RegionY: number; RegionW: number; RegionH: number;
}

export function tagPersonName(t: LightboxTag, fallback: string): string {
    return displayFullName({
        FirstName: t.PersonFirstName,
        LastName: t.PersonLastName,
        EffectiveFirstName: t.PersonEffectiveFirstName,
        Nickname: t.PersonNickname,
    }) || fallback;
}

/**
 * The existing tag a freshly drawn box mostly covers: one whose overlap is more
 * than half the new box (#802, MD-1). Two people on one face region is the
 * mistake this warns about; a box that only grazes a neighbour is fine.
 */
export function overlappedTag(region: FaceRegionInput, tags: readonly LightboxTag[]): LightboxTag | undefined {
    const area = region.RegionW * region.RegionH;
    if (!(area > 0)) return undefined;
    return tags.find((tag) => {
        if (tag.RegionX == null || tag.RegionY == null || !(tag.RegionW > 0) || !(tag.RegionH > 0)) return false;
        const w = Math.min(region.RegionX + region.RegionW, tag.RegionX + tag.RegionW) - Math.max(region.RegionX, tag.RegionX);
        const h = Math.min(region.RegionY + region.RegionH, tag.RegionY + tag.RegionH) - Math.max(region.RegionY, tag.RegionY);
        return w > 0 && h > 0 && (w * h) / area > 0.5;
    });
}

const clampPercent = (v: number) => Math.max(0, Math.min(100, v));
export { clampPercent };
