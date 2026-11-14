'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams, useRouter } from 'next/navigation';
import { useTree } from '@/app/contexts/TreeContext';
import type { CaseCitation, CaseComment, CaseWithRelations, Media, PersonResult } from '@/lib/db/schema';
import type { CitationPreviewTarget } from '@/app/components/citations/types';
import { FACT_TABLES } from '@/lib/db/fact-tables';
import { caseCitationAsCitation } from './case-detail-helpers';
import type { MediaPickerSource } from '@/app/components/media/add-media/library';
import { getDataClient } from '@/lib/data';
import { errorToastKey } from '@/lib/utils/data-error';
import { useErrorToast } from '@/app/components/useErrorToast';
import { NotFoundError } from '@/lib/data/errors';
import { toPersonResults } from './case-detail-helpers';
import type { PendingCitation } from '@/app/components/AttachSourceSidebar';
import { attachPendingCommentCitation } from './commentCitation';
import { useDocumentTitle } from '@/app/hooks/useDocumentTitle';
import { showChangeToast } from '@/app/components/ui';

/**
 * Owns all state + data access for the case-detail surface. Extracted verbatim
 * from CaseDetailView during the logic-first decomposition — behaviour is
 * unchanged. Presentational sections consume the returned object.
 */
/** A journal note's first line, as the title of the source its photo becomes (#58). */
function noteTitle(body: string): string {
    const line = body.trim().split('\n')[0].trim();
    return line.length > 120 ? `${line.slice(0, 119).trimEnd()}…` : line;
}

export function useCaseDetail(options?: { forceDraft?: boolean }) {
    const params = useSearchParams();
    const router = useRouter();
    const paramId = params.get('id') ?? '';
    // Once a draft is created we transition to the live case IN PLACE — no route
    // change, no remount — by overriding id + isDraft locally (createdId). The URL
    // is synced via history.replaceState in createDraftCase. This is what keeps
    // CaseDetailView mounted so its loading gate never re-enters (no flash).
    const [createdId, setCreatedId] = useState<string | null>(null);
    const id = createdId ?? paramId;
    // Draft (new-case) mode: the dedicated /cases/new route (forceDraft) or the
    // legacy /cases/view?id=new entry point — until createdId flips it live.
    const startedAsDraft = (options?.forceDraft ?? false) || paramId === 'new';
    const isDraft = createdId ? false : startedAsDraft;
    // A new case keeps its title and description editable after the autosave
    // creates it (#912), until focus leaves the header: creating it mid-typing
    // must not take the fields away. Later edits autosave through patchCase.
    const [composing, setComposing] = useState(startedAsDraft);
    const composingRef = useRef(composing);
    useEffect(() => { composingRef.current = composing; });
    const { activeTreeId, activePermission, currentUserId } = useTree();
    const t = useTranslations('cases');
    const tCommon = useTranslations('common');
    const { redirectIfUnauthorized } = useErrorToast();

    const [caseData, setCaseData] = useState<CaseWithRelations | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [fetchError, setFetchError] = useState<string | null>(null);
    // A missing case renders RecordNotFound; it never falls back to the list (#697).
    const [notFound, setNotFound] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [deleteError, setDeleteError] = useState<string | null>(null);

    // Edit state
    const [titleValue, setTitleValue] = useState('');
    const [descValue, setDescValue] = useState('');
    const [statusValue, setStatusValue] = useState('in_progress');
    const [tagInput, setTagInput] = useState('');

    // People picker (PersonPicker value state, kept in sync with caseData)
    const [casePeople, setCasePeople] = useState<PersonResult[]>([]);

    // Citations — attach a library Source via the shared sidebar
    const [showAttachSource, setShowAttachSource] = useState(false);
    // A case or journal-entry citation opens the same preview fact chips use, and
    // its Edit citation reopens the sidebar on that citation (#918).
    const [citationPreview, setCitationPreview] = useState<CitationPreviewTarget | null>(null);
    const [editCitation, setEditCitation] = useState<{ factTable: typeof FACT_TABLES.CASES | typeof FACT_TABLES.CASE_COMMENTS; factId: number; citationId: number } | null>(null);
    const [confirmRemoveCitation, setConfirmRemoveCitation] = useState<CaseCitation | null>(null);

    // Comment form
    const [commentBody, setCommentBody] = useState('');
    const [postingComment, setPostingComment] = useState(false);
    // A source queued in the composer, attached to the entry (not the case) on post.
    const [pendingCommentCite, setPendingCommentCite] = useState<PendingCitation | null>(null);
    const [showComposerCite, setShowComposerCite] = useState(false);

    // Journal image attachment
    const [journalFile, setJournalFile] = useState<File | null>(null);
    const [journalFilePreview, setJournalFilePreview] = useState<string | null>(null);
    // Or media the tree already holds (#34): the case's own, or a linked person's,
    // attached by id with no upload. Picking one replaces a chosen file, and back.
    const [journalMedia, setJournalMediaState] = useState<Media | null>(null);
    const setJournalMedia = useCallback((m: Media | null) => {
        setJournalMediaState(m);
        if (m) { setJournalFile(null); setJournalFilePreview(null); }
    }, []);

    // Add media (#1204): upload and the case's people's library in one modal
    const [showUploadModal, setShowUploadModal] = useState(false);

    // Lightbox — index into caseData.media; opens the shared MediaLightbox.
    const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

    // Delete confirm
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [deleting, setDeleting] = useState(false);

    // Mobile Journal/Evidence tab — lifted here so the guided start (in the
    // Journal tab) can switch to Evidence before focusing a rail affordance.
    const [mobileTab, setMobileTab] = useState<'journal' | 'evidence'>('journal');

    // New-case autosave (draft mode): 'idle' → 'saving' → 'saved'.
    const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
    const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const createGuard = useRef(false);
    const fetchGeneration = useRef(0);

    const canEdit = activePermission !== 'view' && statusValue !== 'closed';
    const canDelete = (activePermission === 'owner' || activePermission === 'edit') && statusValue !== 'closed';
    // A case is "ready" for writes once it exists (has a real id). Draft shells
    // render the full surface but keep write affordances inert until this flips.
    const caseReady = !!caseData && caseData.Id > 0;

    const fetchCase = useCallback(async () => {
        const generation = ++fetchGeneration.current;
        if (isDraft) {
            setCaseData({
                Id: 0, UserId: 0, Title: '', Description: null,
                Status: 'in_progress', Tags: [],
                CreatedAt: new Date().toISOString(), UpdatedAt: new Date().toISOString(),
                people: [], media: [], citations: [], comments: [],
            });
            setTitleValue('');
            setDescValue('');
            setStatusValue('in_progress');
            setFetchError(null);
            setLoading(false);
            return;
        }
        if (currentUserId === null) return;
        try {
            const client = await getDataClient();
            const c = await client.cases.get(Number(id), activeTreeId);
            if (fetchGeneration.current !== generation) return;
            setCaseData(c);
            setFetchError(null);
            setNotFound(false);
            setCasePeople(toPersonResults(c.people));
            // While composing, the fields are the user's: a refetch after an
            // autosave must not overwrite what they typed since.
            if (!composingRef.current) {
                setTitleValue(c.Title);
                setDescValue(c.Description ?? '');
            }
            setStatusValue(c.Status);
        } catch (err) {
            if (fetchGeneration.current !== generation) return;
            if (redirectIfUnauthorized(err)) return;
            if (err instanceof NotFoundError) { setNotFound(true); return; }
            console.error('Failed to fetch case:', err);
            const key = errorToastKey(err);
            setFetchError(key === 'error_generic' ? t('failed_load_case') : tCommon(key));
        } finally {
            if (fetchGeneration.current === generation) setLoading(false);
        }
    }, [id, isDraft, activeTreeId, currentUserId, redirectIfUnauthorized, t, tCommon]);

    useEffect(() => {
        fetchCase();
    }, [fetchCase]);

    useDocumentTitle(caseData ? (isDraft ? t('new_case') : (caseData.Title || t('untitled'))) : null);

    /** Resolves false when the save failed (the error is in saveError). */
    async function patchCase(updates: Record<string, unknown>): Promise<boolean> {
        if (!caseData) return false;
        setSaving(true);
        setSaveError(null);
        try {
            const client = await getDataClient();
            await client.cases.update(Number(id), {
                ...updates,
                personIds: caseData.people.map(p => p.Id),
                mediaIds: caseData.media.map(m => m.Id),
            }, activeTreeId);
            await fetchCase();
            return true;
        } catch (err) {
            console.error('Failed to update case:', err);
            setSaveError(err instanceof Error ? err.message : t('failed_save_generic'));
            return false;
        } finally {
            setSaving(false);
        }
    }

    // Draft mode: persist nothing until the user gives the case a title.
    /** Resolves whether the case was created. */
    async function createDraftCase(): Promise<boolean> {
        if (!titleValue.trim() || createdId) return false;
        setSaving(true);
        setSaveError(null);
        try {
            const client = await getDataClient();
            const created = await client.cases.create({
                Title: titleValue.trim(),
                Description: descValue.trim() || null,
                Status: 'in_progress',
                Tags: [],
                personIds: [],
            }, activeTreeId);
            if (created.Id) {
                // Transition draft → live IN PLACE: seed the created case into
                // state, flip isDraft off via createdId, and sync the URL with
                // history.replaceState. No router navigation → CaseDetailView is
                // NOT remounted, so its loading gate never re-enters (no flash).
                setCaseData(prev => prev ? {
                    ...prev,
                    Id: created.Id,
                    Title: created.Title,
                    Description: created.Description ?? null,
                    Status: created.Status,
                    CreatedAt: created.CreatedAt ?? prev.CreatedAt,
                    UpdatedAt: created.UpdatedAt ?? prev.UpdatedAt,
                } : prev);
                setStatusValue(created.Status);
                setCreatedId(String(created.Id));
                if (typeof window !== 'undefined') {
                    window.history.replaceState(window.history.state, '', `/cases/view?id=${created.Id}`);
                }
                return true;
            }
            setSaveError(t('failed_save_generic'));
            return false;
        } catch (err) {
            console.error('Failed to create case:', err);
            setSaveError(err instanceof Error ? err.message : t('failed_save_generic'));
            return false;
        } finally {
            setSaving(false);
        }
    }

    // While composing, what the fields hold that the case doesn't yet: the first
    // save creates it, later ones patch it. Title is required, so an empty title
    // waits (#912).
    const composedTitle = titleValue.trim();
    const composedDesc = descValue.trim() || null;
    const composeChanged = composing && composedTitle.length > 0 && (!createdId
        || composedTitle !== (caseData?.Title ?? '') || composedDesc !== (caseData?.Description ?? null));

    async function saveComposed() {
        if (autosaveTimer.current) { clearTimeout(autosaveTimer.current); autosaveTimer.current = null; }
        if (!composeChanged) return;
        if (!createdId) {
            // Creates exactly once; a second timer firing mid-create waits for it, and
            // the effect below patches anything typed in the meantime.
            if (createGuard.current) return;
            createGuard.current = true;
            if (!(await createDraftCase())) {
                // A failed create can be retried by the next edit.
                createGuard.current = false;
                setSaveState('idle');
                return;
            }
        } else {
            if (!(await patchCase({ Title: composedTitle, Description: composedDesc }))) { setSaveState('idle'); return; }
        }
        setSaveState('saved');
    }

    // Autosave ~650ms after the last keystroke in either field, using the latest
    // title and description.
    useEffect(() => {
        if (!composeChanged) {
            if (!createdId && composedTitle.length === 0) setSaveState('idle');
            return;
        }
        setSaveState('saving');
        if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
        autosaveTimer.current = setTimeout(() => { void saveComposed(); }, 650);
        return () => { if (autosaveTimer.current) clearTimeout(autosaveTimer.current); };
        // saveComposed reads this render's values, the ones this effect saw change.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [composedTitle, composedDesc, composeChanged, createdId]);

    /** Focus left the header: save what's pending now, and show the saved header. */
    async function finishComposing() {
        if (!composing || !createdId) return;
        await saveComposed();
        if (titleValue.trim()) setComposing(false);
    }

    async function addTag() {
        const tag = tagInput.trim();
        if (!tag || !caseData) return;
        const tags = [...(caseData.Tags ?? [])];
        if (!tags.includes(tag)) tags.push(tag);
        await patchCase({ Tags: tags });
        setTagInput('');
    }

    async function removeTag(tag: string) {
        if (!caseData) return;
        const tags = caseData.Tags.filter(x => x !== tag);
        await patchCase({ Tags: tags });
    }

    // People management — immediate link/unlink via PersonPicker onChange
    async function handlePeopleChange(newPeople: PersonResult[]) {
        if (!caseData) return;
        const previousPeople = casePeople;
        setCasePeople(newPeople);
        setSaving(true);
        setSaveError(null);
        try {
            const client = await getDataClient();
            await client.cases.update(Number(id), {
                personIds: newPeople.map(p => p.Id),
                mediaIds: caseData.media.map(m => m.Id),
            }, activeTreeId);
            await fetchCase();
        } catch (err) {
            console.error('Failed to sync people:', err);
            setCasePeople(previousPeople);
            setSaveError(err instanceof Error ? err.message : t('failed_update_people'));
        } finally {
            setSaving(false);
        }
    }

    // Comments. Resolves whether the entry was posted.
    /**
     * Posts the composer's entry; `leadIds` files it under those leads (#58), none for
     * the whole case. With `asRecord` (the desktop workspace), a photo or citation on
     * the entry also becomes a record with no claims yet, under the same leads, so it
     * is a source in All evidence; the note stays its journal entry.
     */
    async function postComment(leadIds?: number[], asRecord = false): Promise<boolean> {
        if (!commentBody.trim()) return false;
        setPostingComment(true);
        try {
            let mediaId: number | null = journalMedia?.Id ?? null;
            // A linked person's item joins the case's Media section, as an upload does.
            if (journalMedia && caseData && !caseData.media.some((m) => m.Id === journalMedia.Id)) {
                try {
                    await (await getDataClient()).cases.linkMedia(Number(id), { mediaIds: [journalMedia.Id] }, activeTreeId);
                } catch {
                    setSaveError(t('image_attach_failed'));
                    setPostingComment(false);
                    return false;
                }
            }
            if (journalFile) {
                try {
                    const client = await getDataClient();
                    const media = await client.media.upload({ file: journalFile, caseId: parseInt(id, 10) }, activeTreeId);
                    mediaId = media.Id;
                } catch {
                    setSaveError(t('image_attach_failed'));
                    setPostingComment(false);
                    return false;
                }
            }
            const client = await getDataClient();
            const comment = await client.cases.addComment(Number(id), { body: commentBody.trim(), mediaId, ...(leadIds ? { leadIds } : {}) }, activeTreeId);
            // Attach the queued source to this entry (comment-level citation).
            let citedSourceId: number | null = null;
            if (pendingCommentCite && comment?.Id) {
                try {
                    citedSourceId = await attachPendingCommentCitation(client, pendingCommentCite, comment.Id, activeTreeId);
                } catch (citeErr) {
                    console.error('Failed to attach citation to entry:', citeErr);
                    setSaveError(t('failed_add_citation'));
                }
            }
            if (asRecord && comment?.Id && (mediaId != null || citedSourceId != null)) {
                const cite = citedSourceId != null ? pendingCommentCite : null;
                try {
                    await client.cases.addFinding(Number(id), {
                        kind: 'record',
                        leadIds: comment.leadIds ?? leadIds ?? [],
                        source: citedSourceId != null ? { id: citedSourceId } : { title: noteTitle(commentBody) },
                        page: cite?.page ?? null, url: cite?.url ?? null, transcription: cite?.dataText ?? null,
                        mediaId,
                        commentId: comment.Id,
                    }, activeTreeId);
                } catch (recordErr) {
                    console.error('Failed to make a record of the entry:', recordErr);
                    setSaveError(recordErr instanceof Error ? recordErr.message : t('failed_post_comment'));
                }
            }
            setCommentBody('');
            setJournalFile(null);
            setJournalFilePreview(null);
            setJournalMediaState(null);
            setPendingCommentCite(null);
            await fetchCase();
            return true;
        } catch (err) {
            console.error('Failed to post comment:', err);
            setSaveError(err instanceof Error ? err.message : t('failed_post_comment'));
            return false;
        } finally {
            setPostingComment(false);
        }
    }

    // Add media's library: the media of the case's people, linked through
    // CaseMedia (#926, #1204).
    const libraryPickerSource = useMemo<MediaPickerSource>(() => ({
        key: `case:${id}`,
        loadCandidates: async () => (await getDataClient()).cases.listMediaLibrary(Number(id), activeTreeId),
        attach: async (mediaIds) => {
            await (await getDataClient()).cases.linkMedia(Number(id), { mediaIds }, activeTreeId);
        },
        emptyLabel: t('library_empty'),
        sectionTitle: t('library_section'),
    }), [id, activeTreeId, t]);

    function openCaseCitation(citation: CaseCitation, anchor: HTMLElement) {
        if (!caseData) return;
        const citations = caseData.citations.map(caseCitationAsCitation);
        setCitationPreview({
            anchor,
            citation: citations.find(c => c.Id === citation.Id) ?? caseCitationAsCitation(citation),
            fact: { factTable: FACT_TABLES.CASES, factId: caseData.Id, label: t('section_sources'), value: caseData.Title, citations },
        });
    }

    /** A journal entry's chip: its citations load on demand (the case only carries a label). */
    async function openCommentCitation(comment: CaseComment, anchor: HTMLElement) {
        try {
            const client = await getDataClient();
            const citations = await client.citations.listForFact(FACT_TABLES.CASE_COMMENTS, comment.Id, activeTreeId);
            const first = citations.find(c => c.Id === comment.citationId) ?? citations[0];
            if (!first) return;
            setCitationPreview({
                anchor,
                citation: first,
                fact: { factTable: FACT_TABLES.CASE_COMMENTS, factId: comment.Id, label: t('journal_entry_sources'), value: comment.Body, citations },
            });
        } catch (err) {
            if (redirectIfUnauthorized(err)) return;
            setSaveError(tCommon(errorToastKey(err)));
        }
    }

    async function removeCitation(citationId: number) {
        setSaveError(null);
        try {
            const client = await getDataClient();
            await client.citations.remove(citationId, activeTreeId);
            await fetchCase();
        } catch (err) {
            console.error('Failed to remove citation:', err);
            setSaveError(err instanceof Error ? err.message : t('failed_remove_citation'));
        }
    }

    async function removeMediaFromCase(mediaId: number) {
        try {
            const client = await getDataClient();
            await client.cases.unlinkMedia(Number(id), mediaId, activeTreeId);
            setLightboxIndex(null);
            await fetchCase();
        } catch (err) {
            console.error('Failed to remove media from case:', err);
            setSaveError(err instanceof Error ? err.message : t('failed_remove_media'));
        }
    }

    // Journal entries are append-only (#1251, ADR 0042): a note is never edited or
    // deleted, only struck out. Its author with Contribute access, or anyone with
    // Edit access, strikes it or undoes the strike. Status and conclusion entries
    // are the case's history and never change.
    const canStrikeNote = (c: CaseComment) => c.Kind == null && canEdit && (canDelete || c.UserId === currentUserId);

    async function undoStrikeChange(auditIds: number[]) {
        try {
            const client = await getDataClient();
            await client.audit.revert(auditIds, activeTreeId);
            await fetchCase();
        } catch (err) {
            if (redirectIfUnauthorized(err)) return;
            setSaveError(tCommon(errorToastKey(err)));
        }
    }

    /** Strike a note out, or undo its strike. Resolves whether it changed. */
    async function setNoteStruck(comment: CaseComment, struck: boolean, reason: string | null = null): Promise<boolean> {
        setSaveError(null);
        try {
            const client = await getDataClient();
            const caseId = Number(id);
            const { auditIds } = struck
                ? await client.cases.strikeComment(caseId, comment.Id, reason?.trim() || null, activeTreeId)
                : await client.cases.unstrikeComment(caseId, comment.Id, activeTreeId);
            await fetchCase();
            // Undo reverts the audit entry (ADR 0028), which needs Edit access.
            showChangeToast({
                message: t(struck ? 'journal_struck_toast' : 'journal_unstruck_toast'),
                onUndo: canDelete && auditIds.length > 0 ? () => void undoStrikeChange(auditIds) : undefined,
            });
            return true;
        } catch (err) {
            if (redirectIfUnauthorized(err)) return false;
            setSaveError(tCommon(errorToastKey(err)));
            return false;
        }
    }

    // Delete case
    async function handleDelete() {
        setDeleteError(null);
        setDeleting(true);
        try {
            const client = await getDataClient();
            await client.cases.remove(Number(id), activeTreeId);
            router.push('/cases');
        } catch (err) {
            console.error('Failed to delete case:', err);
            setDeleteError(err instanceof Error ? err.message : t('failed_delete'));
        } finally {
            setDeleting(false);
        }
    }

    return {
        // context / identity
        id, isDraft, activeTreeId, activePermission, t, tCommon,
        // core data + status
        caseData, loading, saving, fetchError, notFound, saveError, deleteError,
        setSaveError, setFetchError, setLoading, setDeleteError,
        // edit state
        titleValue, setTitleValue, descValue, setDescValue,
        composing, finishComposing,
        statusValue, tagInput, setTagInput,
        // people
        casePeople,
        // citations
        showAttachSource, setShowAttachSource,
        citationPreview, setCitationPreview, openCaseCitation, openCommentCitation,
        editCitation, setEditCitation, confirmRemoveCitation, setConfirmRemoveCitation,
        // comments
        commentBody, setCommentBody, postingComment,
        pendingCommentCite, setPendingCommentCite, showComposerCite, setShowComposerCite,
        journalFile, setJournalFile, journalFilePreview, setJournalFilePreview,
        journalMedia, setJournalMedia,
        // media upload / library
        showUploadModal, setShowUploadModal,
        libraryPickerSource,
        // lightbox
        lightboxIndex, setLightboxIndex,
        // delete
        showDeleteConfirm, setShowDeleteConfirm, deleting,
        // new-case autosave + mobile tab
        saveState, mobileTab, setMobileTab,
        // derived
        canEdit, canDelete, caseReady,
        // handlers
        fetchCase, patchCase, saveComposed, addTag, removeTag,
        handlePeopleChange, postComment,
        canStrikeNote, setNoteStruck,
        removeMediaFromCase, removeCitation, handleDelete,
    };
}

export type CaseDetailState = ReturnType<typeof useCaseDetail>;
