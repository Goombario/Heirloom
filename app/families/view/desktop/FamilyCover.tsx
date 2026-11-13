'use client';

import { useTranslations } from 'next-intl';
import type { Note } from '@/lib/data/types';
import type { FamilyType } from '@/lib/db/schema';
import { getInitials } from '@/lib/utils/initials';
import { avatarClass } from '@/lib/utils/avatar';
import GuardedLink from '@/app/components/GuardedLink';
import ProfileImage from '@/app/components/ProfileImage';
import { CoverBand, RecordMenu, cx, type RecordMenuItem } from '@/app/components/ui';
import { LeadNote } from '@/app/components/notes/LeadNote';
import { ArrowUpRight, Plus } from '@/lib/icons';
import { shortPlace } from '@/app/people/view/desktop/PersonCover';
import type { RunChange } from '@/app/people/view/mobile/useChange';
import { kindKey } from '../mobile/model';
import { partnerName, partnerShortName } from '../derive';
import type { PartnerPerson } from '../useFamilyDetail';
import type { Slot } from '../mobile/model';
import { PartnerFinder } from './FamilyFinders';
import type { FamilyWrites } from './familyWrites';

/**
 * The desktop family page's header (#119, locked board B "NoPhoto"): the cover band
 * with the family type as its eyebrow, the couple's names, the years and the marriage
 * place, the ⋯ menu beside the name, the split partner portrait hanging over the
 * band's edge (each half opens that partner) and "About this family" beside it.
 */
export function FamilyCover({ familyId, type, partner1, partner2, began, ended, place, about, treeId, role, run, writes, onEditFamily }: {
  familyId: number;
  type: FamilyType | null;
  partner1: PartnerPerson | null;
  partner2: PartnerPerson | null;
  began: string | null;
  ended: string | null;
  place: string | null;
  /** The family's lead note. */
  about: Note | null;
  treeId: number | null;
  role: 'viewer' | 'contributor' | 'editor';
  run: RunChange;
  writes: FamilyWrites;
  onEditFamily: () => void;
}) {
  const t = useTranslations('families');
  const tk = useTranslations('familyPhone');
  const tc = useTranslations('common');
  const canWrite = role !== 'viewer';

  // "Johan & Kristina Lindqvist" when they share a surname, else both full names.
  const a = partnerShortName(partner1);
  const b = partnerShortName(partner2);
  const shared = partner1?.LastName && partner1.LastName === partner2?.LastName ? partner1.LastName : null;
  const title = a && b
    ? (shared ? t('cover_title_shared', { a, b, last: shared }) : t('hero_title_both', { a: partnerName(partner1), b: partnerName(partner2) }))
    : partnerName(partner1) || partnerName(partner2) || t('family_fallback');

  const items: RecordMenuItem[] = [
    ...(canWrite ? [{ label: tk('edit_family'), onSelect: onEditFamily }] : []),
    ...(role === 'editor' ? [{ label: t('delete_family'), danger: true, separated: true, onSelect: () => void writes.deleteFamily() }] : []),
  ];

  const years = began ? <span className="date-mono">{ended && ended !== began ? `${began} – ${ended}` : began}</span> : null;
  const where = shortPlace(place);
  const meta = years || where ? (
    <span className="cover-lifeline">{years}{years && where && ' · '}{where}</span>
  ) : undefined;

  return (
    <CoverBand
      eyebrow={tk(`kind_${kindKey(type)}`)}
      title={title}
      titleSize="hero"
      meta={meta}
      titleAside={items.length > 0 ? <RecordMenu tone="island" recordName={title} items={items} /> : undefined}
      portrait={<SplitPortrait halves={[partnerHalf(partner1, tc('unknown')), partnerHalf(partner2, tc('unknown'))]} treeId={treeId}
        addPartner={canWrite ? (slot, trigger) => (
          <PartnerFinder key={slot} slot={slot} other={slot === 'partner1' ? partner2 : partner1} treeId={treeId} writes={writes} trigger={trigger}
            takenIds={[partner1?.Id, partner2?.Id].filter((id): id is number => id != null)} align={slot === 'partner2' ? 'end' : 'start'} className="split-portrait__slot" />
        ) : undefined} />}
      lead={(
        <LeadNote ownerTable="Families" ownerId={familyId} note={about} treeId={treeId} canEdit={canWrite} canDelete={role === 'editor'} run={run}
          labels={{
            heading: t('about_heading'),
            add: t('about_add'),
            hint: t('about_hint'),
            edit: t('about_edit'),
            remove: t('about_remove'),
            placeholder: t('about_placeholder'),
            saved: t('about_saved'),
            removed: t('about_removed'),
          }} />
      )}
      className="cover--family"
    />
  );
}

/** One half of the split portrait: a partner as the cover shows them. */
export interface PortraitHalf {
  id: number;
  /** The full name, for the link's label. */
  name: string;
  /** The first name, on the half's tag ("Johan ↗"). */
  first: string;
  initials: string;
  sex: string | null | undefined;
  mediaId: number | null | undefined;
  focalX?: number | null;
  focalY?: number | null;
  focalRadius?: number | null;
}

function partnerHalf(partner: PartnerPerson | null, unknown: string): PortraitHalf | null {
  if (!partner) return null;
  const name = partnerName(partner) || unknown;
  return {
    id: partner.Id, name, first: partnerShortName(partner) || name, initials: getInitials(partner.FirstName, partner.LastName),
    sex: partner.Sex, mediaId: partner.PrimaryMediaId, focalX: partner.FocalX, focalY: partner.FocalY, focalRadius: partner.FocalRadius,
  };
}

type FinderTrigger = Parameters<typeof PartnerFinder>[0]['trigger'];

/**
 * The split partner portrait (locked board B "NoPhoto"): one half per partner, each
 * opening that partner. An unknown partner's half is hatched; for a writer it opens
 * the Add partner finder (`addPartner`).
 */
export function SplitPortrait({ halves, treeId, addPartner }: {
  halves: [PortraitHalf | null, PortraitHalf | null];
  treeId: number | null;
  addPartner?: (slot: Slot, trigger: FinderTrigger) => React.ReactNode;
}) {
  const tk = useTranslations('familyPhone');
  return (
    <span className="split-portrait">
      {halves.map((h, i) => {
        if (!h) {
          return addPartner ? addPartner(i === 0 ? 'partner1' : 'partner2', (p) => (
            <button type="button" {...p} className="split-portrait__half split-portrait__half--unknown focus-ring">
              <span className="split-portrait__add"><span className="split-portrait__disc" aria-hidden="true"><Plus className="w-4 h-4" /></span>{tk('add_partner')}</span>
            </button>
          )) : (
            <span key={i} className="split-portrait__half split-portrait__half--unknown"><span className="split-portrait__add">{tk('partner_unknown')}</span></span>
          );
        }
        return (
          <GuardedLink key={i} href={`/people/view?id=${h.id}`} className="split-portrait__half focus-ring" aria-label={tk('open_person', { name: h.name })}>
            {h.mediaId ? (
              <ProfileImage mediaId={h.mediaId} treeId={treeId} alt="" focalX={h.focalX ?? 50} focalY={h.focalY ?? 50} focalRadius={h.focalRadius ?? null}
                containerWidth={160} containerHeight={240} thumbSize={512} circular={false} />
            ) : (
              <span className={cx('split-portrait__initials', avatarClass(h.sex))} aria-hidden="true">
                <span className="serif">{h.initials}</span>
              </span>
            )}
            <span className="split-portrait__tag" aria-hidden="true">{h.first}<ArrowUpRight className="w-3.5 h-3.5" /></span>
          </GuardedLink>
        );
      })}
    </span>
  );
}
