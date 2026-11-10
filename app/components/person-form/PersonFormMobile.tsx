'use client';

import { useRef } from 'react';
import { useTranslations } from 'next-intl';
import { formatYearOrEmpty } from '@/lib/date-utils';
import { displayFullName } from '@/lib/utils/names';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { type PersonPickerHandle } from '@/app/components/PersonPicker';
import { Button, Banner, PageShell, MobileFormHeader, MobileFormFooter } from '@/app/components/ui';
import { CheckCircle2, AlertTriangle } from '@/lib/icons';
import type { UsePersonForm } from '@/app/components/person-form/usePersonForm';
import IdentitySection from '@/app/components/person-form/IdentitySection';
import VitalsSection from '@/app/components/person-form/VitalsSection';
import NotesSection from '@/app/components/person-form/NotesSection';
import SuggestionsSection from '@/app/components/person-form/SuggestionsSection';
import RelationshipsSection from '@/app/components/person-form/RelationshipsSection';
import DangerSection from '@/app/components/person-form/DangerSection';

/**
 * PersonFormMobile — the "Final" mobile layout (Task 6 re-skin):
 *   sticky header (back chevron + serif heading, long-name ellipsis)
 *   → savedToast + duplicate banners → section-card stack → sticky bottom bar.
 * Owns no state of its own; all behavior comes from the `fm` hook.
 */
export default function PersonFormMobile({
    fm,
    treeId,
    personName,
}: {
    fm: UsePersonForm;
    treeId: number | null;
    personName: string;
}) {
    const t = useTranslations('editPerson');
    const tc = useTranslations('common');
    const router = useRouter();
    const {
        isNew, personId, form, saving, error, successMessage,
        relations, familiesAsSpouse, familiesAsChild, refreshRelations,
        potentialDuplicates, submit, onNavigate, guardNavigation,
    } = fm;

    // Ref for the inline spouse PersonPicker inside SuggestionsSection
    const spousePickerRef = useRef<PersonPickerHandle>(null);

    const backHref = isNew ? '/people' : `/people/view?id=${personId}`;

    return (
        <PageShell variant="workspace" className="flex flex-col">
            <MobileFormHeader backHref={backHref} backLabel={tc('back')} title={isNew ? t('add_heading') : personName} />

            {/* Body */}
            <div className="pt-3.5 px-4 pb-4" style={{ flex: 1 }}>
                {error && (
                    <Banner tone="error" className="mb-3">{error}</Banner>
                )}

                {successMessage && (
                    <Banner
                        tone="success"
                        align="center"
                        className="mb-3"
                        icon={<CheckCircle2 size={16} aria-hidden="true" />}
                    >
                        {successMessage}
                    </Banner>
                )}

                {/* Duplicate banner (new mode) */}
                {isNew && potentialDuplicates.length > 0 && (
                    <Banner
                        tone="warning"
                        className="mb-3"
                        icon={<AlertTriangle size={16} aria-hidden="true" />}
                    >
                        <strong>{t('duplicate_possible')}</strong> {t('duplicate_match', { count: potentialDuplicates.length })}
                        {potentialDuplicates.slice(0, 3).map((p, i) => (
                            <Link
                                key={p.Id}
                                href={`/people/view?id=${p.Id}`}
                                target="_blank"
                                className="ml-1.5"
                                style={{ color: 'var(--link)', textDecoration: 'underline' }}
                            >
                                {displayFullName(p)}{p.BirthDate ? ` (${formatYearOrEmpty(p.BirthDate)})` : ''}{i < Math.min(potentialDuplicates.length, 3) - 1 ? ',' : ''}
                            </Link>
                        ))}
                        . {t('duplicate_continue')}
                    </Banner>
                )}

                <form id="person-form" onSubmit={(e) => { e.preventDefault(); submit({ addAnother: false }); }} autoComplete="off">
                    <IdentitySection fm={fm} mobile />
                    <VitalsSection fm={fm} treeId={treeId} mobile />

                    {isNew && (
                        <SuggestionsSection fm={fm} treeId={treeId} spousePickerRef={spousePickerRef} mobile />
                    )}

                    <NotesSection fm={fm} mobile />

                    {!isNew && (
                        <RelationshipsSection
                            relations={relations}
                            familiesAsSpouse={familiesAsSpouse}
                            familiesAsChild={familiesAsChild}
                            treeId={treeId}
                            personId={personId}
                            personLastName={form.LastName}
                            onChanged={refreshRelations}
                            onNavigate={onNavigate}
                            mobile
                        />
                    )}

                    {!isNew && <DangerSection fm={fm} personName={personName} mobile />}
                </form>
            </div>

            <MobileFormFooter>
                {isNew ? (
                    <>
                        <Button
                            variant="outline"
                            disabled={saving}
                            onClick={() => submit({ addAnother: true })}
                            className="min-h-11"
                            style={{ flex: 1 }}
                        >
                            {t('save_add_another')}
                        </Button>
                        <Button
                            type="submit"
                            form="person-form"
                            variant="primary"
                            disabled={saving}
                            className="min-h-11"
                            style={{ flex: 1 }}
                        >
                            {saving ? tc('saving') : t('save_person')}
                        </Button>
                    </>
                ) : (
                    <>
                        <Button
                            variant="outline"
                            onClick={() => { if (guardNavigation()) router.push(backHref); }}
                            className="min-h-11"
                            style={{ flex: 1 }}
                        >
                            {tc('cancel')}
                        </Button>
                        <Button
                            type="submit"
                            form="person-form"
                            variant="primary"
                            disabled={saving}
                            className="min-h-11"
                            style={{ flex: 1.4 }}
                        >
                            {saving ? tc('saving') : tc('save_changes')}
                        </Button>
                    </>
                )}
            </MobileFormFooter>
        </PageShell>
    );
}
