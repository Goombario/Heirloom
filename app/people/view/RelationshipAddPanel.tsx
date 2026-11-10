'use client';

/**
 * RelationshipAddPanel — inline Add Partner / Add To-family panel in the
 * detail-page relationships card (Task 5).
 *
 * Controlled: the open state + the "Add" toggle live in the parent
 * (`RelationshipList`, which renders the toggle in the card header and mounts
 * this panel only while open). This component renders the panel body and calls
 * `onClose()` after a successful add. Outside-click / Escape close is owned by
 * the parent (it wraps both the toggle and this panel in one ref).
 *
 * Reuses the exact mutation flows from `RelationshipsSection.tsx` (edit-page):
 * `client.families.create({ Partner1Id, Partner2Id })` for a new partnership
 * and `client.families.addChild(familyId, personId, 'Birth')` to join an
 * existing family as a child. "Add child" (needs a partner-selection step
 * first) is intentionally omitted this pass.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import PersonPicker, { type PersonPickerHandle } from '@/app/components/PersonPicker';
import { Button, Badge, SegmentedControl, fieldClass } from '@/app/components/ui';
import { getDataClient } from '@/lib/data';
import { displayFullName } from '@/lib/utils/names';
import { formatYearOrEmpty } from '@/lib/date-utils';
import type { PersonResult } from '@/lib/db/schema';
import type { FamilySearchResult } from '@/app/components/person-form/usePersonForm';
import { useNoAutofill } from '@/app/hooks/useNoAutofill';

export interface RelationshipAddPanelProps {
    personId: number;
    /** Active tree scope; `null` = the user's default tree (server-resolved) — a
     *  normal, common value, not a "not-ready-yet" state. */
    treeId: number | null;
    excludeIds: number[];
    onAdded: () => void;
    /** Close the panel — its open state + the "Add" toggle live in the parent. */
    onClose: () => void;
    /** `family` opens on "To family" (joining a family as a child), for "Add parents". */
    initialTab?: Tab;
}

type Tab = 'partner' | 'family';

export function RelationshipAddPanel({ personId, treeId, excludeIds, onAdded, onClose, initialTab = 'partner' }: RelationshipAddPanelProps) {
    const t = useTranslations('personDetail');
    const te = useTranslations('editPerson');
    const tc = useTranslations('common');
    // See useNoAutofill — this searches families in the tree, never the user (#442).
    const noAutofill = useNoAutofill();

    const [tab, setTab] = useState<Tab>(initialTab);
    const [busy, setBusy] = useState(false);
    // "Add" opens this panel to search for someone, so the search box is where the
    // user is going next — it used to take a second click to get there (#440).
    // Refocused on every tab switch too: each tab has its own search box.
    const partnerPickerRef = useRef<PersonPickerHandle>(null);
    const familyInputRef = useRef<HTMLInputElement>(null);
    useEffect(() => {
        // Deferred a frame: on the FIRST render the tab's input has only just been
        // committed, and Safari drops a focus() call made in the same commit.
        const raf = requestAnimationFrame(() => {
            if (tab === 'partner') partnerPickerRef.current?.focus();
            else familyInputRef.current?.focus();
        });
        return () => cancelAnimationFrame(raf);
    }, [tab]);
    const [addSpouse, setAddSpouse] = useState<PersonResult | null>(null);
    const [familyQuery, setFamilyQuery] = useState('');
    const [familyResults, setFamilyResults] = useState<FamilySearchResult[]>([]);

    // Debounced family search — mirrors RelationshipsSection.tsx exactly.
    useEffect(() => {
        if (familyQuery.trim().length < 2) { setFamilyResults([]); return; }
        let cancelled = false;
        const timer = setTimeout(async () => {
            try {
                const client = await getDataClient();
                const results = await client.families.search(familyQuery, treeId);
                if (!cancelled) setFamilyResults(results);
            } catch { /* ignore */ }
        }, 250);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [familyQuery, treeId]);

    async function createSpouse() {
        if (!addSpouse) return;
        setBusy(true);
        try {
            const client = await getDataClient();
            await client.families.create({ Partner1Id: personId, Partner2Id: addSpouse.Id }, treeId);
            onAdded();
            onClose();
        } catch {
            // Mirrors RelationshipsSection's silent-fail contract.
        } finally {
            setBusy(false);
        }
    }

    async function joinFamilyAsChild(familyId: number) {
        setBusy(true);
        try {
            const client = await getDataClient();
            await client.families.addChild(familyId, personId, 'Birth', treeId);
            onAdded();
            onClose();
        } catch {
            // Mirrors RelationshipsSection's silent-fail contract.
        } finally {
            setBusy(false);
        }
    }

    return (
        <div
            className="mb-3.5 rounded-lg p-3 flex flex-col gap-3"
            style={{ background: 'var(--card-alt)', border: '1px solid var(--border-light)' }}
        >
            <SegmentedControl
                value={tab}
                onChange={(v) => setTab(v as Tab)}
                aria-label={t('relationships')}
                fullWidth
                options={[
                    { v: 'partner', l: t('tab_partner') },
                    { v: 'family', l: t('tab_to_family') },
                ]}
            />

            {tab === 'partner' ? (
                <div>
                    <PersonPicker
                        ref={partnerPickerRef}
                        value={addSpouse}
                        onChange={setAddSpouse}
                        excludeIds={excludeIds}
                        treeId={treeId}
                        showDates
                        inline
                        placeholder={te('search_partner_placeholder')}
                    />
                    {addSpouse && (
                        <Button
                            variant="outline"
                            disabled={busy}
                            onClick={createSpouse}
                            className="mt-2 text-meta min-h-11"
                        >
                            {busy ? te('adding') : te('add_as_partner', { name: displayFullName(addSpouse) })}
                        </Button>
                    )}
                </div>
            ) : (
                <div>
                    <div className="muted text-xs mb-1.5">{t('to_family_hint')}</div>
                    <input
                        ref={familyInputRef}
                        type="text"
                        className={fieldClass()}
                        value={familyQuery}
                        onChange={(e) => setFamilyQuery(e.target.value)}
                        placeholder={te('search_families_plain')}
                        {...noAutofill('family-search')}
                    />
                    {familyResults.length > 0 && (
                        <div className="flex flex-col gap-1 mt-1.5">
                            {familyResults.slice(0, 6).map((f) => (
                                <button
                                    key={f.Id}
                                    type="button"
                                    disabled={busy}
                                    onClick={() => joinFamilyAsChild(f.Id)}
                                    className="row gap-2 py-2.5 px-2 rounded-[6px] min-h-11 w-full"
                                    style={{ background: 'var(--card)', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}
                                >
                                    <span className="flex-1 min-w-0 text-meta">
                                        {[f.husbandName, f.wifeName].filter(Boolean).join(' & ') || tc('unknown')}
                                        {f.MarriageDate ? ` · ${formatYearOrEmpty(f.MarriageDate)}` : ''}
                                    </span>
                                    <Badge>{te('kids', { count: f.childCount })}</Badge>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
