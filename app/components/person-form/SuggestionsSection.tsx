'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { formatYearOrEmpty } from '@/lib/date-utils';
import { displayFullName } from '@/lib/utils/names';
import DateInput from '@/app/components/DateInput';
import LocationField from '@/app/components/LocationField';
import PersonPicker, { type PersonPickerHandle } from '@/app/components/PersonPicker';
import { Button, Badge, Card, fieldClass } from '@/app/components/ui';
import { Search, Sparkles } from '@/lib/icons';
import { FieldLabel, SegmentedControl } from '@/app/components/ui';
import type { UsePersonForm } from '@/app/components/person-form/usePersonForm';
import type { ChildRelationshipType } from '@/lib/data/types';
import { useNoAutofill } from '@/app/hooks/useNoAutofill';

function SuggestionCard({ icon, label, sub, active, onClick, kbdLabel }: {
    icon: string;
    label: string;
    sub: string;
    active: boolean;
    onClick: () => void;
    kbdLabel: string;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-pressed={active}
            className="w-full text-left rounded-[6px] py-2 px-2.5 focus-ring"
            style={{
                border: `1.5px solid ${active ? 'var(--success)' : 'var(--warning-text)'}`,
                background: active ? 'var(--success-bg)' : 'var(--warning-bg)',
                cursor: 'pointer',
                fontFamily: 'inherit',
            }}
        >
            <div className="row gap-[7px] items-start">
                <span className="text-sm leading-none mt-[1px] shrink-0" style={{ color: active ? 'var(--success)' : 'var(--warning-text)' }}>
                    {active ? '✓' : icon}
                </span>
                <div className="flex-1 min-w-0">
                    <div className="row justify-between items-start gap-1">
                        <div className="font-medium text-xs flex-1" style={{ color: active ? 'var(--success)' : 'var(--warning-text)' }}>{label}</div>
                        {kbdLabel && <span className="text-[9px] bg-[rgba(0,0,0,0.06)] border border-[color:var(--border)] py-[1px] px-1 rounded-[3px] shrink-0" style={{ fontFamily: 'monospace', color: 'var(--text-muted)' }}>{kbdLabel}</span>}
                    </div>
                    {sub && <div className="text-xs mt-0.5" style={{ color: active ? 'var(--success)' : 'var(--warning-text)', opacity: 0.8 }}>{sub}</div>}
                </div>
            </div>
        </button>
    );
}

/**
 * SuggestionsSection (new-mode) — smart suggestion cards, marriage fields, and an
 * INLINE manual family/spouse picker (search input + results list inside the card —
 * no sheet). The spouse PersonPicker is consumed via its existing `inline` prop.
 *
 * Structural extraction from PersonForm.tsx (Task 4) — behavior-identical.
 */
export default function SuggestionsSection({
    fm,
    treeId,
    spousePickerRef,
    mobile = false,
}: {
    fm: UsePersonForm;
    treeId: number | null;
    spousePickerRef: React.RefObject<PersonPickerHandle | null>;
    mobile?: boolean;
}) {
    const t = useTranslations('editPerson');
    const tc = useTranslations('common');
    const fieldId = useId();
    // "Search families by surname or year" is name vocabulary to Chrome's
    // classifier, and its dropdown lands on top of this card's own results (#442).
    const noAutofill = useNoAutofill();
    const {
        visibleSuggestions: suggestions, toggleSuggestion: onToggle,
        attachAsChild, setAttachAsChild, attachAsPartner, setAttachAsPartner,
        selectedFamily, setSelectedFamily, selectedSpouse, setSelectedSpouse,
        marriageDate, setMarriageDate, marriagePlace, setMarriagePlace, setMarriagePlaceResolution,
        childRelationshipType, setChildRelationshipType,
        familySearchQuery, setFamilySearchQuery, familySearchResults,
    } = fm;

    const inner = (
        <>
            <div className="row justify-between items-center mb-2.5">
                <h3 className="serif text-base font-semibold m-0">{t('suggestions')}</h3>
                {mobile ? (
                    <Sparkles size={14} style={{ color: 'var(--text-2)' }} aria-hidden="true" />
                ) : suggestions.length > 0 && (
                    <div className="row gap-[3px]">
                        {suggestions.map((_, i) => (
                            <span key={i} className="text-[9px] bg-[rgba(0,0,0,0.06)] border border-[color:var(--border)] py-[1px] px-1 rounded-[3px]" style={{ fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                                Alt+{i + 1}
                            </span>
                        ))}
                    </div>
                )}
            </div>

            {suggestions.length === 0 ? (
                <div className="muted text-meta italic pb-2.5">
                    {t('suggestions_empty')}
                </div>
            ) : (
                <>
                    <div className="flex flex-col gap-2 mb-1.5">
                        {suggestions.map((s, i) => {
                            const isFamily = s.role === 'child';
                            const isActive = isFamily
                                ? (attachAsChild && selectedFamily?.Id === s.familyId)
                                : (attachAsPartner && selectedSpouse?.Id === s.personId);
                            const icon = isFamily ? '⌂' : '♥';
                            const label = isFamily
                                ? t('suggestion_child_of', { family: [s.husbandName, s.wifeName].filter(Boolean).join(' & ') || t('unknown_family') })
                                : t('suggestion_spouse', { name: s.personName || tc('unknown') });
                            const sub = isFamily
                                ? t('children_count', { count: s.childCount ?? 0 })
                                : s.personBirthDate ? t('born_year', { year: formatYearOrEmpty(s.personBirthDate) || s.personBirthDate }) : '';
                            return (
                                <SuggestionCard
                                    key={i}
                                    icon={icon}
                                    label={label}
                                    sub={sub}
                                    active={isActive}
                                    kbdLabel={mobile ? '' : `Alt+${i + 1}`}
                                    onClick={() => onToggle(i)}
                                />
                            );
                        })}
                    </div>
                    {!mobile && (
                        <div className="muted text-xs mb-2.5">
                            {t('suggestions_toggle', { keys: suggestions.length > 1 ? `Alt+1–Alt+${suggestions.length}` : 'Alt+1' })}
                        </div>
                    )}
                </>
            )}

            {/* Marriage fields appear when a spouse is selected via card or picker */}
            {attachAsPartner && selectedSpouse && (
                <div className="border border-[color:var(--success)] rounded-[6px] py-2.5 px-3 mb-3" style={{ background: 'var(--success-bg)' }}>
                    <div className="rel-group-label mb-2">
                        {t('marriage_with', { name: displayFullName(selectedSpouse) || t('partner_fallback') })}
                    </div>
                    <div className="grid grid-cols-1 gap-2.5">
                        <FieldLabel label={t('date')} fullLabel={t('marriage_date')} htmlFor={`${fieldId}-marriage-date`}>
                            <DateInput id={`${fieldId}-marriage-date`} value={marriageDate} onChange={setMarriageDate} className={fieldClass()} />
                        </FieldLabel>
                        <FieldLabel label={t('place')} fullLabel={t('marriage_place')} htmlFor={`${fieldId}-marriage-place`}>
                            <LocationField id={`${fieldId}-marriage-place`} value={marriagePlace} onChange={setMarriagePlace} onResolve={setMarriagePlaceResolution} onRemove={() => setMarriagePlaceResolution(null)} placeId={fm.placeIds.marriage} onPlaceIdChange={(id) => fm.setPlaceId('marriage', id)} treeId={treeId} className={fieldClass()} placeholder={t('place_short_placeholder')} />
                        </FieldLabel>
                    </div>
                </div>
            )}

            <div className="border-t border-t-[color:var(--border-light)] my-3 mx-0" />

            {/* Attach to an existing family. The heading used to read "Manual search",
                which named the mechanism rather than what the section does (#479). */}
            <div className="rel-group-label mb-2">{t('add_to_family')}</div>

            {selectedFamily ? (
                <div className="row justify-between py-2 px-2.5 rounded-[6px] text-meta mb-2" style={{ background: 'var(--card-alt)' }}>
                    <div className="flex-1 min-w-0">
                        <div className="font-medium">{[selectedFamily.husbandName, selectedFamily.wifeName].filter(Boolean).join(' & ') || t('unknown_family')}</div>
                        {selectedFamily.MarriageDate && <div className="muted text-xs">{t('married', { value: selectedFamily.MarriageDate })}</div>}
                    </div>
                    <Button variant="ghost" onClick={() => { setSelectedFamily(null); setAttachAsChild(false); }} className="border-transparent p-1 text-xs" aria-label={tc('remove')} title={tc('remove')}>✕</Button>
                </div>
            ) : (
                <>
                    {/* Magnifying glass, matching the spouse PersonPicker below — this
                        was the one search field on the form with no adornment (#479). */}
                    <div className="relative mb-1.5">
                        <Search className="w-4 h-4 text-text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
                        <input
                            type="text"
                            className={`${fieldClass()} !pl-10`}
                            value={familySearchQuery}
                            onChange={(e) => setFamilySearchQuery(e.target.value)}
                            placeholder={t('search_families_year_placeholder')}
                            {...noAutofill('family-search')}
                        />
                    </div>
                    {familySearchResults.length > 0 && (
                        <div className="flex flex-col gap-1 mb-2">
                            {familySearchResults.slice(0, 5).map((f) => (
                                <button
                                    key={f.Id}
                                    type="button"
                                    onClick={() => { setSelectedFamily(f); setAttachAsChild(true); setFamilySearchQuery(''); }}
                                    className="row gap-2 py-1.5 px-2.5 rounded-[6px] text-meta text-left"
                                    style={{ background: 'var(--card-alt)', cursor: 'pointer', border: 'none', fontFamily: 'inherit', color: 'var(--text)' }}
                                >
                                    <span className="flex-1 min-w-0">{[f.husbandName, f.wifeName].filter(Boolean).join(' & ') || tc('unknown')}{f.MarriageDate ? ` · ${formatYearOrEmpty(f.MarriageDate)}` : ''}</span>
                                    <Badge className="text-[10px]">{t('kids', { count: f.childCount })}</Badge>
                                </button>
                            ))}
                        </div>
                    )}
                </>
            )}

            {attachAsChild && selectedFamily && (
                <div className="mt-2 mb-3">
                    <div className="rel-group-label mb-1.5">{t('relationship_type')}</div>
                    <SegmentedControl
                        value={childRelationshipType}
                        onChange={(v) => setChildRelationshipType(v as ChildRelationshipType)}
                        aria-label={t('relationship_type')}
                        fullWidth={mobile}
                        options={[
                            { v: 'Birth', l: t('rel_birth') },
                            { v: 'Adoption', l: t('rel_adoption') },
                            { v: 'Foster', l: t('rel_foster') },
                        ]}
                    />
                </div>
            )}

            <div className="mt-2">
                <div className="rel-group-label mb-1.5">{t('spouse')}</div>
                <PersonPicker
                    ref={spousePickerRef}
                    value={selectedSpouse}
                    onChange={(p) => {
                        setSelectedSpouse(p);
                        setAttachAsPartner(!!p);
                        if (!p) { setMarriageDate(''); setMarriagePlace(''); }
                    }}
                    showSex
                    showDates
                    treeId={treeId}
                    placeholder={t('search_spouse_placeholder')}
                    inline
                />
            </div>
        </>
    );

    return mobile
        ? <Card className="mb-3">{inner}</Card>
        : <div className="card card-pad p-3.5">{inner}</div>;
}
