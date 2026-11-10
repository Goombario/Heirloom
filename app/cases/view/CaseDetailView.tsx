'use client';

import AttachSourceSidebar from '@/app/components/AttachSourceSidebar';
import CitationPreview from '@/app/components/citations/CitationPreview';
import { FACT_TABLES } from '@/lib/db/fact-tables';
import MediaLightbox from '@/app/components/lightbox/MediaLightbox';
import ConfirmDialog from '@/app/components/ConfirmDialog';
import AddMediaModal from '@/app/components/media/AddMediaModal';
import { Button, PageShell } from '@/app/components/ui';
import { DetailSkeleton } from '@/app/components/SkeletonLoader';
import RecordNotFound from '@/app/components/RecordNotFound';
import { useEffect, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { X } from '@/lib/icons';
import { useIsMobile } from '@/app/hooks/useIsMobile';
import { useCaseDetail } from './useCaseDetail';
import CaseHeaderCard from './CaseHeaderCard';
import CaseJournal from './CaseJournal';
import CaseEvidenceRail from './CaseEvidenceRail';
import MobileCasePage, { MobileCaseSkeleton } from './MobileCasePage';

export default function CaseDetailClient({ forceDraft = false }: { forceDraft?: boolean }) {
    const cd = useCaseDetail({ forceDraft });
    const isMobile = useIsMobile();
    const router = useRouter();
    // On a phone a new case is a sheet over the cases list with Create (#1123), not the
    // autosaved draft page.
    const phoneDraft = cd.isDraft && isMobile;
    useEffect(() => {
        if (phoneDraft) router.replace('/cases?new=1');
    }, [phoneDraft, router]);
    const {
        id, activeTreeId, t, tCommon,
        caseData, loading, fetchError, notFound, saveError, setSaveError, setFetchError, setLoading,
        showUploadModal, setShowUploadModal,
        libraryPickerSource,
        lightboxIndex, setLightboxIndex,
        showDeleteConfirm, setShowDeleteConfirm, deleting, deleteError, setDeleteError,
        showAttachSource, setShowAttachSource, canEdit,
        fetchCase, removeMediaFromCase, handleDelete,
    } = cd;

    const tCite = useTranslations('citeSheet');
    // Footnote numbers for the preview: each source's first appearance in the list.
    const citationNumbers = useMemo(() => {
        const numbers = new Map<number, number>();
        for (const c of cd.citationPreview?.fact.citations ?? []) if (!numbers.has(c.SourceId)) numbers.set(c.SourceId, numbers.size + 1);
        return numbers;
    }, [cd.citationPreview]);

    if (phoneDraft) return null;

    if (loading) {
        // The cases LIST page has had a skeleton for a while; the view page showed a
        // centred "Loading…" line, so opening a case blanked the screen and then
        // dropped a full layout in. Same DetailSkeleton the person and family detail
        // pages use — the shapes (hero, rail, body) match this page's layout.
        // A phone gets its own: the case page there is a band and tabs, not a hero and rail.
        return isMobile ? <MobileCaseSkeleton /> : <DetailSkeleton heroTone="light" />;
    }

    if (notFound) return <RecordNotFound record="case" />;

    if (fetchError) {
        return (
            <PageShell variant="detail" className="flex flex-col" contentClassName="flex-1 flex items-center justify-center">
                <div className="text-center">
                    <p className="text-text-muted mb-3">{fetchError}</p>
                    <Button variant="outline" size="sm" onClick={() => { setFetchError(null); setLoading(true); fetchCase(); }}>{tCommon('retry')}</Button>
                </div>
            </PageShell>
        );
    }

    if (!caseData) return null;

    const detailContent = (
        <>
            {saveError && (
                <div className="flex justify-between items-center mb-3.5 px-3.5 py-2 rounded-lg text-sm bg-error-bg border border-error text-error">
                    <span>{saveError}</span>
                    <button type="button" onClick={() => setSaveError(null)} className="cursor-pointer inline-flex" aria-label={tCommon('close')}>
                        <X className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                </div>
            )}

            <CaseHeaderCard cd={cd} />
            <div className="grid gap-5 items-start grid-cols-1 md:grid-cols-[minmax(0,1.55fr)_330px]">
                <CaseJournal cd={cd} />
                <CaseEvidenceRail cd={cd} />
            </div>
        </>
    );

    return (
        <>
            {isMobile ? <MobileCasePage cd={cd} /> : <PageShell variant="detail">{detailContent}</PageShell>}

            {/* Add media: upload, and the case's people's media (#926, #1204). */}
            {showUploadModal && (
                <AddMediaModal
                    target={{ kind: 'case', caseId: parseInt(id, 10), source: libraryPickerSource }}
                    treeId={activeTreeId}
                    targetName={caseData.Title || null}
                    onClose={() => setShowUploadModal(false)}
                    onMediaChanged={() => { void fetchCase(); }}
                    onAdded={() => setShowUploadModal(false)}
                />
            )}

            {/* Media lightbox — shared MediaLightbox (view + face tagging). */}
            {lightboxIndex != null && caseData.media[lightboxIndex] && (
                <MediaLightbox
                    items={caseData.media}
                    index={lightboxIndex}
                    treeId={activeTreeId}
                    canEdit={canEdit}
                    canDelete={cd.canDelete}
                    canRemoveFromContext={cd.canDelete}
                    context="library"
                    onClose={() => setLightboxIndex(null)}
                    onChangeIndex={setLightboxIndex}
                    onTagsChanged={() => { void fetchCase(); }}
                    onRemoveFromContext={(mediaId) => removeMediaFromCase(mediaId)}
                    removeActionLabel={t('remove_from_case')}
                    onDeleted={() => { setLightboxIndex(null); void fetchCase(); }}
                />
            )}

            {/* Attach source sidebar — cite a library Source on this case */}
            {showAttachSource && caseData.Id > 0 && (
                <AttachSourceSidebar
                    factTable={FACT_TABLES.CASES}
                    factId={caseData.Id}
                    // "Cite source" is its only opener; the rail already lists what's attached (#914).
                    initialView="add"
                    factLabel={caseData.Title || t('new_case_label')}
                    existingCitations={caseData.citations}
                    canDetach={cd.canDelete}
                    onClose={() => setShowAttachSource(false)}
                    onAttached={() => { fetchCase(); }}
                />
            )}

            {/* A case or journal-entry citation, previewed in place like a fact chip's (#918). */}
            {cd.citationPreview && (
                <CitationPreview
                    target={cd.citationPreview}
                    sourceNumbers={citationNumbers}
                    canEdit={canEdit}
                    onClose={() => cd.setCitationPreview(null)}
                    onEdit={(citation) => {
                        const fact = cd.citationPreview?.fact;
                        cd.setCitationPreview(null);
                        if (fact?.factTable === FACT_TABLES.CASES || fact?.factTable === FACT_TABLES.CASE_COMMENTS) {
                            cd.setEditCitation({ factTable: fact.factTable, factId: fact.factId, citationId: citation.Id });
                        }
                    }}
                />
            )}

            {/* Edit citation from the preview: the sidebar opens on that citation. */}
            {cd.editCitation && (
                <AttachSourceSidebar
                    factTable={cd.editCitation.factTable}
                    factId={cd.editCitation.factId}
                    factLabel={caseData.Title || t('new_case_label')}
                    initialCitationId={cd.editCitation.citationId}
                    canDetach={cd.canDelete}
                    onClose={() => cd.setEditCitation(null)}
                    onAttached={() => { fetchCase(); }}
                />
            )}

            {/* Removing a case source asks first (#918). */}
            <ConfirmDialog
                open={cd.confirmRemoveCitation !== null}
                variant="calm"
                tone="danger"
                title={tCite('remove_title', { fact: caseData.Title || t('untitled') })}
                body={<p className="text-text-secondary text-sm">{tCite('remove_body')}</p>}
                confirmLabel={tCite('remove_confirm')}
                cancelLabel={tCite('keep')}
                onConfirm={async () => {
                    const target = cd.confirmRemoveCitation;
                    cd.setConfirmRemoveCitation(null);
                    if (target) await cd.removeCitation(target.Id);
                }}
                onCancel={() => cd.setConfirmRemoveCitation(null)}
            />

            {/* Composer cite — queue a source onto the entry being written (onPending) */}
            {cd.showComposerCite && (
                <AttachSourceSidebar
                    factTable={FACT_TABLES.CASE_COMMENTS}
                    factId={null}
                    factLabel={caseData.Title || t('new_case_label')}
                    onClose={() => cd.setShowComposerCite(false)}
                    onPending={(pending) => {
                        cd.setPendingCommentCite(pending);
                        cd.setShowComposerCite(false);
                    }}
                />
            )}

            {/* Delete Confirm Modal (the phone page has its own confirm card) */}
            <ConfirmDialog
                open={showDeleteConfirm && !isMobile}
                variant="calm"
                tone="danger"
                title={t('delete_case_title')}
                body={
                    <>
                        <p className="text-text-secondary text-sm">{t('delete_case_confirm')}</p>
                        {deleteError && <p className="text-sm text-error mt-3">{deleteError}</p>}
                    </>
                }
                confirmLabel={tCommon('delete')}
                busy={deleting}
                onConfirm={handleDelete}
                onCancel={() => { setShowDeleteConfirm(false); setDeleteError(null); }}
            />
        </>
    );
}
