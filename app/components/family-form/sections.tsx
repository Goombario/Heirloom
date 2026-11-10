'use client';

import { useTranslations } from 'next-intl';
import { formatYearOrEmpty } from '@/lib/date-utils';
import PersonPicker from '@/app/components/PersonPicker';
import PersonAvatar from '@/app/components/PersonAvatar';
import { getInitials } from '@/lib/utils/initials';
import { displayFullName } from '@/lib/utils/names';
import type { PersonResult, Family } from '@/lib/db/schema';

export function PartnerRow({ index, person, otherSelectedId, onChange, treeId }: {
    index: number;
    person: PersonResult | null;
    otherSelectedId?: number;
    onChange: (p: PersonResult | null) => void;
    treeId: number | null;
}) {
    const t = useTranslations('editFamily');
    return (
        <div className="row gap-3 px-3 py-[10px] rounded-[8px]" style={{ background: 'var(--card-alt)' }}>
            <span className="muted tabular-nums text-xs w-[18px]">{index}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
                <PersonPicker
                    value={person}
                    onChange={onChange}
                    showSex
                    showDates
                    excludeIds={otherSelectedId != null ? [otherSelectedId] : []}
                    treeId={treeId}
                    placeholder={t('search_partner_n', { index })}
                />
            </div>
        </div>
    );
}

export function PersonAvatarMini({ p, treeId }: { p: { Id: number; FirstName: string | null; LastName: string | null; Sex: string | null; PrimaryMediaId?: number; FocalX?: number | null; FocalY?: number | null; FocalRadius?: number | null }; treeId: number | null }) {
    const t = useTranslations('editFamily');
    return (
        <PersonAvatar
            mediaId={p.PrimaryMediaId}
            treeId={treeId}
            name={`${p.FirstName ?? ''} ${p.LastName ?? ''}`.trim() || t('person_fallback')}
            initials={getInitials(p.FirstName, p.LastName)}
            sex={p.Sex}
            size={28}
            focalX={p.FocalX}
            focalY={p.FocalY}
            focalRadius={p.FocalRadius}
        />
    );
}

export function OtherPartnershipsCard({ p1, p2, p1Families, p2Families, currentFamilyId }: {
    p1: PersonResult | null;
    p2: PersonResult | null;
    p1Families: Family[];
    p2Families: Family[];
    currentFamilyId: number;
}) {
    const t = useTranslations('editFamily');
    const tc = useTranslations('common');
    return (
        <div className="card card-pad p-[14px]">
            <h3 className="serif text-base font-semibold m-0 mb-[10px]">{t('other_partnerships')}</h3>
            {[
                { person: p1, families: p1Families },
                { person: p2, families: p2Families },
            ].map((pf, i) => pf.person && (
                <div key={i} className={i === 0 ? 'mb-[10px]' : 'mb-0'}>
                    <div className="rel-group-label mb-1">{t('for_person', { name: displayFullName(pf.person) || tc('unknown') })}</div>
                    {pf.families.length === 0 ? (
                        <div className="muted text-meta">{t('no_other_partnerships')}</div>
                    ) : (
                        pf.families
                            .slice()
                            .sort((a, b) => (a.MarriageDate ?? '').localeCompare(b.MarriageDate ?? ''))
                            .map((f, idx) => {
                                const isCurrent = f.Id === currentFamilyId;
                                return (
                                    <div key={f.Id} className="px-0 py-1 text-meta">
                                        <div className="font-medium">{idx + 1}. {t('partnership_item')} {f.MarriageDate ? `(${formatYearOrEmpty(f.MarriageDate)})` : ''}</div>
                                        {isCurrent && <div className="muted text-xs">{t('viewing_this')}</div>}
                                    </div>
                                );
                            })
                    )}
                </div>
            ))}
        </div>
    );
}
