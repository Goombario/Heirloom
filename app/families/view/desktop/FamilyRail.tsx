'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { compareSortableYears, formatDateForDisplay, formatYearOrEmpty, sortableYear } from '@/lib/date-utils';
import { useLanguage } from '@/app/components/LanguageProvider';
import { useDateQualifierWords } from '@/app/components/date-input/aliases';
import type { JourneyStop } from '@/app/components/LocationJourneyModal';
import JourneySketch from './JourneySketch';
import { livingStatus } from '@/lib/living';
import { getInitials } from '@/lib/utils/initials';
import { factPlaceEntry } from '@/lib/places/place-key';
import { DetailRail, FamilyRecordRow, Lifespan, OpenInTreeRow, PersonRow, SectionHeader } from '@/app/components/ui';
import { kindKey } from '../mobile/model';
import { partnerName, partnerShortName } from '../derive';
import { ChildrenList } from '../sections';
import { AddChildFinder, PartnerFinder } from './FamilyFinders';
import type { FamilyWrites } from './familyWrites';
import { ArrowUpRight, Plus } from '@/lib/icons';
import type { PartnerFamilies, PartnerPerson } from '../useFamilyDetail';

const LocationJourneyModal = dynamic(() => import('@/app/components/LocationJourneyModal'), { ssr: false });

/** A place the family's records name, with what happened there for the map's stops. */
export interface RailPlace { place: string | null | undefined; placeId?: number | null; title: string; date: string | null | undefined }

/**
 * The desktop family page's rail (#119, locked board B): Open in tree centred on the
 * first partner, PARTNERS (each with their age at the marriage and their other
 * partnerships nested under them, "with Nils Holm"), CHILDREN, then WHERE THEY LIVED.
 * No bars between sections, only spacing.
 */
export function FamilyRail({ family, partner1, partner2, partner1Families, partner2Families, childList, places, placeCoords, treeId, canEdit, canDelete, onChanged, writes }: {
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
  /** Add and remove partners, add children (#119, G4/G5). */
  writes: FamilyWrites;
}) {
  const t = useTranslations('families');
  const tc = useTranslations('common');
  const tk = useTranslations('familyPhone');
  const first = partner1 ?? partner2;
  // Nobody already in the family can be picked again.
  const taken = [partner1?.Id, partner2?.Id, ...childList.map((c) => c.Id)].filter((id): id is number => id != null);
  const startYear = sortableYear(family.MarriageDate);

  const { language } = useLanguage();
  const dateWords = useDateQualifierWords();
  const [showMap, setShowMap] = useState(false);

  // Where they lived: each named place once.
  const seen = new Set<string>();
  for (const { place } of places) if (place) seen.add(place);
  // The full map's stops: every geocoded record, oldest first, as the person page's journey.
  const dated = places
    .flatMap(({ place, placeId, title, date }) => {
      const at = place ? factPlaceEntry(placeCoords, place, placeId) : null;
      return place && at ? [{ date, stop: { lat: at.lat, lng: at.lng, label: place, title, date: date ? formatDateForDisplay(date, language, dateWords) : null } }] : [];
    })
    .sort((x, y) => compareSortableYears(x.date, y.date));
  const stops: JourneyStop[] = dated.map((s) => s.stop);
  // The rail's sketch labels each stop with its year.
  const sketch = dated.map(({ date, stop }) => ({ lat: stop.lat, lng: stop.lng, label: stop.label, year: date?.match(/\d{4}/)?.[0] ?? null }));

  return (
    <DetailRail look="open" className="rail-family">
      {first && <OpenInTreeRow personId={first.Id} firstName={partnerShortName(first) || partnerName(first) || tc('unknown')} />}

      <section aria-labelledby="rail-partners">
        <SectionHeader level="label" as="h3" headingId="rail-partners" title={t('rail_partners')} />
        <div className="rail-block">
          {[{ partner: partner1, families: partner1Families }, { partner: partner2, families: partner2Families }].map(({ partner, families }, i) => {
            const slot = i === 0 ? 'partner1' as const : 'partner2' as const;
            if (!partner) {
              const other = i === 0 ? partner2 : partner1;
              const body = (
                <>
                  <span aria-hidden="true" className="empty-slot__disc grid place-items-center w-9 h-9 shrink-0 rounded-full border border-dashed"><Plus className="w-4 h-4" /></span>
                  <span className="grid min-w-0">
                    <span className="serif text-md text-text">{t('rail_partner_unknown')}</span>
                    {canEdit && <span className="text-meta text-link">{t('find_or_add')}</span>}
                  </span>
                </>
              );
              return canEdit ? (
                <PartnerFinder key={slot} slot={slot} other={other} takenIds={taken} treeId={treeId} writes={writes} align="end"
                  trigger={(p) => <button type="button" {...p} className="rail-unknown focus-ring">{body}</button>} />
              ) : <div key={slot} className="rail-unknown">{body}</div>;
            }
            // The last person in a family with no children: removing them deletes the family instead.
            const last = !(i === 0 ? partner2 : partner1) && childList.length === 0;
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
                  unlink={canDelete ? {
                    label: last ? t('delete_family') : tc('remove_named', { name: partnerName(partner) || tc('unknown') }),
                    onClick: () => void (last ? writes.deleteFamily() : writes.removePartner(slot)),
                  } : undefined}
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
          addSlot={<AddChildFinder partner1={partner1} partner2={partner2} takenIds={taken} treeId={treeId} writes={writes} />}
        />
      </section>

      {seen.size > 0 && (
        <section aria-labelledby="rail-lived">
          <SectionHeader level="label" as="h3" headingId="rail-lived" title={t('where_they_lived')} />
          {stops.length > 0 ? (
            // The whole block opens the full map of the family's places (board B).
            <button type="button" onClick={() => setShowMap(true)} aria-label={t('open_places_map')}
              className="family-places-link block w-full p-0 text-left bg-transparent border-0 cursor-pointer rounded-card focus-ring">
              <JourneySketch stops={sketch} />
              <span className="flex items-center gap-2 mt-2">
                <span className="flex-1 text-sm text-text-secondary">{t('places_n', { count: seen.size })}</span>
                <ArrowUpRight className="w-3.5 h-3.5 text-link" aria-hidden="true" />
              </span>
            </button>
          ) : (
            <p className="m-0 mt-2 text-sm text-text-secondary">{t('places_n', { count: seen.size })}</p>
          )}
          {showMap && <LocationJourneyModal stops={stops} onClose={() => setShowMap(false)} />}
        </section>
      )}
    </DetailRail>
  );
}
