'use client';

import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { compareSortableYears, formatYearOrEmpty, sortableYear } from '@/lib/date-utils';
import { livingStatus } from '@/lib/living';
import { getInitials } from '@/lib/utils/initials';
import { factPlaceEntry } from '@/lib/places/place-key';
import { DetailRail, FamilyRecordRow, Lifespan, OpenInTreeRow, PersonRow, SectionHeader } from '@/app/components/ui';
import { kindKey } from '../mobile/model';
import { partnerName, partnerShortName } from '../derive';
import { ChildrenList } from '../sections';
import type { PartnerFamilies, PartnerPerson } from '../useFamilyDetail';

const LocationMap = dynamic(() => import('@/app/components/LocationMap'), { ssr: false });

export interface RailPlace { place: string | null | undefined; placeId?: number | null }

/**
 * The desktop family page's rail (#119, locked board B): Open in tree centred on the
 * first partner, PARTNERS (each with their age at the marriage and their other
 * partnerships nested under them, "with Nils Holm"), CHILDREN, then WHERE THEY LIVED.
 * No bars between sections, only spacing.
 */
export function FamilyRail({ family, partner1, partner2, partner1Families, partner2Families, childList, places, placeCoords, treeId, canEdit, canDelete, onChanged }: {
  family: { Id: number; MarriageDate: string | null };
  partner1: PartnerPerson | null;
  partner2: PartnerPerson | null;
  partner1Families: PartnerFamilies | null;
  partner2Families: PartnerFamilies | null;
  childList: PartnerPerson[];
  /** The marriage, family event and child birth places, for Where they lived. */
  places: RailPlace[];
  placeCoords: Record<string, { lat: number; lng: number }>;
  treeId: number | null;
  canEdit: boolean;
  canDelete: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations('families');
  const tc = useTranslations('common');
  const tk = useTranslations('familyPhone');
  const first = partner1 ?? partner2;
  const startYear = sortableYear(family.MarriageDate);

  // Where they lived: each named place once, pinned where it has coordinates.
  const seen = new Set<string>();
  const markers = places.flatMap(({ place, placeId }) => {
    if (!place || seen.has(place)) return [];
    seen.add(place);
    const at = factPlaceEntry(placeCoords, place, placeId);
    return at ? [{ lat: at.lat, lng: at.lng, label: place }] : [];
  });

  return (
    <DetailRail look="open" className="rail-family">
      {first && <OpenInTreeRow personId={first.Id} firstName={partnerShortName(first) || partnerName(first) || tc('unknown')} />}

      <section aria-labelledby="rail-partners">
        <SectionHeader level="label" as="h3" headingId="rail-partners" title={t('rail_partners')} />
        <div className="rail-block">
          {[{ partner: partner1, families: partner1Families }, { partner: partner2, families: partner2Families }].map(({ partner, families }, i) => {
            if (!partner) return <p key={i} className="m-0 px-1 text-sm text-text-muted">{t('rail_partner_unknown')}</p>;
            const born = sortableYear(partner.BirthDate);
            const age = startYear != null && born != null && startYear > born ? startYear - born : null;
            const others = (families?.spouses ?? [])
              .filter((s) => s.family.Id !== family.Id)
              .sort((a, b) => compareSortableYears(a.family.MarriageDate, b.family.MarriageDate));
            return (
              <div key={partner.Id}>
                <PersonRow
                  href={`/people/view?id=${partner.Id}`}
                  name={partnerName(partner) || tc('unknown')}
                  initials={getInitials(partner.FirstName, partner.LastName)}
                  sex={partner.Sex}
                  mediaId={partner.PrimaryMediaId ?? null}
                  focalX={partner.FocalX}
                  focalY={partner.FocalY}
                  focalRadius={partner.FocalRadius}
                  treeId={treeId}
                  nameStyle="serif"
                  lifespan={partner.BirthDate || partner.DeathDate ? <Lifespan birth={partner.BirthDate} death={partner.DeathDate} status={livingStatus(partner)} /> : null}
                  role={age != null ? t('age_at_marriage', { age }) : null}
                />
                {others.length > 0 && (
                  <div className="rail-kids">
                    <span className="rail-kids__label">{t('detail_other_partnerships')}</span>
                    {others.map((s) => (
                      <FamilyRecordRow
                        key={s.family.Id}
                        density="desktop"
                        arrow={false}
                        href={`/families/view?id=${s.family.Id}`}
                        title={t('with_partner', { name: partnerName(s.person) || tc('unknown') })}
                        sub={[
                          tk(`kind_${kindKey(s.family.Type)}`),
                          formatYearOrEmpty(s.family.MarriageDate),
                          s.children.length > 0 ? t('children_n', { count: s.children.length }) : t('no_children_short'),
                        ].filter(Boolean).join(' · ')}
                        stack={[partner, s.person].filter((x): x is NonNullable<typeof x> => x != null)}
                        treeId={treeId}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="rail-children">
        <SectionHeader level="label" as="h3" headingId="rail-children" title={t('detail_children')} count={childList.length} />
        <ChildrenList
          variant="rail"
          childList={childList}
          partner1={partner1}
          partner2={partner2}
          treeId={treeId}
          familyId={family.Id}
          canEdit={canEdit}
          canDelete={canDelete}
          onChanged={onChanged}
        />
      </section>

      {seen.size > 0 && (
        <section aria-labelledby="rail-lived">
          <SectionHeader level="label" as="h3" headingId="rail-lived" title={t('where_they_lived')} />
          {markers.length > 0 && <LocationMap markers={markers} variant="mini" height={130} className="rounded-card overflow-hidden" />}
          <p className="m-0 mt-2 text-sm text-text-secondary">{t('places_n', { count: seen.size })}</p>
        </section>
      )}
    </DetailRail>
  );
}
