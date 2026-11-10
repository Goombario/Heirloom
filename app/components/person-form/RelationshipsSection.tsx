'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { formatYearOrEmpty } from '@/lib/date-utils';
import Link from 'next/link';
import PersonPicker from '@/app/components/PersonPicker';
import PersonAvatar from '@/app/components/PersonAvatar';
import { Button, Badge, Card, fieldClass, Lifespan } from '@/app/components/ui';
import { getInitials } from '@/lib/utils/initials';
import { displayFullName } from '@/lib/utils/names';
import { getDataClient } from '@/lib/data';
import type { PersonResult, PersonWithRelations, Family, Person } from '@/lib/db/schema';
import type { FamilySearchResult } from '@/app/components/person-form/usePersonForm';

function PersonAvatarMini({ p, treeId }: { p: Pick<Person, 'Id' | 'FirstName' | 'LastName' | 'Sex'> & { PrimaryMediaId?: number | null; FocalX?: number | null; FocalY?: number | null; FocalRadius?: number | null }; treeId: number | null }) {
    const t = useTranslations('editPerson');
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

/**
 * RelationshipsSection (edit-mode) — read-out of parents / partners / children
 * plus add-partner (PersonPicker) and add-to-family-as-child search. Owns its own
 * mutation state; calls `onChanged` to re-fetch the resolved relationships.
 *
 * Structural extraction from PersonForm.tsx (Task 4) — behavior-identical.
 */
export default function RelationshipsSection({ relations, familiesAsSpouse, familiesAsChild, treeId, personId, personLastName, onChanged, onNavigate, mobile = false }: {
    relations: PersonWithRelations | null;
    familiesAsSpouse: Family[];
    familiesAsChild: Family[];
    treeId: number | null;
    personId: number | null;
    personLastName: string;
    onChanged: () => void;
    /** The owning person form's guard; relationship links replace that draft. */
    onNavigate?: (event: { preventDefault: () => void }) => void;
    mobile?: boolean;
}) {
    const t = useTranslations('editPerson');
    const tc = useTranslations('common');
    const parents = relations?.parents ?? [];
    const spouses = relations?.spouses ?? [];
    const canEdit = personId != null;
    // Touch-sized hit area for the inline remove (✕) buttons on mobile.
    const removeBtnCls = mobile ? 'border-transparent !p-1 text-xs min-w-11 min-h-11' : 'border-transparent !p-1 text-xs';

    const [busy, setBusy] = useState(false);
    const [addSpouse, setAddSpouse] = useState<PersonResult | null>(null);
    const [familyQuery, setFamilyQuery] = useState('');
    const [familyResults, setFamilyResults] = useState<FamilySearchResult[]>([]);

    // IDs already related to this person — excluded from the spouse picker.
    const relatedIds = new Set<number>();
    if (personId) relatedIds.add(personId);
    spouses.forEach((s) => s.person && relatedIds.add(s.person.Id));

    useEffect(() => {
        if (familyQuery.trim().length < 2) { setFamilyResults([]); return; }
        let cancelled = false;
        const t = setTimeout(async () => {
            try {
                const client = await getDataClient();
                const results = await client.families.search(familyQuery, treeId);
                if (!cancelled) setFamilyResults(results);
            } catch { /* ignore */ }
        }, 250);
        return () => { cancelled = true; clearTimeout(t); };
    }, [familyQuery, treeId]);

    async function mutate(fn: () => Promise<void>) {
        setBusy(true);
        try {
            await fn();
            onChanged();
        } catch {
            // RelationshipsSection has no error UI; swallow to avoid an unhandled
            // rejection (preserves the pre-migration silent-fail contract).
        } finally {
            setBusy(false);
        }
    }

    async function createSpouse() {
        if (!personId || !addSpouse) return;
        await mutate(async () => {
            const client = await getDataClient();
            await client.families.create({ Partner1Id: personId, Partner2Id: addSpouse.Id }, treeId);
        });
        setAddSpouse(null);
    }

    async function joinFamilyAsChild(familyId: number) {
        if (!personId) return;
        await mutate(async () => {
            const client = await getDataClient();
            await client.families.addChild(familyId, personId, 'Birth', treeId);
        });
        setFamilyQuery('');
        setFamilyResults([]);
    }

    function removeFromFamily(familyId: number) {
        if (!personId) return;
        mutate(async () => {
            const client = await getDataClient();
            await client.families.removeChild(familyId, personId, treeId);
        });
    }

    function removeChild(familyId: number, childId: number) {
        mutate(async () => {
            const client = await getDataClient();
            await client.families.removeChild(familyId, childId, treeId);
        });
    }

    function deletePartnership(familyId: number) {
        mutate(async () => {
            const client = await getDataClient();
            await client.families.remove(familyId, treeId);
        });
    }

    const inner = (
        <>
            <h3 className="serif text-base font-semibold mb-2.5">{t('relationships')}</h3>

            <div className="rel-group-label mb-1.5">{t('parents')}</div>
            {parents.length === 0 ? (
                <div className="muted text-meta pt-1 px-0 pb-2.5">{tc('unknown')}</div>
            ) : (
                <div className="flex flex-col gap-1.5 pb-2.5">
                    {parents.map((rel, i) => (
                        <div key={i} className="row gap-2 items-center">
                            <div className="flex-1 flex flex-col gap-1">
                                {[rel.father, rel.mother].filter(Boolean).map((p, j) => p && (
                                    <Link key={j} href={`/people/view?id=${p.Id}`} onNavigate={onNavigate} className="row gap-2 text-meta no-underline" style={{ color: 'var(--text)' }}>
                                        <PersonAvatarMini p={p} treeId={treeId} />
                                        <span className="flex-1">{displayFullName(p) || tc('unknown')}</span>
                                    </Link>
                                ))}
                            </div>
                            {canEdit && (
                                <Button variant="ghost" disabled={busy} onClick={() => removeFromFamily(rel.family.Id)} className={removeBtnCls} title={t('remove_parent_link_title')} aria-label={t('remove_parent_link')}>✕</Button>
                            )}
                        </div>
                    ))}
                </div>
            )}

            <div className="rel-group-label mb-1.5">{t('partners', { count: familiesAsSpouse.length })}</div>
            {spouses.length === 0 ? (
                <div className="muted text-meta pt-1 px-0 pb-2.5">{t('none')}</div>
            ) : (
                <div className="flex flex-col gap-2 pb-2.5">
                    {spouses.map((s, i) => (
                        <div key={i} className="flex flex-col gap-1">
                            <div className="row gap-2 items-center">
                                {s.person ? (
                                    <Link href={`/families/view?id=${s.family.Id}`} onNavigate={onNavigate} className="row gap-2 flex-1 text-meta no-underline" style={{ color: 'var(--text)' }}>
                                        <PersonAvatarMini p={s.person} treeId={treeId} />
                                        <div className="flex-1">
                                            <div className="font-medium">{displayFullName(s.person) || tc('unknown')}</div>
                                            {s.family.MarriageDate && <div className="muted text-xs">{t('married', { value: formatYearOrEmpty(s.family.MarriageDate) || s.family.MarriageDate })}</div>}
                                        </div>
                                    </Link>
                                ) : (
                                    <span className="muted flex-1 text-meta">{t('partnership_no_partner')}</span>
                                )}
                                {canEdit && (
                                    <Button variant="ghost" disabled={busy} onClick={() => deletePartnership(s.family.Id)} className={removeBtnCls} title={t('delete_partnership')} aria-label={t('delete_partnership')}>✕</Button>
                                )}
                            </div>
                            {(s.children ?? []).map((c) => (
                                <div key={c.Id} className="row gap-2 items-center pl-5">
                                    <Link href={`/people/view?id=${c.Id}`} onNavigate={onNavigate} className="row gap-2 flex-1 text-meta no-underline" style={{ color: 'var(--text)' }}>
                                        <PersonAvatarMini p={c} treeId={treeId} />
                                        <span className="flex-1">{displayFullName(c)}</span>
                                        <Lifespan birth={c.BirthDate} death={c.DeathDate} className="text-xs" />
                                    </Link>
                                    {canEdit && (
                                        <Button variant="ghost" disabled={busy} onClick={() => removeChild(s.family.Id, c.Id)} className={removeBtnCls} title={t('remove_child')} aria-label={t('remove_child')}>✕</Button>
                                    )}
                                </div>
                            ))}
                        </div>
                    ))}
                </div>
            )}

            {familiesAsChild.length > 0 && (
                <div className="muted text-xs mb-2.5">
                    {t('listed_as_child', { count: familiesAsChild.length })}
                </div>
            )}

            {/* Add controls */}
            {canEdit && (
                <div className="mt-3 pt-3 border-t border-t-[color:var(--border-light)] flex flex-col gap-3">
                    <div>
                        <div className="rel-group-label mb-1.5">{t('add_partner')}</div>
                        <PersonPicker
                            value={addSpouse}
                            onChange={setAddSpouse}
                            excludeIds={Array.from(relatedIds)}
                            treeId={treeId}
                            showDates
                            placeholder={t('search_partner_placeholder')}
                        />
                        {addSpouse && (
                            <Button variant="outline" disabled={busy} onClick={createSpouse} className="mt-2 text-meta">
                                {busy ? t('adding') : t('add_as_partner', { name: displayFullName(addSpouse) })}
                            </Button>
                        )}
                    </div>
                    <div>
                        <div className="rel-group-label mb-1.5">{t('add_to_family_child')}</div>
                        <input
                            type="text"
                            className={fieldClass()}
                            value={familyQuery}
                            onChange={(e) => setFamilyQuery(e.target.value)}
                            placeholder={personLastName ? t('search_families_eg', { name: personLastName }) : t('search_families_plain')}
                        />
                        {familyResults.length > 0 && (
                            <div className="flex flex-col gap-1 mt-1.5">
                                {familyResults.slice(0, 6).map((f) => (
                                    <button
                                        key={f.Id}
                                        type="button"
                                        disabled={busy}
                                        onClick={() => joinFamilyAsChild(f.Id)}
                                        className="row gap-2 py-1.5 px-2 rounded-[6px]"
                                        style={{ background: 'var(--card-alt)', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}
                                    >
                                        <span className="flex-1 min-w-0 text-meta">{[f.husbandName, f.wifeName].filter(Boolean).join(' & ') || tc('unknown')}{f.MarriageDate ? ` · ${formatYearOrEmpty(f.MarriageDate)}` : ''}</span>
                                        <Badge className="text-[10px]">{t('kids', { count: f.childCount })}</Badge>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </>
    );

    return mobile
        ? <Card className="mb-3">{inner}</Card>
        : <div className="card card-pad p-3.5">{inner}</div>;
}
