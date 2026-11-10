'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import Cite from '@/app/components/Cite';
import { chipCitations, numberSources } from '@/app/components/citations/factDescriptors';
import { useTree } from '@/app/contexts/TreeContext';
import type { PersonResult, Family } from '@/lib/db/schema';
import { FACT_TABLES } from '@/lib/db/fact-tables';
import { getDataClient } from '@/lib/data';
import type { ChildRelationshipType, PinChainRow } from '@/lib/data/types';
import type { ChildRelationships } from '@/lib/child-relationship';
import type { HierarchyLevel } from '@/lib/geocode/photon';
import { errorToastKey } from '@/lib/utils/data-error';
import { useErrorToast } from '@/app/components/useErrorToast';
import { useUnsavedChangesGuard } from '@/app/components/UnsavedChangesProvider';
import { usePlaceResolutionFlush } from '@/app/components/usePlaceResolutionFlush';
import { displayFullName } from '@/lib/utils/names';
import type { PendingCitation } from '@/app/components/AttachSourceSidebar';
import {
    emptyForm,
    familyToFormState,
    buildFamilyBody,
    childRowOf,
    childRelationshipsOfRow,
    type FamilyFormState,
    type ChildRow,
    type CitationRow,
    type AttachTarget,
} from './state';
import { useDocumentTitle } from '@/app/hooks/useDocumentTitle';
import { factPlaceEntry, factPlaceKey } from '@/lib/places/place-key';

export type FamilyFormMode =
    | { mode: 'new'; familyId?: undefined }
    | { mode: 'edit'; familyId: number };

export function useFamilyForm(props: FamilyFormMode) {
    const { mode } = props;
    const isNew = mode === 'new';
    const router = useRouter();
    const { activeTreeId } = useTree();
    const t = useTranslations('editFamily');
    const tc = useTranslations('common');
    const { redirectIfUnauthorized } = useErrorToast();

    const formRef = useRef<HTMLFormElement>(null);

    const [form, setForm] = useState<FamilyFormState>(emptyForm);
    const [savedForm, setSavedForm] = useState<FamilyFormState>(emptyForm);
    const [loading, setLoading] = useState(!isNew);
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Partners
    const [partner1, setPartner1] = useState<PersonResult | null>(null);
    const [partner2, setPartner2] = useState<PersonResult | null>(null);

    // Children
    const [children, setChildren] = useState<ChildRow[]>([]);
    const [showChildPicker, setShowChildPicker] = useState(false);

    // Right rail
    const citationScopeKey = isNew ? 'new' : `${activeTreeId ?? 'default'}:${props.familyId}`;
    const citationScopeRef = useRef(citationScopeKey);
    citationScopeRef.current = citationScopeKey;
    const [citations, setCitations] = useState<CitationRow[]>([]);
    const [citationDataKey, setCitationDataKey] = useState<string | null>(isNew ? citationScopeKey : null);
    const [citationError, setCitationError] = useState<string | null>(null);
    const [citationErrorKey, setCitationErrorKey] = useState<string | null>(null);
    const [citationsLoading, setCitationsLoading] = useState(!isNew);
    const [citationsLoaded, setCitationsLoaded] = useState(isNew);
    const citationRequest = useRef(0);
    const [partner1Families, setPartner1Families] = useState<Family[]>([]);
    const [partner2Families, setPartner2Families] = useState<Family[]>([]);
    const [partner1FamiliesKey, setPartner1FamiliesKey] = useState<string | null>(null);
    const [partner2FamiliesKey, setPartner2FamiliesKey] = useState<string | null>(null);
    // These are deliberately separate: the optional other-partnership rail can
    // fail for one partner while the other remains useful. A failed lookup is
    // never represented as an empty successful result.
    const [partner1FamiliesError, setPartner1FamiliesError] = useState<string | null>(null);
    const [partner2FamiliesError, setPartner2FamiliesError] = useState<string | null>(null);
    const [partner1FamiliesErrorKey, setPartner1FamiliesErrorKey] = useState<string | null>(null);
    const [partner2FamiliesErrorKey, setPartner2FamiliesErrorKey] = useState<string | null>(null);
    const partner1FamiliesRequest = useRef(0);
    const partner2FamiliesRequest = useRef(0);
    const [attachTarget, setAttachTarget] = useState<AttachTarget | null>(null);

    // Pending citations queued before family is saved (new mode)
    const [pendingCitations, setPendingCitations] = useState<PendingCitation[]>([]);

    // Pending MarriagePlace resolution (design spec §6.1) — see usePersonForm's
    // identical pattern for BirthPlace/DeathPlace.
    const [marriagePlaceResolution, setMarriagePlaceResolution] = useState<HierarchyLevel[] | null | undefined>(undefined);

    // Read-only lookup for MarriagePlace's already-saved pin chain
    // (edit-mode pin display) — populated below, once, when an existing
    // family loads.
    const [placeChains, setPlaceChains] = useState<Record<string, PinChainRow[]>>({});
    // The place the marriage links to (#1186): the saved one, then the one picked.
    const [marriagePlaceId, setMarriagePlaceId] = useState<number | null>(null);

    const familyId = !isNew ? props.familyId : null;

    // Load existing
    useEffect(() => {
        if (isNew) {
            setLoading(false);
            return;
        }
        const citationScope = citationScopeKey;
        const citationRequestId = ++citationRequest.current;
        setCitationsLoading(true);
        setCitationError(null);
        setCitationErrorKey(null);
        let cancelled = false;
        (async () => {
            try {
                const [data, citations] = await Promise.all([
                    getDataClient().then(client => client.families.get(familyId as number, activeTreeId)),
                    getDataClient().then(c => c.citations.listForFact(FACT_TABLES.FAMILIES, familyId as number, activeTreeId)).catch((err) => {
                        redirectIfUnauthorized(err);
                        return null;
                    }),
                ]);
                if (!data?.family) throw new Error(t('family_not_found'));
                if (cancelled || citationRequest.current !== citationRequestId || citationScopeRef.current !== citationScope) return;
                const loadedForm = familyToFormState(data.family);
                setMarriagePlaceId(data.family.MarriagePlaceId ?? null);
                setForm(loadedForm);
                setSavedForm(loadedForm);
                setPartner1(data.husband ?? null);
                setPartner2(data.wife ?? null);
                setChildren((data.children ?? []).map(childRowOf));
                if (citations) {
                    setCitations(citations);
                    setCitationDataKey(citationScope);
                    setCitationError(null);
                    setCitationErrorKey(null);
                } else {
                    setCitationError(t('failed_load'));
                    setCitationErrorKey(citationScope);
                }
                setCitationsLoaded(true);

                // Read-only lookup for MarriagePlace's already-saved pin chain
                // (edit-mode pin display) — keyed off the just-fetched server value, not
                // the live/editable form state, so it fires exactly once per family load
                // and never re-fires while the user types.
                const placeKey = factPlaceKey(data.family.MarriagePlace, data.family.MarriagePlaceId);
                if (placeKey != null) {
                    try {
                        const client = await getDataClient();
                        const chains = await client.places.pinChains([placeKey], activeTreeId);
                        if (!cancelled) setPlaceChains(chains);
                    } catch {
                        // Best-effort — a failed lookup just means no badge shows this session.
                    }
                }
            } catch (err) {
                if (!cancelled && !redirectIfUnauthorized(err)) setError(tc(errorToastKey(err)));
            } finally {
                if (citationRequest.current === citationRequestId && citationScopeRef.current === citationScope) {
                    setCitationsLoading(false);
                }
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [isNew, familyId, activeTreeId, citationScopeKey, t, tc, redirectIfUnauthorized]);

    const partnerTitle = (() => {
        if (!partner1 && !partner2) return null;
        const name = (p: typeof partner1) => p ? (displayFullName(p) || tc('unknown')) : null;
        const n1 = name(partner1);
        const n2 = name(partner2);
        return n1 && n2 ? `${n1} & ${n2}` : n1 ?? n2 ?? t('family_fallback');
    })();
    useDocumentTitle(isNew ? t('add_partnership') : partnerTitle);

    // Load each partner's other families for the right rail. Each lookup has its
    // own lifecycle and retry so one partner's failure cannot hide the other's.
    const loadPartnerFamilies = useCallback(async (
        personId: number | undefined,
        setFamilies: (families: Family[]) => void,
        setFamiliesKey: (key: string | null) => void,
        setLoadError: (error: string | null) => void,
        setLoadErrorKey: (key: string | null) => void,
        requestRef: { current: number },
    ) => {
        const request = ++requestRef.current;
        if (!personId) {
            setFamilies([]);
            setFamiliesKey(null);
            setLoadError(null);
            setLoadErrorKey(null);
            return;
        }
        setLoadError(null);
        setLoadErrorKey(null);
        try {
            const client = await getDataClient();
            const p = await client.people.get(personId, activeTreeId);
            if (requestRef.current !== request) return;
            setFamilies((p?.familiesAsSpouse ?? []) as Family[]);
            setFamiliesKey(`${activeTreeId ?? 'default'}:${personId}`);
        } catch (e) {
            if (requestRef.current !== request || redirectIfUnauthorized(e)) return;
            setLoadError(tc(errorToastKey(e)));
            setLoadErrorKey(`${activeTreeId ?? 'default'}:${personId}`);
        }
    }, [activeTreeId, redirectIfUnauthorized, tc]);

    useEffect(() => {
        if (isNew) return;
        let cancelled = false;
        void loadPartnerFamilies(partner1?.Id, (families) => { if (!cancelled) setPartner1Families(families); }, (key) => { if (!cancelled) setPartner1FamiliesKey(key); }, (e) => { if (!cancelled) setPartner1FamiliesError(e); }, (key) => { if (!cancelled) setPartner1FamiliesErrorKey(key); }, partner1FamiliesRequest);
        return () => { cancelled = true; };
    }, [isNew, partner1?.Id, loadPartnerFamilies]);

    useEffect(() => {
        if (isNew) return;
        let cancelled = false;
        void loadPartnerFamilies(partner2?.Id, (families) => { if (!cancelled) setPartner2Families(families); }, (key) => { if (!cancelled) setPartner2FamiliesKey(key); }, (e) => { if (!cancelled) setPartner2FamiliesError(e); }, (key) => { if (!cancelled) setPartner2FamiliesErrorKey(key); }, partner2FamiliesRequest);
        return () => { cancelled = true; };
    }, [isNew, partner2?.Id, loadPartnerFamilies]);

    const retryPartner1Families = useCallback(() => {
        void loadPartnerFamilies(partner1?.Id, setPartner1Families, setPartner1FamiliesKey, setPartner1FamiliesError, setPartner1FamiliesErrorKey, partner1FamiliesRequest);
    }, [loadPartnerFamilies, partner1?.Id]);
    const retryPartner2Families = useCallback(() => {
        void loadPartnerFamilies(partner2?.Id, setPartner2Families, setPartner2FamiliesKey, setPartner2FamiliesError, setPartner2FamiliesErrorKey, partner2FamiliesRequest);
    }, [loadPartnerFamilies, partner2?.Id]);

    // Ctrl/Cmd+S saves. Esc intentionally does NOT cancel — too easy to lose edits.
    useEffect(() => {
        function handleKeyDown(e: KeyboardEvent) {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                e.preventDefault();
                formRef.current?.requestSubmit();
            }
        }
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, []);

    function handleChange<K extends keyof FamilyFormState>(field: K, value: FamilyFormState[K]) {
        setForm((prev) => ({ ...prev, [field]: value }));
    }

    // Post-save flush for the pending MarriagePlace resolution — shared with the
    // person form and the tree sidebar (#461), which each held their own copy.
    const flushPlaceResolution = usePlaceResolutionFlush(activeTreeId);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setSaving(true);
        setError(null);

        try {
            const body = {
                ...buildFamilyBody(form, partner1?.Id ?? null, partner2?.Id ?? null),
                MarriagePlaceId: form.MarriagePlace ? marriagePlaceId : null,
            };

            const client = await getDataClient();
            const savedFamily = isNew
                ? await client.families.create(body, activeTreeId)
                : await client.families.update(familyId as number, body, activeTreeId);
            const newFamilyId = savedFamily.Id;

            await flushPlaceResolution(form.MarriagePlace, marriagePlaceResolution, savedFamily.MarriagePlaceId);

            // Flush pending citations now that we have a real familyId. Collect any
            // failures so we surface them instead of silently dropping sources.
            const subFailures: string[] = [];

            // Children staged while the family had no id (#477). Each carries its own
            // relationship to each partner, so an adoption chosen before the first save
            // survives it. Failures are collected per child rather than aborting the rest — a
            // dropped child must be named, not silently lost.
            if (isNew && children.length > 0) {
                for (const c of children) {
                    try {
                        const client = await getDataClient();
                        await client.families.addChild(
                            newFamilyId,
                            c.person.Id,
                            childRelationshipsOfRow(c),
                            activeTreeId,
                        );
                    } catch {
                        subFailures.push(t('partial_save_child', { name: displayFullName(c.person) || tc('unknown') }));
                    }
                }
            }

            if (isNew && pendingCitations.length > 0) {
                for (const pc of pendingCitations) {
                    let sourceId: number | undefined = pc.sourceId;
                    if (!sourceId && pc.newSource) {
                        let createdSource;
                        try {
                            const client = await getDataClient();
                            createdSource = await client.sources.create(pc.newSource, activeTreeId);
                        } catch {
                            subFailures.push(t('partial_save_source'));
                            continue;
                        }
                        sourceId = createdSource.Id;
                    }
                    if (sourceId) {
                        try {
                            const client = await getDataClient();
                            await client.citations.create({ FactTable: FACT_TABLES.FAMILIES, FactId: newFamilyId, SourceId: sourceId, Page: pc.page, Quay: pc.quay ?? null, DataText: pc.dataText ?? null, Url: pc.url ?? null }, activeTreeId);
                        } catch {
                            subFailures.push(t('partial_save_citation'));
                        }
                    }
                }
            }

            if (subFailures.length > 0) {
                setError(t('partial_save_failed', { details: subFailures.join('; ') }));
                setSaving(false);
                return;
            }

            if (!isNew) setSavedForm(form);
            router.push(`/families/view?id=${newFamilyId}`);
        } catch (err) {
            if (!redirectIfUnauthorized(err)) setError(tc(errorToastKey(err)));
            setSaving(false);
        }
    }

    async function handleDelete() {
        if (isNew) return;
        setDeleting(true);
        try {
            const client = await getDataClient();
            await client.families.remove(familyId as number, activeTreeId);
            router.push('/families');
        } catch (err) {
            if (!redirectIfUnauthorized(err)) setError(tc(errorToastKey(err)));
            setDeleting(false);
            setShowDeleteConfirm(false);
        }
    }

    async function addChild(person: PersonResult) {
        if (!familyId) {
            // New family: there is no row to attach to yet, so the child is staged
            // locally and flushed in handleSubmit once the family exists — the same
            // shape usePersonForm uses for name variants and family linkage.
            // PersonResult carries every field this list renders (name, avatar,
            // birth/death years); the full Person arrives on the next load.
            setChildren((prev) => prev.some((c) => c.person.Id === person.Id)
                ? prev
                : [...prev, { person: person as ChildRow['person'], partner1Relationship: 'Birth', partner2Relationship: 'Birth' }]);
            setShowChildPicker(false);
            return;
        }
        try {
            const client = await getDataClient();
            await client.families.addChild(familyId as number, person.Id, 'Birth', activeTreeId);
            const data = await client.families.get(familyId as number, activeTreeId);
            setChildren((data.children ?? []).map(childRowOf));
        } catch {
            setError(t('add_child_failed'));
        } finally {
            setShowChildPicker(false);
        }
    }

    /** Set the child's relationship to both partners, or to one when `slot` names it (#982). */
    async function updateChildType(childId: number, newType: ChildRelationshipType, slot?: 'partner1' | 'partner2') {
        const row = children.find((c) => c.person.Id === childId);
        if (!row) return;
        const next: ChildRelationships = {
            partner1: slot === 'partner2' ? childRelationshipsOfRow(row).partner1 : newType,
            partner2: slot === 'partner1' ? childRelationshipsOfRow(row).partner2 : newType,
        };
        const apply = (prev: ChildRow[]) => prev.map((c) => c.person.Id === childId
            ? { ...c, partner1Relationship: next.partner1, partner2Relationship: next.partner2 }
            : c);
        if (!familyId) {
            setChildren(apply);
            return;
        }
        try {
            const client = await getDataClient();
            await client.families.updateChildType(familyId as number, childId, next, activeTreeId);
            setChildren(apply);
        } catch {
            setError(t('failed_save'));
        }
    }

    async function removeChild(childId: number) {
        if (!familyId) {
            setChildren((prev) => prev.filter((c) => c.person.Id !== childId));
            return;
        }
        try {
            const client = await getDataClient();
            await client.families.removeChild(familyId as number, childId, activeTreeId);
            setChildren((prev) => prev.filter((c) => c.person.Id !== childId));
        } catch {
            setError(t('failed_delete'));
        }
    }

    const currentCitations = useMemo(
        () => citationDataKey === citationScopeKey ? citations : [],
        [citationDataKey, citationScopeKey, citations],
    );
    const currentCitationError = citationErrorKey === citationScopeKey ? citationError : null;
    const citationsReady = isNew || (
        citationDataKey === citationScopeKey
        && citationsLoaded
        && !citationsLoading
        && currentCitationError == null
    );

    // One fact, so the form's footnotes are its citations' sources in order (#754).
    const sourceNumbers = useMemo(() => numberSources([{ citations: currentCitations }]), [currentCitations]);
    const cite = useCallback((factLabel: string) => {
        if (isNew) {
            const pendingForField = pendingCitations.filter(p => p.factLabel === factLabel);
            if (pendingForField.length > 0) {
                return <Cite pending onClick={() => setAttachTarget({ factTable: 'Families', factId: -1, factLabel })} />;
            }
            return <Cite empty factLabel={factLabel} onClick={() => setAttachTarget({ factTable: 'Families', factId: -1, factLabel })} />;
        }
        if (!familyId) return <Cite empty factLabel={factLabel} />;
        if (currentCitations.length === 0) {
            return <Cite empty factLabel={factLabel} onClick={citationsReady ? () => setAttachTarget({ factTable: 'Families', factId: familyId, factLabel }) : undefined} />;
        }
        // Stack one pin per source so multiple sources on a fact are all visible,
        // matching the person/family detail pages.
        return (
            <>
                {chipCitations(currentCitations, sourceNumbers).map(c => (
                    <Cite key={c.Id} n={sourceNumbers.get(c.SourceId)} sourceTitle={c.sourceTitle ?? undefined} onClick={citationsReady ? () => setAttachTarget({ factTable: 'Families', factId: familyId, factLabel }) : undefined} />
                ))}
            </>
        );
    }, [isNew, familyId, currentCitations, pendingCitations, citationsReady, sourceNumbers]);

    // A new family can stage partners, children, citations, and a place pin
    // before its row exists. Track those non-scalar values alongside the visible
    // fields so a navigation prompt reflects everything the save will persist.
    const draftFingerprint = JSON.stringify({
        form, partner1, partner2, children, pendingCitations, marriagePlaceResolution,
    });
    const emptyDraftFingerprint = JSON.stringify({
        form: emptyForm, partner1: null, partner2: null, children: [], pendingCitations: [],
        marriagePlaceResolution: undefined,
    });
    const isDirty = isNew
        ? draftFingerprint !== emptyDraftFingerprint
        : JSON.stringify(form) !== JSON.stringify(savedForm);
    const { onNavigate, guardNavigation } = useUnsavedChangesGuard(isDirty);

    const reloadCitations = useCallback(async () => {
        if (isNew || !familyId) return;
        const citationScope = citationScopeKey;
        const request = ++citationRequest.current;
        setCitationsLoading(true);
        setCitationError(null);
        try {
            const cits = await getDataClient().then(c => c.citations.listForFact(FACT_TABLES.FAMILIES, familyId, activeTreeId));
            if (citationRequest.current !== request || citationScopeRef.current !== citationScope) return;
            setCitations(cits ?? []);
            setCitationDataKey(citationScope);
            setCitationErrorKey(null);
            setCitationsLoaded(true);
        } catch (err) {
            if (citationRequest.current !== request || citationScopeRef.current !== citationScope) return;
            if (redirectIfUnauthorized(err)) {
                setCitationError(t('failed_load'));
                setCitationErrorKey(citationScope);
                return;
            }
            // Preserve stale evidence while making the failed revalidation
            // explicit; an error is never represented as an empty list.
            setCitationsLoaded(true);
            setCitationError(t('failed_load'));
            setCitationErrorKey(citationScope);
        } finally {
            if (citationRequest.current === request && citationScopeRef.current === citationScope) setCitationsLoading(false);
        }
    }, [isNew, familyId, activeTreeId, citationScopeKey, redirectIfUnauthorized, t]);

    return {
        isNew,
        familyId,
        activeTreeId,
        formRef,
        form,
        handleChange,
        setMarriagePlaceResolution,
        marriagePlaceInitialChain: factPlaceEntry(placeChains, form.MarriagePlace, marriagePlaceId) ?? null,
        marriagePlaceId,
        setMarriagePlaceId,
        loading,
        saving,
        deleting,
        showDeleteConfirm,
        setShowDeleteConfirm,
        error,
        partner1,
        setPartner1,
        partner2,
        setPartner2,
        children,
        showChildPicker,
        setShowChildPicker,
        citations: currentCitations,
        sourceNumbers,
        citationError: currentCitationError,
        citationsLoading,
        citationsReady,
        partner1Families: partner1FamiliesKey === `${activeTreeId ?? 'default'}:${partner1?.Id}` ? partner1Families : [],
        partner2Families: partner2FamiliesKey === `${activeTreeId ?? 'default'}:${partner2?.Id}` ? partner2Families : [],
        partner1FamiliesError: partner1FamiliesErrorKey === `${activeTreeId ?? 'default'}:${partner1?.Id}` ? partner1FamiliesError : null,
        partner2FamiliesError: partner2FamiliesErrorKey === `${activeTreeId ?? 'default'}:${partner2?.Id}` ? partner2FamiliesError : null,
        retryPartner1Families,
        retryPartner2Families,
        attachTarget,
        setAttachTarget,
        pendingCitations,
        setPendingCitations,
        handleSubmit,
        handleDelete,
        addChild,
        updateChildType,
        removeChild,
        cite,
        reloadCitations,
        onNavigate,
        guardNavigation,
    };
}
