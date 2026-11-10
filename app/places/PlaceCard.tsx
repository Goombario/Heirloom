'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Card } from '@/app/components/ui/Card';
import { Badge } from '@/app/components/ui/Badge';
import PersonAvatar from '@/app/components/PersonAvatar';
import { useTree } from '@/app/contexts/TreeContext';
import { getInitials } from '@/lib/utils/initials';
import { displayFullName, displayFirstName } from '@/lib/utils/names';
import { usePrefetchPlaceDetail } from '@/lib/places/prefetch';
import type { PlaceFace } from '@/lib/data/types';
import { placeHref } from '@/lib/places/place-key';

export interface PlaceCardProps {
  /** The place's id (#1186); the link opens it by name when absent. */
  id?: number | null;
  /** Full place string, e.g. "Brooklyn, Kings County, New York". */
  name: string;
  /** Number of records that reference this place (raw fact occurrences). */
  count: number;
  /** Distinct people linked to this place. */
  peopleCount: number;
  /** Up to 4 sampled people for the face-stack. */
  faces: PlaceFace[];
}

const FACE_SIZE = 26;

/** Everything before the first comma is the place name; the rest is the region. */
function splitPlace(name: string): { label: string; region: string } {
  const i = name.indexOf(',');
  if (i === -1) return { label: name.trim(), region: '' };
  return { label: name.slice(0, i).trim(), region: name.slice(i + 1).trim() };
}

function FaceStack({ faces, peopleCount, noPeopleLabel }: { faces: PlaceFace[]; peopleCount: number; noPeopleLabel: string }) {
  // Photos are looked up in the active tree, not the default one (#929).
  const { activeTreeId } = useTree();
  if (faces.length === 0) {
    return <div className="mt-3 text-xs italic text-text-muted">{noPeopleLabel}</div>;
  }
  const extra = peopleCount - faces.length;
  return (
    <div className="mt-3 flex items-center">
      {faces.map((f, i) => {
        const nameParts = { FirstName: f.firstName, LastName: f.lastName, EffectiveFirstName: f.effectiveFirstName, Nickname: f.nickname };
        const fullName = displayFullName(nameParts);
        return (
          <div key={f.id} className="shrink-0" style={{ marginLeft: i === 0 ? 0 : -8 }}>
            <PersonAvatar
              mediaId={f.primaryMediaId}
              treeId={activeTreeId}
              name={fullName || getInitials(displayFirstName(nameParts), f.lastName)}
              initials={getInitials(displayFirstName(nameParts), f.lastName)}
              sex={f.sex}
              size={FACE_SIZE}
              focalX={f.focalX}
              focalY={f.focalY}
              focalRadius={f.focalRadius}
              ringClassName="border-2 border-card"
              textClassName="text-[color:var(--color-on-media)]"
            />
          </div>
        );
      })}
      {extra > 0 && <span className="ml-1.5 text-xs font-medium text-text-muted">+{extra}</span>}
    </div>
  );
}

export function PlaceCard({ id, name, count, peopleCount, faces }: PlaceCardProps) {
  const t = useTranslations('places');
  const { label, region } = splitPlace(name);
  const prefetch = usePrefetchPlaceDetail();
  return (
    <Link
      href={placeHref({ id, name })}
      onMouseEnter={() => prefetch(id ?? name)}
      onFocus={() => prefetch(id ?? name)}
      className="block h-full rounded-card focus-ring"
    >
      <Card interactive className="h-full flex flex-col justify-between min-h-[44px]">
        <div>
          <div className="flex items-start justify-between gap-3">
            <span className="serif text-xl font-semibold text-text">{label}</span>
            <Badge tone="neutral" className="shrink-0 tabular-nums">{count}</Badge>
          </div>
          <div className="mt-1.5 text-sm text-text-muted min-h-[15px]">{region}</div>
        </div>
        <FaceStack faces={faces} peopleCount={peopleCount} noPeopleLabel={t('no_people_recorded')} />
      </Card>
    </Link>
  );
}
