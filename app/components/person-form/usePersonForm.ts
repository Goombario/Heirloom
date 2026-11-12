'use client';

import { useState, useEffect, useRef, useCallback, useMemo, createElement, Fragment } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import Cite from '@/app/components/Cite';
import { chipCitations, numberSources } from '@/app/components/citations/factDescriptors';
import type { PendingCitation } from '@/app/components/AttachSourceSidebar';
import type { NewPersonDraft, PickedPerson } from '@/app/components/PersonPickerSheet';
import { useTree } from '@/app/contexts/TreeContext';
import type { PersonResult, PersonWithRelations, Family } from '@/lib/db/schema';
import type { FamilySuggestion } from '@/lib/family-suggestions';
import { FACT_TABLES } from '@/lib/db/fact-tables';
import type { FactTableValue } from '@/lib/db/fact-tables';
import { getDataClient } from '@/lib/data';
import type { ChildRelationshipType, PinChainRow } from '@/lib/data/types';
import type { ChildRelationships } from '@/lib/child-relationship';
import type { HierarchyLevel } from '@/lib/geocode/photon';
import { useErrorToast } from '@/app/components/useErrorToast';
import { useUnsavedChangesGuard } from '@/app/components/UnsavedChangesProvider';
import { usePlaceResolutionFlush } from '@/app/components/usePlaceResolutionFlush';
import { useIsMobile } from '@/app/hooks/useIsMobile';
import { scrollToTop } from '@/lib/scroll';
import { sortableYear } from '@/lib/date-utils';
import { displayFullName } from '@/lib/utils/names';
import { DEATH_DETAILS_CLEARED, statusDropsDeath } from './vitalEvent';
import { useDocumentTitle } from '@/app/hooks/useDocumentTitle';
import { factPlaceEntry, factPlaceKey, uniquePlaceKeys } from '@/lib/places/place-key';

/** The facts the form cites, each independently rather than lumping everything
 *  onto the whole-person record. One pin per fact, on its heading (#548). */
const FORM_FACT_TABLES = {
    Name: FACT_TABLES.PERSON_NAME,
    Birth: FACT_TABLES.PERSON_BIRTH,
    Death: FACT_TABLES.PERSON_DEATH,
} as const;
type FormFact = keyof typeof FORM_FACT_TABLES;

/** The place each place field links to (#1186); null for none or a new place. */
interface FormPlaceIds {
    birth: number | null;
    death: number | null;
    /** The new family's, when the person is added with a partner. */
    marriage: number | null;
}

const NO_PLACE_IDS: FormPlaceIds = { birth: null, death: null, marriage: null };

interface PersonFormState {
    FirstName: string;
    LastName: string;
    Sex: string;
    BirthDate: string;
    BirthPlace: string;
    DeathDate: string;
    DeathPlace: string;
    DeathCause: string;
    IsDeceased: string; // '' = unknown, '0' = alive, '1' = deceased
}

const emptyForm: PersonFormState = {
    FirstName: '',
    LastName: '',
    Sex: '',
    BirthDate: '',
    BirthPlace: '',
    DeathDate: '',
    DeathPlace: '',
    DeathCause: '',
    IsDeceased: '',
};

interface NameVariant {
    Id: number;
    PersonId: number;
    Type: string;
    Name: string;
    FromDate: string | null;
    ToDate: string | null;
    IsPrimary?: number;
}

interface DuplicateMatch {
    Id: number;
    FirstName: string | null;
    LastName: string | null;
    BirthDate: string | null;
}

export interface FamilySearchResult {
    Id: number;
    Partner1Id?: number | null;
    Partner2Id?: number | null;
    MarriageDate: string | null;
    husbandName: string | null;
    wifeName: string | null;
    childCount: number;
}

interface CitationRow {
    Id: number;
    SourceId: number;
    sourceTitle?: string | null;
    Page?: string | null;
}

type CitationMap = Record<string, CitationRow[]>;

type AttachTarget = { factTable: string; factId: number; factLabel: string };

export type UsePersonFormProps =
    | { mode: 'new'; personId?: undefined; initialPerson?: undefined }
    | { mode: 'edit'; personId: number; initialPerson?: PersonWithRelations };

export interface UsePersonForm {
    // mode
    isNew: boolean;
    personId: number | null;

    // core fields
    form: PersonFormState;
    setField: <K extends keyof PersonFormState>(field: K, value: PersonFormState[K]) => void;

    /**
     * New mode only: a note typed before the person exists. There is no id for a
     * NoteLink to point at yet, so it is held here and written as a first-class
     * `Note` + `NoteLink('People')` immediately after the person is created
     * (#524 / ADR 0010). In edit mode NotesSection renders OwnerNotesCard, which
     * owns its own writes, and this stays empty.
     */
    noteDraft: string;
    setNoteDraft: (v: string) => void;

    // lifecycle / status
    loading: boolean;
    saving: boolean;
    deleting: boolean;
    error: string | null;
    successMessage: string | null;
    fieldErrors: { FirstName?: boolean; LastName?: boolean };

    // refs the view attaches
    firstNameRef: React.RefObject<HTMLInputElement | null>;

    // name variants
    variants: NameVariant[];
    newVariantType: string;
    newVariantName: string;
    setNewVariantType: (t: string) => void;
    setNewVariantName: (n: string) => void;
    addNameVariant: () => Promise<void>;
    removeNameVariant: (id: number) => Promise<void>;
    updateNameVariant: (id: number, name: string) => Promise<void>;
    setPrimaryVariant: (id: number | null) => Promise<void>;
    hasPrimaryVariant: boolean;
    /** New mode: add a name, or replace the one with `Id`, from the phone's name sheet.
     *  Marking it primary unmarks the others, as the star does. */
    stageVariant: (v: { Id?: number; Type: string; Name: string; IsPrimary: boolean }) => void;

    // citations-per-fact
    cite: (fact: FormFact, factLabel: string) => ReactNode;
    attachTarget: AttachTarget | null;
    setAttachTarget: (t: AttachTarget | null) => void;
    /** Mobile-only: set by cite-pin tap on narrow viewports to open CiteFactSheet first. */
    mobileSheetTarget: AttachTarget | null;
    setMobileSheetTarget: (t: AttachTarget | null) => void;
    citationMap: CitationMap;
    citationError: string | null;
    citationsLoading: boolean;
    citationsReady: boolean;
    pendingCitations: PendingCitation[];
    pushPendingCitation: (pc: PendingCitation) => void;
    refreshCitations: () => Promise<void>;
    /** Retry the initial person/variants read after a failed load. */
    retryLoad: () => void;

    // edit-mode relationships
    relations: PersonWithRelations | null;
    familiesAsSpouse: Family[];
    familiesAsChild: Family[];
    refreshRelations: () => Promise<void>;

    // new-mode suggestions + manual attach
    visibleSuggestions: FamilySuggestion[];
    toggleSuggestion: (idx: number) => void;
    selectedFamily: FamilySearchResult | null;
    setSelectedFamily: (f: FamilySearchResult | null) => void;
    selectedSpouse: PersonResult | null;
    setSelectedSpouse: (p: PersonResult | null) => void;
    attachAsChild: boolean;
    setAttachAsChild: (v: boolean) => void;
    attachAsPartner: boolean;
    setAttachAsPartner: (v: boolean) => void;
    childRelationshipType: ChildRelationshipType;
    setChildRelationshipType: (v: ChildRelationshipType) => void;
    /**
     * Desktop quick-add (#52, ADR 0027): this person's link to each parent of the
     * picked family. When set it wins over `childRelationshipType`, which sets both.
     */
    parentLinks: ChildRelationships | null;
    setParentLinks: (v: ChildRelationships | null) => void;
    marriageDate: string;
    marriagePlace: string;
    /** Phone form (#1065): people made in a picker are staged and created on Save.
     *  A new parent gets a family of their own that this person joins as a child. */
    newParent: NewPersonDraft | null;
    setNewParent: (d: NewPersonDraft | null) => void;
    /** A new partner, used in place of `selectedSpouse`. */
    newSpouse: NewPersonDraft | null;
    setNewSpouse: (d: NewPersonDraft | null) => void;
    /** Children who join the family made with the partner, or one with the other parent unknown. */
    children: PickedPerson[];
    setChildren: (c: PickedPerson[]) => void;
    setMarriageDate: (v: string) => void;
    setMarriagePlace: (v: string) => void;
    setBirthPlaceResolution: (levels: HierarchyLevel[] | null | undefined) => void;
    setDeathPlaceResolution: (levels: HierarchyLevel[] | null | undefined) => void;
    setMarriagePlaceResolution: (levels: HierarchyLevel[] | null | undefined) => void;
    birthPlaceInitialChain: PinChainRow[] | null;
    deathPlaceInitialChain: PinChainRow[] | null;
    /** The place each place field links to (#1186), sent with the save. */
    placeIds: FormPlaceIds;
    setPlaceId: (field: keyof FormPlaceIds, placeId: number | null) => void;
    familySearchQuery: string;
    setFamilySearchQuery: (v: string) => void;
    familySearchResults: FamilySearchResult[];
    potentialDuplicates: DuplicateMatch[];
    /** Something was typed or picked (new mode), or a saved field changed (edit mode). */
    isDirty: boolean;

    // submit / delete
    submit: (opts: { addAnother: boolean; clearDeath?: boolean }) => Promise<void>;
    /** Set while a Living or Unknown save waits for the user to confirm deleting the death details (#895). */
    clearDeathPending: { addAnother: boolean } | null;
    confirmClearDeath: () => void;
    cancelClearDeath: () => void;
    remove: () => Promise<void>;
    showDeleteConfirm: boolean;
    setShowDeleteConfirm: (v: boolean) => void;
    onNavigate: (event: { preventDefault: () => void }) => void;
    guardNavigation: () => boolean;
}

export function usePersonForm(props: UsePersonFormProps): UsePersonForm {
    const { mode } = props;
    const isNew = mode === 'new';
    const router = useRouter();
    const { activeTreeId } = useTree();
    const t = useTranslations('editPerson');

    const isMobile = useIsMobile();
    const { reportError, redirectIfUnauthorized } = useErrorToast();

    const [form, setForm] = useState<PersonFormState>(emptyForm);
    const [savedForm, setSavedForm] = useState<PersonFormState>(emptyForm);
    // New mode only — see the `noteDraft` doc on UsePersonForm.
    const [noteDraft, setNoteDraft] = useState('');
    const [loading, setLoading] = useState(!isNew);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const [fieldErrors, setFieldErrors] = useState<{ FirstName?: boolean; LastName?: boolean }>({});
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [deleting, setDeleting] = useState(false);

    // Name variants (both modes; in new mode they live in local state with temp ids
    // until the person is created, then they're persisted on save).
    const [variants, setVariants] = useState<NameVariant[]>([]);
    const [newVariantType, setNewVariantType] = useState('Nickname');
    const [newVariantName, setNewVariantName] = useState('');
    const tempVariantIdRef = useRef(-1);

    // Right rail relationships (edit mode)
    const [relations, setRelations] = useState<PersonWithRelations | null>(props.mode === 'edit' ? props.initialPerson ?? null : null);
    const [familiesAsSpouse, setFamiliesAsSpouse] = useState<Family[]>([]);
    const [familiesAsChild, setFamiliesAsChild] = useState<Family[]>([]);

    // Citations (edit mode) — grouped by `${factTable}:${factId}` so each fact
    // (name, birth, death, …) is cited independently.
    const citationScopeKey = isNew ? 'new' : `${activeTreeId ?? 'default'}:${props.personId}`;
    const citationScopeRef = useRef(citationScopeKey);
    citationScopeRef.current = citationScopeKey;
    const [citationMap, setCitationMap] = useState<CitationMap>({});
    const [citationDataKey, setCitationDataKey] = useState<string | null>(isNew ? citationScopeKey : null);
    const [citationError, setCitationError] = useState<string | null>(null);
    const [citationErrorKey, setCitationErrorKey] = useState<string | null>(null);
    const [citationsLoading, setCitationsLoading] = useState(!isNew);
    const [citationsLoaded, setCitationsLoaded] = useState(isNew);
    const citationRequest = useRef(0);
    const [attachTarget, setAttachTarget] = useState<AttachTarget | null>(null);
    // Mobile: cite-pin tap opens CiteFactSheet first; selecting a row then sets attachTarget.
    const [mobileSheetTarget, setMobileSheetTarget] = useState<AttachTarget | null>(null);

    // Pending citations queued before person is saved (new mode)
    const [pendingCitations, setPendingCitations] = useState<PendingCitation[]>([]);

    // Smart suggestions (new mode)
    const [suggestions, setSuggestions] = useState<FamilySuggestion[]>([]);

    // Experimental: citation pins in natural tab order vs. deferred to end
    const [citePinsInTabOrder, setCitePinsInTabOrder] = useState(false);
    useEffect(() => {
        setCitePinsInTabOrder(localStorage.getItem('citePinsInTabOrder') === 'true');
    }, []);

    // Family attach (new mode) — child + partner can be combined
    const [familySearchQuery, setFamilySearchQuery] = useState('');
    const [familySearchResults, setFamilySearchResults] = useState<FamilySearchResult[]>([]);
    const [selectedFamily, setSelectedFamily] = useState<FamilySearchResult | null>(null);
    const [attachAsChild, setAttachAsChild] = useState(false);
    const [attachAsPartner, setAttachAsPartner] = useState(false);
    const [childRelationshipType, setChildRelationshipType] = useState<ChildRelationshipType>('Birth');
    const [parentLinks, setParentLinks] = useState<ChildRelationships | null>(null);

    // Spouse attach (new mode)
    const [selectedSpouse, setSelectedSpouse] = useState<PersonResult | null>(null);
    const [marriageDate, setMarriageDate] = useState('');
    const [marriagePlace, setMarriagePlace] = useState('');

    // Staged people from the phone form's pickers (#1065)
    const [newParent, setNewParent] = useState<NewPersonDraft | null>(null);
    const [newSpouse, setNewSpouse] = useState<NewPersonDraft | null>(null);
    const [children, setChildren] = useState<PickedPerson[]>([]);

    // Pending place resolutions (design spec §6.1) — LocationField resolves in
    // the background and reports here; nothing is written to the Places
    // gazetteer until submit() succeeds. null = Remove Pin was clicked for that
    // field; undefined = no change since the field was last saved.
    const [birthPlaceResolution, setBirthPlaceResolution] = useState<HierarchyLevel[] | null | undefined>(undefined);
    const [deathPlaceResolution, setDeathPlaceResolution] = useState<HierarchyLevel[] | null | undefined>(undefined);
    const [marriagePlaceResolution, setMarriagePlaceResolution] = useState<HierarchyLevel[] | null | undefined>(undefined);

    // Read-only lookup for BirthPlace/DeathPlace's already-saved pin chain
    // (edit-mode pin display) — populated below, once, when an existing person
    // loads. marriagePlace is deliberately excluded: it belongs to this hook's
    // new-mode-only "attach a spouse" flow and never has a pre-existing value.
    const [placeChains, setPlaceChains] = useState<Record<string, PinChainRow[]>>({});
    // The place each field links to (#1186): the saved fact's, then the one picked.
    const [placeIds, setPlaceIds] = useState<FormPlaceIds>(NO_PLACE_IDS);
    const setPlaceId = useCallback((field: keyof FormPlaceIds, placeId: number | null) => {
        setPlaceIds((ids) => (ids[field] === placeId ? ids : { ...ids, [field]: placeId }));
    }, []);

    // Duplicate detection (new mode)
    const [potentialDuplicates, setPotentialDuplicates] = useState<DuplicateMatch[]>([]);
    const [loadToken, setLoadToken] = useState(0);

    const firstNameRef = useRef<HTMLInputElement>(null);
    const personId = !isNew ? props.personId : null;

    // Auto-focus FirstName when creating
    useEffect(() => {
        if (isNew && !loading) firstNameRef.current?.focus();
    }, [isNew, loading]);

    // Load existing person + variants + citations
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
                const client = await getDataClient();
                const [person, variantsList, loadedCitationMap] = await Promise.all([
                    client.people.get(personId!, activeTreeId),
                    client.people.listNameVariants(personId!, activeTreeId),
                    getDataClient().then(c => c.citations.listForPerson(personId!, activeTreeId)).catch((err) => {
                        redirectIfUnauthorized(err);
                        return null;
                    }),
                ]);
                if (cancelled || citationRequest.current !== citationRequestId || citationScopeRef.current !== citationScope) return;
                const loadedForm: PersonFormState = {
                    FirstName: person.FirstName || '',
                    LastName: person.LastName || '',
                    Sex: person.Sex || '',
                    BirthDate: person.BirthDate || '',
                    BirthPlace: person.BirthPlace || '',
                    DeathDate: person.DeathDate || '',
                    DeathPlace: person.DeathPlace || '',
                    DeathCause: person.DeathCause || '',
                    IsDeceased: person.IsDeceased === 1 ? '1' : person.IsDeceased === 0 ? '0' : '',
                };
                setRelations(person);
                setPlaceIds({ birth: person.BirthPlaceId ?? null, death: person.DeathPlaceId ?? null, marriage: null });
                setForm(loadedForm);
                setSavedForm(loadedForm);
                setFamiliesAsSpouse(person.familiesAsSpouse ?? []);
                setFamiliesAsChild(person.familiesAsChild ?? []);
                setVariants(variantsList.map(v => ({ ...v, IsPrimary: v.IsPrimary ? 1 : 0 })));
                if (loadedCitationMap) {
                    setCitationMap(loadedCitationMap);
                    setCitationDataKey(citationScope);
                    setCitationError(null);
                    setCitationErrorKey(null);
                } else {
                    setCitationError(t('failed_load'));
                    setCitationErrorKey(citationScope);
                }
                setCitationsLoaded(true);

                // Read-only lookup for BirthPlace/DeathPlace's already-saved pin chain
                // (edit-mode pin display) — keyed off the just-fetched server values, not the
                // live/editable form state, so it fires exactly once per person load and never
                // re-fires while the user types.
                // By the place each fact points at: two places may share a name (#1186).
                const placeKeys = uniquePlaceKeys([
                    factPlaceKey(person.BirthPlace, person.BirthPlaceId),
                    factPlaceKey(person.DeathPlace, person.DeathPlaceId),
                ]);
                if (placeKeys.length > 0) {
                    try {
                        const chains = await client.places.pinChains(placeKeys, activeTreeId);
                        if (!cancelled) setPlaceChains(chains);
                    } catch {
                        // Best-effort — a failed lookup just means no badge shows this session.
                    }
                }
            } catch (err) {
                if (redirectIfUnauthorized(err)) return;
                if (!cancelled) setError(t('failed_load'));
            } finally {
                if (citationRequest.current === citationRequestId && citationScopeRef.current === citationScope) {
                    setCitationsLoading(false);
                }
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [isNew, personId, activeTreeId, citationScopeKey, t, loadToken, redirectIfUnauthorized]);

    const retryLoad = useCallback(() => {
        setError(null);
        setCitationError(null);
        setCitationErrorKey(null);
        setCitationsLoaded(false);
        setCitationsLoading(true);
        setLoading(true);
        setLoadToken((token) => token + 1);
    }, []);

    useDocumentTitle(isNew ? t('add_heading') : `${form.FirstName ?? ''} ${form.LastName ?? ''}`.trim());

    // Debounced family search (new mode)
    useEffect(() => {
        if (!isNew || familySearchQuery.length < 2) {
            setFamilySearchResults([]);
            return;
        }
        const timer = setTimeout(async () => {
            try {
                const client = await getDataClient();
                const results = await client.families.search(familySearchQuery, activeTreeId);
                setFamilySearchResults(results);
            } catch {
                // ignore
            }
        }, 300);
        return () => clearTimeout(timer);
    }, [familySearchQuery, isNew, activeTreeId]);

    // Debounced duplicate detection (new mode)
    useEffect(() => {
        if (!isNew || (!form.FirstName.trim() && !form.LastName.trim())) {
            setPotentialDuplicates([]);
            return;
        }
        const timer = setTimeout(async () => {
            const q = `${form.FirstName} ${form.LastName}`.trim();
            if (q.length < 3) return;
            try {
                const client = await getDataClient();
                const people = await client.people.search(q, activeTreeId);
                const matches = people.filter((p: DuplicateMatch) =>
                    p.FirstName?.toLowerCase() === form.FirstName.toLowerCase() &&
                    p.LastName?.toLowerCase() === form.LastName.toLowerCase()
                );
                setPotentialDuplicates(matches);
            } catch {
                // ignore
            }
        }, 500);
        return () => clearTimeout(timer);
    }, [form.FirstName, form.LastName, isNew, activeTreeId]);

    // Debounced smart suggestion fetch (new mode)
    useEffect(() => {
        if (!isNew || !form.LastName.trim() || sortableYear(form.BirthDate) === null) {
            setSuggestions([]);
            return;
        }
        const timer = setTimeout(async () => {
            try {
                const client = await getDataClient();
                const suggestions = await client.people.suggestFamily({
                    lastName: form.LastName,
                    birthDate: form.BirthDate,
                    sex: form.Sex || undefined,
                    birthPlace: form.BirthPlace || undefined,
                    treeId: activeTreeId,
                });
                setSuggestions(suggestions);
            } catch {
                // ignore
            }
        }, 500);
        return () => clearTimeout(timer);
    }, [form.LastName, form.BirthDate, form.Sex, form.BirthPlace, isNew, activeTreeId]);

    function setField<K extends keyof PersonFormState>(field: K, value: PersonFormState[K]) {
        setForm((prev) => {
            const next = { ...prev, [field]: value };
            // Any death detail marks the person deceased, as in the hero editor, so a
            // Living or Unknown save only asks after an explicit status change (#895).
            if ((field === 'DeathDate' || field === 'DeathPlace' || field === 'DeathCause') && typeof value === 'string' && value.trim()) next.IsDeceased = '1';
            return next;
        });
        if (field === 'FirstName' || field === 'LastName') {
            setFieldErrors((prev) => ({ ...prev, [field]: false }));
        }
    }

    // Post-save flush for the pending LocationField resolutions — shared with the
    // family form and the tree sidebar (#461), which each held their own copy.
    const flushPlaceResolution = usePlaceResolutionFlush(activeTreeId);

    const [clearDeathPending, setClearDeathPending] = useState<{ addAnother: boolean } | null>(null);

    const submit = useCallback(async (opts: { addAnother: boolean; clearDeath?: boolean }) => {
        const nextDeceased = form.IsDeceased === '1' ? 1 : form.IsDeceased === '0' ? 0 : null;
        // An edit asks only when the status changed: an imported death with no
        // flag still reads as deceased and is left alone by unrelated edits.
        if (!opts.clearDeath && (isNew || form.IsDeceased !== savedForm.IsDeceased) && statusDropsDeath(nextDeceased, form)) {
            setClearDeathPending({ addAnother: opts.addAnother });
            return;
        }
        setClearDeathPending(null);
        setSaving(true);
        setError(null);
        setSuccessMessage(null);
        const wantsAnother = opts.addAnother;

        if (!form.FirstName.trim() && !form.LastName.trim()) {
            setFieldErrors({ FirstName: true, LastName: true });
            setError(t('err_name_required'));
            setSaving(false);
            return;
        }
        setFieldErrors({});

        try {
            const client = await getDataClient();
            const personPayload = {
                FirstName: form.FirstName || null,
                LastName: form.LastName || null,
                Sex: form.Sex || null,
                BirthDate: form.BirthDate || null,
                BirthPlace: form.BirthPlace || null,
                BirthPlaceId: form.BirthPlace ? placeIds.birth : null,
                DeathDate: form.DeathDate || null,
                DeathPlace: form.DeathPlace || null,
                DeathPlaceId: form.DeathPlace ? placeIds.death : null,
                DeathCause: form.DeathCause || null,
                IsDeceased: nextDeceased,
                ...(opts.clearDeath ? DEATH_DETAILS_CLEARED : {}),
            };
            const savedPerson = isNew
                ? await client.people.create(personPayload, { treeId: activeTreeId })
                : await client.people.update(personId!, personPayload, activeTreeId);
            const newPersonId = savedPerson.Id;

            await Promise.all([
                flushPlaceResolution(form.BirthPlace, birthPlaceResolution, savedPerson.BirthPlaceId),
                opts.clearDeath ? undefined : flushPlaceResolution(form.DeathPlace, deathPlaceResolution, savedPerson.DeathPlaceId),
            ]);

            // Collect failures from sub-steps so we can surface them as a single
            // "partial save" warning instead of silently dropping data.
            const subFailures: string[] = [];

            // New mode: the note was typed before the person had an id, so there was
            // nothing for a NoteLink to point at. Now there is — write it as a
            // first-class Note, the same shape OwnerNotesCard writes in edit mode
            // (#524 / ADR 0010). This replaced the last People."Notes" column writer.
            if (isNew && noteDraft.trim()) {
                try {
                    await client.notes.create('People', newPersonId, noteDraft.trim(), activeTreeId);
                } catch {
                    subFailures.push(t('partial_save_note'));
                }
            }

            // New mode: variants were collected locally (no personId yet). Persist them
            // now, then mark the chosen primary on its newly-created row.
            if (isNew && variants.length > 0) {
                const primaryLocal = variants.find((v) => v.IsPrimary);
                for (const v of variants) {
                    try {
                        const created = await client.people.createNameVariant(
                            newPersonId,
                            { Type: v.Type, Name: v.Name },
                            activeTreeId,
                        );
                        const wantPrimary = !!primaryLocal && v.Id === primaryLocal.Id;
                        // The server makes a first nickname the shown name (#436). The
                        // form already showed that, so when the star was moved off it
                        // (back to the first name, or to another name), save what the
                        // form showed (#1232).
                        if (wantPrimary !== !!created.IsPrimary) {
                            try {
                                await client.people.setPrimaryNameVariant(newPersonId, created.Id, wantPrimary, activeTreeId);
                            } catch {
                                subFailures.push(t('partial_save_primary', { name: v.Name }));
                            }
                        }
                    } catch {
                        subFailures.push(t('partial_save_variant', { name: v.Name }));
                    }
                }
            }

            // Flush pending citations now that we have a real personId
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
                            await client.citations.create({ FactTable: (pc.factTable ?? FACT_TABLES.PEOPLE) as FactTableValue, FactId: newPersonId, SourceId: sourceId, Page: pc.page, Quay: pc.quay ?? null, DataText: pc.dataText ?? null, Url: pc.url ?? null }, activeTreeId);
                        } catch {
                            subFailures.push(t('partial_save_citation'));
                        }
                    }
                }
            }

            // A staged person from a picker, created now with the details its short form held.
            const createStaged = async (d: NewPersonDraft) => (await client.people.create({
                FirstName: d.firstName || null, LastName: d.lastName || null, Sex: d.sex, BirthDate: d.birthDate,
            }, { treeId: activeTreeId })).Id;
            const draftName = (d: NewPersonDraft) => [d.firstName, d.lastName].filter(Boolean).join(' ') || t('person_fallback');

            // Handle family linkage on new — child + partner can both fire
            if (isNew && newParent) {
                try {
                    const parentId = await createStaged(newParent);
                    const family = await client.families.create({ Partner1Id: parentId, Partner2Id: null }, activeTreeId);
                    await client.families.addChild(family.Id, newPersonId, parentLinks?.partner1 ?? childRelationshipType, activeTreeId);
                } catch {
                    subFailures.push(t('partial_save_family_child'));
                }
            } else if (isNew && attachAsChild && selectedFamily) {
                try {
                    const client = await getDataClient();
                    await client.families.addChild(selectedFamily.Id, newPersonId, parentLinks ?? childRelationshipType, activeTreeId);
                } catch {
                    subFailures.push(t('partial_save_family_child'));
                }
            }
            // The family the partner and this person share; children join it.
            let partnerFamilyId: number | null = null;
            const partnerWanted = isNew && attachAsPartner && (newSpouse != null || selectedSpouse != null);
            if (partnerWanted) {
                try {
                    const spouseId = newSpouse ? await createStaged(newSpouse) : selectedSpouse!.Id;
                    const family = await client.families.create({
                        Partner1Id: newPersonId,
                        Partner2Id: spouseId,
                        MarriageDate: marriageDate || null,
                        MarriagePlace: marriagePlace || null,
                        MarriagePlaceId: marriagePlace ? placeIds.marriage : null,
                    }, activeTreeId);
                    partnerFamilyId = family.Id;
                    await flushPlaceResolution(marriagePlace, marriagePlaceResolution, family.MarriagePlaceId);
                } catch {
                    subFailures.push(t('partial_save_family_partner'));
                }
            }
            // Without a partner the children's other parent is unknown: a family with
            // one partner. With one that failed to save, they wait rather than land there.
            if (isNew && children.length > 0) {
                let familyId = partnerFamilyId;
                if (familyId == null && !partnerWanted) {
                    try {
                        familyId = (await client.families.create({ Partner1Id: newPersonId, Partner2Id: null }, activeTreeId)).Id;
                    } catch {
                        // Reported per child below.
                    }
                }
                for (const c of children) {
                    const name = c.kind === 'existing' ? displayFullName(c.person) || t('person_fallback') : draftName(c.draft);
                    if (familyId == null) { subFailures.push(t('partial_save_child', { name })); continue; }
                    try {
                        const childId = c.kind === 'existing' ? c.person.Id : await createStaged(c.draft);
                        await client.families.addChild(familyId, childId, 'Birth', activeTreeId);
                    } catch {
                        subFailures.push(t('partial_save_child', { name }));
                    }
                }
            }

            // If any sub-steps failed, surface them and stay on the form so the user
            // can re-try / inspect rather than silently navigating away.
            if (subFailures.length > 0) {
                setError(t('partial_save_failed', { details: subFailures.join('; ') }));
                setSaving(false);
                return;
            }

            if (wantsAnother && isNew) {
                const name = [form.FirstName, form.LastName].filter(Boolean).join(' ') || t('person_fallback');
                setForm(emptyForm);
                // Already written against the person just created — leaving it set
                // would re-file the same note on every later person (#474's shape).
                setNoteDraft('');
                setSelectedFamily(null);
                setFamilySearchQuery('');
                setFamilySearchResults([]);
                setSelectedSpouse(null);
                setMarriageDate('');
                setMarriagePlace('');
                setNewParent(null);
                setNewSpouse(null);
                setChildren([]);
                setBirthPlaceResolution(undefined);
                setDeathPlaceResolution(undefined);
                setMarriagePlaceResolution(undefined);
                setPlaceIds(NO_PLACE_IDS);
                setAttachAsChild(false);
                setAttachAsPartner(false);
                setChildRelationshipType('Birth');
                setParentLinks(null);
                setPendingCitations([]);
                setSuggestions([]);
                // Name variants are collected locally in new mode and replayed
                // against the created person's id on save. Leaving them set would
                // write the previous person's nicknames to every later person
                // (#474) — including re-applying IsPrimary, which per ADR-0001
                // changes their displayed name.
                setVariants([]);
                setNewVariantName('');
                setNewVariantType('Nickname');
                setSuccessMessage(t('created', { name }));
                setTimeout(() => setSuccessMessage(null), 3000);
                setSaving(false);
                requestAnimationFrame(() => {
                    scrollToTop(true);
                    firstNameRef.current?.focus();
                });
            } else {
                if (!isNew) setSavedForm(form);
                router.push(`/people/view?id=${newPersonId}`);
            }
        } catch (err) {
            if (redirectIfUnauthorized(err)) {
                setSaving(false);
                return;
            }
            setError(t('failed_save'));
            setSaving(false);
        }
    }, [
        form, savedForm, placeIds, noteDraft, isNew, personId, activeTreeId, variants, pendingCitations,
        attachAsChild, selectedFamily, childRelationshipType, parentLinks,
        attachAsPartner, selectedSpouse, marriageDate, marriagePlace,
        newParent, newSpouse, children,
        birthPlaceResolution, deathPlaceResolution, marriagePlaceResolution,
        flushPlaceResolution, router, t, redirectIfUnauthorized,
    ]);

    const remove = useCallback(async () => {
        if (isNew) return;
        setDeleting(true);
        try {
            const client = await getDataClient();
            await client.people.remove(personId!, activeTreeId);
            router.push('/people');
        } catch (err) {
            if (redirectIfUnauthorized(err)) return;
            setError(t('failed_delete'));
            setDeleting(false);
            setShowDeleteConfirm(false);
        }
    }, [isNew, personId, activeTreeId, router, t, redirectIfUnauthorized]);

    // Filtered suggestions (child + spouse only, sibling excluded from UI)
    const visibleSuggestions = useMemo(
        () => suggestions.filter(s => s.role === 'child' || s.role === 'spouse'),
        [suggestions],
    );

    // Stable ref so the keydown handler can toggle suggestions without re-registering
    const toggleSuggestionRef = useRef<(idx: number) => void>(() => {});
    toggleSuggestionRef.current = (idx: number) => {
        const s = visibleSuggestions[idx];
        if (!s) return;
        if (s.role === 'child') {
            const isActive = attachAsChild && selectedFamily?.Id === s.familyId;
            if (isActive) {
                setSelectedFamily(null);
                setAttachAsChild(false);
            } else {
                setSelectedFamily({ Id: s.familyId!, Partner1Id: null, Partner2Id: null, MarriageDate: s.marriageDate, husbandName: s.husbandName, wifeName: s.wifeName, childCount: s.childCount ?? 0 });
                setAttachAsChild(true);
            }
        } else {
            const isActive = attachAsPartner && selectedSpouse?.Id === s.personId;
            if (isActive) {
                setSelectedSpouse(null);
                setAttachAsPartner(false);
                setMarriageDate('');
                setMarriagePlace('');
            } else {
                setSelectedSpouse({ Id: s.personId!, FirstName: s.personFirstName, LastName: s.personLastName, EffectiveFirstName: s.personEffectiveFirstName, Nickname: s.personNickname, Sex: null, BirthDate: s.personBirthDate, DeathDate: null });
                setAttachAsPartner(true);
            }
        }
    };
    const toggleSuggestion = useCallback((idx: number) => toggleSuggestionRef.current(idx), []);

    // Keep a stable ref to the latest submit so the global keydown handler can
    // call it without re-registering the listener on every render.
    const submitRef = useRef(submit);
    submitRef.current = submit;

    // Ctrl+S = Save · Ctrl+Enter = Save & add another · Alt+1/2/3 = toggle suggestions
    useEffect(() => {
        function handleKeyDown(e: KeyboardEvent) {
            const meta = e.ctrlKey || e.metaKey;
            // Matched on `e.code`, not `e.key` (#478). `e.key` is what the layout
            // PRODUCES with the modifiers applied, so Alt+1 reports '1' only on
            // layouts where Alt is inert over the digit row; elsewhere it arrives as
            // a composed character or 'Dead' and the shortcut silently no-ops until
            // a second press. `e.code` names the physical key and is layout- and
            // modifier-independent. Numpad digits count too — the label says "Alt+1",
            // not "Alt+1 on the top row".
            const digit = /^(Digit|Numpad)([123])$/.exec(e.code)?.[2];
            if (e.altKey && isNew && digit) {
                e.preventDefault();
                toggleSuggestionRef.current(parseInt(digit, 10) - 1);
            } else if (meta && e.key === 'Enter' && isNew) {
                e.preventDefault();
                submitRef.current({ addAnother: true });
            } else if (meta && e.key.toLowerCase() === 's') {
                e.preventDefault();
                submitRef.current({ addAnother: false });
            }
            // Esc intentionally does NOT cancel the form — too easy to lose edits.
        }
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isNew]);

    // Citation pins: each fact (name, birth, death) is cited independently. A pin
    // is filled when its specific fact has a citation (or a pending one in new mode).
    const citeTabIndex = citePinsInTabOrder ? 0 : 500;
    const currentCitationMap = useMemo(
        () => citationDataKey === citationScopeKey ? citationMap : {},
        [citationDataKey, citationScopeKey, citationMap],
    );
    const currentCitationError = citationErrorKey === citationScopeKey ? citationError : null;
    const citationsReady = isNew || (
        citationDataKey === citationScopeKey
        && citationsLoaded
        && !citationsLoading
        && currentCitationError == null
    );
    // Citation pins: each fact (name, birth, death) is cited independently. On mobile
    // a pin tap opens CiteFactSheet (launcher) first; on desktop it opens AttachSourceSidebar.
    // Footnote numbers in form order: name, birth, death (#754).
    const sourceNumbers = useMemo(() => personId ? numberSources(
        Object.values(FORM_FACT_TABLES)
            .map(table => ({ citations: currentCitationMap[`${table}:${personId}`] ?? [] })),
    ) : new Map<number, number>(), [personId, currentCitationMap]);
    const cite = useCallback((fact: FormFact, factLabel: string): ReactNode => {
        const factTable = FORM_FACT_TABLES[fact];
        const openCite = (factId: number) =>
            isMobile
                ? setMobileSheetTarget({ factTable, factId, factLabel })
                : setAttachTarget({ factTable, factId, factLabel });
        if (isNew) {
            const pendingForFact = pendingCitations.filter(p => p.factTable === factTable);
            if (pendingForFact.length > 0) {
                return createElement(Cite, { pending: true, onClick: () => openCite(-1), tabIndex: citeTabIndex });
            }
            return createElement(Cite, { empty: true, factLabel, onClick: () => openCite(-1), tabIndex: citeTabIndex });
        }
        if (!personId) return createElement(Cite, { empty: true, factLabel, tabIndex: citeTabIndex });
        const cites = currentCitationMap[`${factTable}:${personId}`] ?? [];
        if (cites.length === 0) {
            return createElement(Cite, { empty: true, factLabel, onClick: citationsReady ? () => openCite(personId) : undefined, tabIndex: citeTabIndex });
        }
        // Stack one pin per source so multiple sources on a fact are all visible,
        // matching the person/family detail pages.
        return createElement(Fragment, null, chipCitations(cites, sourceNumbers).map(c =>
            createElement(Cite, { key: c.Id, n: sourceNumbers.get(c.SourceId), sourceTitle: c.sourceTitle ?? undefined, onClick: citationsReady ? () => openCite(personId) : undefined, tabIndex: citeTabIndex })
        ));
    }, [isNew, personId, currentCitationMap, pendingCitations, citeTabIndex, isMobile, citationsReady, sourceNumbers]);

    async function addNameVariant() {
        const name = newVariantName.trim();
        if (!name) return;
        if (personId) {
            try {
                const client = await getDataClient();
                const created = await client.people.createNameVariant(personId, { Type: newVariantType, Name: name }, activeTreeId);
                setVariants((prev) => [...prev, { ...created, IsPrimary: created.IsPrimary ? 1 : 0 }]);
                setNewVariantName('');
            } catch (e) {
                reportError(e);
            }
        } else {
            // New mode: hold in local state until the person is created on save.
            // Mirror the server's first-nickname promotion (#436) so the star lights
            // up here too — otherwise the rule would appear to apply only after save.
            const tempId = tempVariantIdRef.current--;
            setVariants((prev) => {
                const promote = newVariantType === 'Nickname' && !prev.some((v) => v.IsPrimary);
                return [...prev, { Id: tempId, PersonId: 0, Type: newVariantType, Name: name, FromDate: null, ToDate: null, IsPrimary: promote ? 1 : 0 }];
            });
            setNewVariantName('');
        }
    }

    async function removeNameVariant(id: number) {
        if (personId && id > 0) {
            try {
                const client = await getDataClient();
                await client.people.removeNameVariant(personId, id, activeTreeId);
            } catch (e) {
                reportError(e);
                return; // don't remove from local state if server remove failed
            }
        }
        setVariants((prev) => prev.filter((v) => v.Id !== id));
    }

    /** Edit a variant's text. Optimistic in edit mode (revert on failure); local-only for unsaved temp variants. */
    async function updateNameVariant(id: number, name: string) {
        const trimmed = name.trim();
        if (!trimmed) return;
        if (personId && id > 0) {
            const previousVariants = variants;
            setVariants((prev) => prev.map((v) => (v.Id === id ? { ...v, Name: trimmed } : v)));
            try {
                const client = await getDataClient();
                await client.people.updateNameVariant(personId, id, trimmed, activeTreeId);
            } catch (e) {
                setVariants(previousVariants);
                reportError(e);
            }
            return;
        }
        setVariants((prev) => prev.map((v) => (v.Id === id ? { ...v, Name: trimmed } : v)));
    }

    /** Re-fetch the person's resolved relationships after an add/remove edit. */
    const refreshRelations = useCallback(async () => {
        if (!personId) return;
        try {
            const client = await getDataClient();
            const person = await client.people.get(personId, activeTreeId);
            setRelations(person);
            setFamiliesAsSpouse(person.familiesAsSpouse ?? []);
            setFamiliesAsChild(person.familiesAsChild ?? []);
        } catch (e) {
            reportError(e);
        }
    }, [personId, activeTreeId, reportError]);

    /** Re-fetch the person's citations after attaching a source (edit mode). */
    const refreshCitations = useCallback(async () => {
        if (isNew || !personId) return;
        const citationScope = citationScopeKey;
        const request = ++citationRequest.current;
        setCitationsLoading(true);
        setCitationError(null);
        try {
            const client = await getDataClient();
            const map = await client.citations.listForPerson(personId, activeTreeId);
            if (citationRequest.current !== request || citationScopeRef.current !== citationScope) return;
            setCitationMap(map ?? {});
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
            // Keep the previous map visible, but make the failed revalidation
            // explicit so the form never treats stale evidence as a successful
            // empty read.
            setCitationsLoaded(true);
            setCitationError(t('failed_load'));
            setCitationErrorKey(citationScope);
        } finally {
            if (citationRequest.current === request && citationScopeRef.current === citationScope) setCitationsLoading(false);
        }
    }, [isNew, personId, activeTreeId, citationScopeKey, redirectIfUnauthorized, t]);

    /** Make a variant the primary name, or pass null to make the default FirstName primary. */
    async function setPrimaryVariant(id: number | null) {
        if (personId) {
            const previousVariants = variants;
            // Optimistic update — revert below on server failure so the UI never
            // shows a primary the server didn't accept.
            setVariants((prev) => prev.map((v) => ({ ...v, IsPrimary: v.Id === id ? 1 : 0 })));
            try {
                const client = await getDataClient();
                if (id == null) {
                    const current = previousVariants.find((v) => v.IsPrimary);
                    if (current) {
                        await client.people.setPrimaryNameVariant(personId, current.Id, false, activeTreeId);
                    }
                } else {
                    await client.people.setPrimaryNameVariant(personId, id, true, activeTreeId);
                }
            } catch (e) {
                setVariants(previousVariants);
                if (redirectIfUnauthorized(e)) return;
                setError(t('partial_save_primary', { name: previousVariants.find(v => v.Id === id)?.Name ?? '?' }));
            }
            return;
        }
        setVariants((prev) => prev.map((v) => ({ ...v, IsPrimary: v.Id === id ? 1 : 0 })));
    }

    function stageVariant(v: { Id?: number; Type: string; Name: string; IsPrimary: boolean }) {
        const name = v.Name.trim();
        if (!name) return;
        const id = v.Id ?? tempVariantIdRef.current--;
        setVariants((prev) => {
            const next = prev.some((x) => x.Id === id)
                ? prev.map((x) => (x.Id === id ? { ...x, Type: v.Type, Name: name } : x))
                : [...prev, { Id: id, PersonId: 0, Type: v.Type, Name: name, FromDate: null, ToDate: null, IsPrimary: 0 }];
            return next.map((x) => ({ ...x, IsPrimary: x.Id === id ? (v.IsPrimary ? 1 : 0) : v.IsPrimary ? 0 : x.IsPrimary }));
        });
    }

    const pushPendingCitation = useCallback((pc: PendingCitation) => {
        setPendingCitations((prev) => [...prev, pc]);
    }, []);

    const hasPrimaryVariant = variants.some((v) => v.IsPrimary);
    // New-person forms hold several values that are not represented by `form`
    // alone: notes, name variants, citations, relationship choices, and pending
    // place resolutions. Include all of them so navigation cannot silently lose
    // staged work. Edit mode tracks the persisted scalar snapshot separately.
    const draftFingerprint = JSON.stringify({
        form, noteDraft, variants, newVariantType, newVariantName, pendingCitations,
        selectedFamily, attachAsChild, attachAsPartner, childRelationshipType, parentLinks,
        selectedSpouse, marriageDate, marriagePlace, newParent, newSpouse, children,
        birthPlaceResolution, deathPlaceResolution, marriagePlaceResolution,
    });
    const emptyDraftFingerprint = JSON.stringify({
        form: emptyForm, noteDraft: '', variants: [], newVariantType: 'Nickname', newVariantName: '',
        pendingCitations: [], selectedFamily: null, attachAsChild: false, attachAsPartner: false,
        childRelationshipType: 'Birth', parentLinks: null, selectedSpouse: null, marriageDate: '', marriagePlace: '',
        newParent: null, newSpouse: null, children: [],
        birthPlaceResolution: undefined, deathPlaceResolution: undefined, marriagePlaceResolution: undefined,
    });
    const isDirty = isNew
        ? draftFingerprint !== emptyDraftFingerprint
        : JSON.stringify(form) !== JSON.stringify(savedForm);
    const { onNavigate, guardNavigation } = useUnsavedChangesGuard(isDirty);

    return {
        isNew,
        personId,
        form,
        setField,
        noteDraft,
        setNoteDraft,
        loading,
        saving,
        deleting,
        error,
        successMessage,
        fieldErrors,
        firstNameRef,
        variants,
        newVariantType,
        newVariantName,
        setNewVariantType,
        setNewVariantName,
        addNameVariant,
        removeNameVariant,
        updateNameVariant,
        setPrimaryVariant,
        hasPrimaryVariant,
        stageVariant,
        cite,
        attachTarget,
        setAttachTarget,
        mobileSheetTarget,
        setMobileSheetTarget,
        citationMap: currentCitationMap,
        citationError: currentCitationError,
        citationsLoading,
        citationsReady,
        pendingCitations,
        pushPendingCitation,
        refreshCitations,
        retryLoad,
        relations,
        familiesAsSpouse,
        familiesAsChild,
        refreshRelations,
        visibleSuggestions,
        toggleSuggestion,
        selectedFamily,
        setSelectedFamily,
        selectedSpouse,
        setSelectedSpouse,
        attachAsChild,
        setAttachAsChild,
        attachAsPartner,
        setAttachAsPartner,
        childRelationshipType,
        setChildRelationshipType,
        parentLinks,
        setParentLinks,
        marriageDate,
        marriagePlace,
        setMarriageDate,
        setMarriagePlace,
        newParent,
        setNewParent,
        newSpouse,
        setNewSpouse,
        children,
        setChildren,
        setBirthPlaceResolution,
        setDeathPlaceResolution,
        setMarriagePlaceResolution,
        birthPlaceInitialChain: factPlaceEntry(placeChains, form.BirthPlace, placeIds.birth) ?? null,
        deathPlaceInitialChain: factPlaceEntry(placeChains, form.DeathPlace, placeIds.death) ?? null,
        placeIds,
        setPlaceId,
        familySearchQuery,
        setFamilySearchQuery,
        familySearchResults,
        potentialDuplicates,
        isDirty,
        submit,
        clearDeathPending,
        confirmClearDeath: () => { if (clearDeathPending) void submit({ ...clearDeathPending, clearDeath: true }); },
        cancelClearDeath: () => {
            setClearDeathPending(null);
            // Back to the form with the status as it was; a new person with death details is deceased.
            setForm((f) => ({ ...f, IsDeceased: isNew ? '1' : savedForm.IsDeceased }));
        },
        remove,
        showDeleteConfirm,
        setShowDeleteConfirm,
        onNavigate,
        guardNavigation,
    };
}
