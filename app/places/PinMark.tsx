'use client';

import { useTranslations } from 'next-intl';
import PersonAvatar from '@/app/components/PersonAvatar';
import { useTree } from '@/app/contexts/TreeContext';
import { getInitials } from '@/lib/utils/initials';
import { MapPin, Circle } from '@/lib/icons';
import type { PinState } from '@/lib/places/hierarchy';
import type { PlaceFace } from '@/lib/data/types';

const FACE_SIZE = 22;

/** The canonical order the three states are taught in — leant on by the legend so
 *  the key always reads most-specific → least (#266). */
export const PIN_STATES: PinState[] = ['own', 'inherited', 'none'];

/** The one translation key per state, so the legend, the tooltips and any future
 *  surface all name a state the same way. */
export const PIN_STATE_LABEL_KEY: Record<PinState, string> = {
  own: 'own_pin',
  inherited: 'inherited_pin',
  none: 'no_pin',
};

/** Colorblind-safe geocode-state mark (shape + colour): map pin = own coordinates,
 *  dashed diamond = inherited from a parent, hollow ring = no pin. A pin/ring pair
 *  reads as "on the map / not on the map"; the filled-dot/hollow-dot pair it
 *  replaced differed only by fill and read as a bullet. This is a geocode-state
 *  indicator only — NOT a "drillable" signifier (that's the `N ›` pill).
 *
 *  #266: this is the ONE symbol set for geocode state. Every Places surface that
 *  shows the state — cards, list, tree, explore drill, the detail headers and
 *  LocationField's pin badge — draws it from here or from the same three shapes,
 *  and no shape is reused for a second meaning. `PinLegend` is the in-app key.
 *
 *  Deliberately `aria-hidden`: the mark is decorative reinforcement. The rows it
 *  sits in are already named by their place name, and the state itself is stated
 *  in words on the detail surfaces ("Not geocoded", "Lat / Lng"). Announcing it on
 *  every row would bury the name it qualifies. The `title` carries it on hover. */
export function PinMark({ state }: { state: PinState }) {
  const t = useTranslations('places');
  const title = t(PIN_STATE_LABEL_KEY[state]);
  if (state === 'own') {
    return (
      <span className="inline-flex shrink-0" title={title}>
        <MapPin size={12} className="text-[color:var(--color-link)]" aria-hidden="true" />
      </span>
    );
  }
  if (state === 'inherited') {
    return <span className="inline-block w-2 h-2 rotate-45 border border-dashed border-[color:var(--color-link)] shrink-0" title={title} />;
  }
  return (
    <span className="inline-flex shrink-0" title={title}>
      <Circle size={11} className="text-text-muted opacity-50" aria-hidden="true" />
    </span>
  );
}

/** Overlapping avatar stack (photo thumbnail or initials fallback). */
export function FaceStack({ faces }: { faces: PlaceFace[] }) {
  // Photos are looked up in the active tree, not the default one (#929).
  const { activeTreeId } = useTree();
  if (faces.length === 0) return null;
  return (
    <span className="inline-flex items-center">
      {faces.map((f, i) => (
        <span key={f.id} className="inline-flex shrink-0" style={{ marginLeft: i === 0 ? 0 : -7 }}>
          <PersonAvatar
            as="span"
            mediaId={f.primaryMediaId}
            treeId={activeTreeId}
            name={getInitials(f.firstName, f.lastName)}
            initials={getInitials(f.firstName, f.lastName)}
            sex={f.sex}
            size={FACE_SIZE}
            focalX={f.focalX}
            focalY={f.focalY}
            focalRadius={f.focalRadius}
            ringClassName="border-2 border-card"
            textClassName="text-[color:var(--color-on-media)]"
          />
        </span>
      ))}
    </span>
  );
}
