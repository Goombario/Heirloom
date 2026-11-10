'use client';

import { useTranslations } from 'next-intl';
import AttachSourceSidebar from '@/app/components/AttachSourceSidebar';
import { CiteFactSheet } from '@/app/components/person-form/CiteFactSheet';
import { ClearDeathConfirm } from '@/app/components/person-form/ClearDeathConfirm';
import { useTree } from '@/app/contexts/TreeContext';
import { usePersonForm, type UsePersonFormProps } from '@/app/components/person-form/usePersonForm';
import { useIsMobile } from '@/app/hooks/useIsMobile';
import PersonFormDesktop from '@/app/components/person-form/PersonFormDesktop';
import PersonFormMobile from '@/app/components/person-form/PersonFormMobile';
import { InlineDataError, PageShell } from '@/app/components/ui';

// PersonForm is a thin shell: it instantiates usePersonForm once, detects the
// viewport via useIsMobile, and delegates rendering to PersonFormDesktop or
// PersonFormMobile. All state/logic lives in the hook; all layout lives in the
// layout components (app/components/person-form/).
export default function PersonForm(props: UsePersonFormProps) {
    const { activeTreeId } = useTree();
    const t = useTranslations('editPerson');
    const tc = useTranslations('common');
    const isMobile = useIsMobile();

    const fm = usePersonForm(props);
    const {
        loading, isNew, form, error, relations, retryLoad,
        attachTarget, setAttachTarget,
        mobileSheetTarget, setMobileSheetTarget,
        citationMap, citationError, citationsReady, refreshCitations, pushPendingCitation,
    } = fm;

    if (loading) {
        return (
            <PageShell variant="detail" className="flex flex-col" contentClassName="flex-1 flex items-center justify-center">
                <span className="muted">{tc('loading')}</span>
            </PageShell>
        );
    }

    // A failed edit-mode read must not fall through to the empty form. `relations`
    // is populated only after the person read succeeds, so this distinguishes a
    // cold read failure from mutation errors that belong inside the rendered form.
    if (!isNew && relations == null && error != null) {
        return (
            <PageShell variant="detail" className="flex flex-col" contentClassName="flex-1 flex items-center justify-center p-6">
                <InlineDataError
                    message={error}
                    retryLabel={tc('retry')}
                    onRetry={retryLoad}
                    className="w-full max-w-xl"
                />
            </PageShell>
        );
    }

    const personName = [form.FirstName, form.LastName].filter(Boolean).join(' ') || t('unnamed');

    return (
        <>
            {isMobile
                ? <PersonFormMobile fm={fm} treeId={activeTreeId} personName={personName} />
                : <PersonFormDesktop fm={fm} treeId={activeTreeId} personName={personName} />
            }

            <ClearDeathConfirm
                status={fm.clearDeathPending ? (form.IsDeceased === '0' ? 'living' : 'unknown') : null}
                name={personName}
                onConfirm={fm.confirmClearDeath}
                onCancel={fm.cancelClearDeath}
            />

            {citationError && (
                <div className="mx-auto max-w-[1080px] px-7">
                    <InlineDataError
                        message={citationError}
                        retryLabel={tc('retry')}
                        onRetry={refreshCitations}
                        className="mb-3.5"
                    />
                </div>
            )}

            {/* Mobile cite-fact launcher sheet — intercepts cite-pin taps on narrow
                viewports so the user picks library vs. upload before entering the sidebar.
                CiteFactSheet gates on useIsMobile internally via ui/Sheet, so it
                renders nothing on desktop. */}
            <CiteFactSheet
                target={mobileSheetTarget}
                onClose={() => setMobileSheetTarget(null)}
                onProceed={(target) => {
                    if (!isNew && !citationsReady) return;
                    setMobileSheetTarget(null);
                    setAttachTarget(target);
                }}
            />

            {/* Attach-source sidebar — rendered outside the layout so it overlays both */}
            {attachTarget && (isNew || citationsReady) && (
                <AttachSourceSidebar
                    factTable={attachTarget.factTable}
                    factId={isNew ? null : attachTarget.factId}
                    factLabel={attachTarget.factLabel}
                    personName={personName}
                    existingCitations={isNew ? undefined : (citationMap[`${attachTarget.factTable}:${attachTarget.factId}`] ?? [])}
                    onClose={() => setAttachTarget(null)}
                    onPending={isNew ? (pc) => pushPendingCitation(pc) : undefined}
                    onAttached={() => { refreshCitations(); }}
                />
            )}
        </>
    );
}
