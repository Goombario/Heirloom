'use client';

import { useRef, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { formatYearOrEmpty } from '@/lib/date-utils';
import { displayFullName } from '@/lib/utils/names';
import Link from 'next/link';
import { type PersonPickerHandle } from '@/app/components/PersonPicker';
import { Button, Badge, FormTopBar, FormTopBarTitle, Banner, PageShell } from '@/app/components/ui';
import { isMac } from '@/lib/platform';
import type { UsePersonForm } from '@/app/components/person-form/usePersonForm';
import IdentitySection from '@/app/components/person-form/IdentitySection';
import VitalsSection from '@/app/components/person-form/VitalsSection';
import NotesSection from '@/app/components/person-form/NotesSection';
import SuggestionsSection from '@/app/components/person-form/SuggestionsSection';
import RelationshipsSection from '@/app/components/person-form/RelationshipsSection';
import DangerSection from '@/app/components/person-form/DangerSection';

/**
 * PersonFormDesktop — two-column layout (left fields + 320px right rail).
 * Receives the fully-initialised hook object via `fm`; owns no state of its own.
 * Extracted from PersonForm.tsx (Task 5) — behavior-identical to the original
 * desktop layout.
 */
export default function PersonFormDesktop({
    fm,
    treeId,
    personName,
}: {
    fm: UsePersonForm;
    treeId: number | null;
    personName: string;
}) {
    const router = useRouter();
    const t = useTranslations('editPerson');
    const tc = useTranslations('common');
    const {
        isNew, personId, form, saving, error, successMessage,
        relations, familiesAsSpouse, familiesAsChild, refreshRelations,
        potentialDuplicates, submit, onNavigate, guardNavigation,
    } = fm;

    // Ref for the inline spouse PersonPicker inside SuggestionsSection
    const spousePickerRef = useRef<PersonPickerHandle>(null);

    // The save bar is sticky BELOW the navbar, so the rail has to clear both. A
    // hardcoded `top-24` (96px) cleared the navbar only, and the Suggestions card's
    // heading scrolled under the bar (#441). Measured rather than guessed: the bar
    // grows with its own content (the edit-mode subtitle) and with the browser's
    // font size.
    const topBarRef = useRef<HTMLElement>(null);
    const [railTop, setRailTop] = useState<number | null>(null);
    useEffect(() => {
        const el = topBarRef.current;
        if (!el) return;
        // `bottom` is already viewport-relative and the bar is pinned while the rail
        // is sticking, so it IS the offset the rail needs — no navbar arithmetic.
        const measure = () => setRailTop(Math.round(el.getBoundingClientRect().bottom) + 12);
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    // New records get no subtitle — "Start with a name…" restated the form. The
    // edit subtitle stays: it carries the record id and birth year.
    const subtitle = isNew
        ? null
        : t('subtitle_edit', {
            id: personId ?? '',
            birth: form.BirthDate
                ? t('born_year', { year: formatYearOrEmpty(form.BirthDate) })
                : t('no_birth_date'),
        });

    return (
        <PageShell
            variant="detail"
            topBar={
                <FormTopBar ref={topBarRef} column="detail" className="py-3.5" innerClassName="gap-3.5">
                    <div className="flex-1 min-w-0">
                        <FormTopBarTitle>{isNew ? t('add_heading') : personName}</FormTopBarTitle>
                        {subtitle && <div className="muted text-meta mt-0.5">{subtitle}</div>}
                    </div>
                    <Button variant="ghost" onClick={() => { if (guardNavigation()) router.push(isNew ? '/people' : `/people/view?id=${personId}`); }}>{tc('cancel')}</Button>
                    {isNew && (
                        <Button
                            variant="outline"
                            disabled={saving}
                            onClick={() => submit({ addAnother: true })}
                            title="Ctrl+Enter"
                        >
                            {t('save_add_another')}
                        </Button>
                    )}
                    <Button
                        type="submit"
                        form="person-form"
                        variant="primary"
                        disabled={saving}
                    >
                        {saving ? tc('saving') : (isNew ? t('save_person') : tc('save_changes'))}
                    </Button>
                </FormTopBar>
            }
        >
                {error && (
                    <Banner tone="error" className="mb-3.5">{error}</Banner>
                )}
                {successMessage && (
                    <Banner tone="success" className="mb-3.5">{successMessage}</Banner>
                )}

                {/* Duplicate warning (new mode) */}
                {isNew && potentialDuplicates.length > 0 && (
                    <Banner
                        tone="warning"
                        className="mb-[18px]"
                        icon={<span className="text-lg leading-none">⚠</span>}
                    >
                        <strong>{t('duplicate_possible')}</strong> {t('duplicate_match', { count: potentialDuplicates.length })}
                        {potentialDuplicates.slice(0, 3).map((p, i) => (
                            <Link
                                key={p.Id}
                                    href={`/people/view?id=${p.Id}`}
                                target="_blank"
                                className="ml-1.5 underline"
                                style={{ color: 'var(--link)' }}
                            >
                                {displayFullName(p)}{p.BirthDate ? ` (${formatYearOrEmpty(p.BirthDate)})` : ''}{i < Math.min(potentialDuplicates.length, 3) - 1 ? ',' : ''}
                            </Link>
                        ))}
                        . {t('duplicate_continue')}
                    </Banner>
                )}

                <form id="person-form" onSubmit={(e) => { e.preventDefault(); submit({ addAnother: false }); }} autoComplete="off">
                    <div className="grid gap-5.5 items-start" style={{ gridTemplateColumns: 'minmax(0, 1fr) 320px' }}>
                        {/* LEFT */}
                        <div>
                            <IdentitySection fm={fm} />
                            <VitalsSection fm={fm} treeId={treeId} />
                            <NotesSection fm={fm} />
                            {!isNew && <DangerSection fm={fm} personName={personName} />}
                        </div>

                        {/* RIGHT RAIL */}
                        <div
                            className="sticky top-24 flex flex-col gap-4"
                            style={railTop == null ? undefined : { top: railTop }}
                        >
                            {isNew ? (
                                <SuggestionsSection fm={fm} treeId={treeId} spousePickerRef={spousePickerRef} />
                            ) : (
                                <RelationshipsSection
                                    relations={relations}
                                    familiesAsSpouse={familiesAsSpouse}
                                    familiesAsChild={familiesAsChild}
                                    treeId={treeId}
                                    personId={personId}
                                    personLastName={form.LastName}
                                    onChanged={refreshRelations}
                                    onNavigate={onNavigate}
                                />
                            )}
                            {isNew && <TipsCard />}
                        </div>
                    </div>
                </form>
        </PageShell>
    );
}

// --- Desktop-only subcomponents ---

function TipsCard() {
    const t = useTranslations('editPerson');
    const [mac, setMac] = useState(false);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { setMac(isMac()); }, []);
    const mod = mac ? '⌘' : 'Ctrl+';
    return (
        <div className="card card-pad p-3.5" style={{ background: 'var(--card-alt)' }}>
            <h3 className="rail-title mb-2">{t('tips')}</h3>
            <div className="text-meta leading-relaxed" style={{ color: 'var(--text-2)' }}>
                <div className="row gap-1.5 mb-1"><Badge className="mono" style={{ fontSize: 10 }}>{mod}S</Badge><span>{t('save_label')}</span></div>
                <div className="row gap-1.5 mb-2"><Badge className="mono" style={{ fontSize: 10 }}>{mac ? '⌘↵' : 'Ctrl+Enter'}</Badge><span>{t('save_add_another')}</span></div>
                <div className="muted text-xs">{t('tip_dates')} <span className="mono text-[0.875em]">1945</span>, <span className="mono text-[0.875em]">Mar 1945</span>, <span className="mono text-[0.875em]">3/15/1945</span>.</div>
            </div>
        </div>
    );
}
