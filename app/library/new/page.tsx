'use client';

import { Suspense, useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useTree } from '@/app/contexts/TreeContext';
import { getDataClient } from '@/lib/data';
import { SourceFields, SourceFormState, emptySourceForm } from '@/app/components/SourceFields';
import { Button, FormTopBar, FormTopBarTitle, MobileFormHeader, MobileFormFooter, PageShell } from '@/app/components/ui';
import { errorToastKey } from '@/lib/utils/data-error';
import { useErrorToast } from '@/app/components/useErrorToast';
import { useUnsavedChangesGuard } from '@/app/components/UnsavedChangesProvider';
import { useIsMobile } from '@/app/hooks/useIsMobile';

const SOURCES_HREF = '/library?tab=sources';

// useSearchParams needs a Suspense boundary in the static export.
export default function NewSourcePage() {
    return (
        <Suspense fallback={null}>
            <NewSourceForm />
        </Suspense>
    );
}

function NewSourceForm() {
    const t = useTranslations('library');
    const router = useRouter();
    const { activeTreeId } = useTree();
    // "Add a source here" on a repository's view comes with that repository picked (#1154).
    const searchParams = useSearchParams();
    const [initialForm] = useState<SourceFormState>(() => ({
        ...emptySourceForm,
        RepositoryName: searchParams.get('repository')?.trim() ?? '',
    }));
    const [form, setForm] = useState<SourceFormState>(initialForm);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const formRef = useRef<HTMLFormElement>(null);
    const tc = useTranslations('common');
    const { redirectIfUnauthorized } = useErrorToast();
    const isDirty = JSON.stringify(form) !== JSON.stringify(initialForm);
    const { guardNavigation } = useUnsavedChangesGuard(isDirty);
    // On a phone New source is the sheet over the Library (#1127).
    const isMobile = useIsMobile();
    useEffect(() => {
        if (isMobile) router.replace('/library?new=1');
    }, [isMobile, router]);

    useEffect(() => {
        function handleKeyDown(e: KeyboardEvent) {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                e.preventDefault();
                formRef.current?.requestSubmit();
            } else if (e.key === 'Escape') {
                if (guardNavigation()) router.push(SOURCES_HREF);
            }
        }
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [router, guardNavigation]);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!form.Title.trim()) {
            setError(t('title_required'));
            return;
        }
        setSaving(true);
        setError(null);
        try {
            const client = await getDataClient();
            const created = await client.sources.create({
                Title: form.Title.trim(),
                Type: form.Type,
                Author: form.Author || null,
                RepositoryName: form.RepositoryName || null,
                CallNumber: form.CallNumber || null,
                Text: form.Text || null,
                PublicationInfo: form.PublicationInfo || null,
                Contents: form.Contents || null,
            }, activeTreeId);
            // Land on the new source, where "Cite on…" is (#799).
            router.push(`${SOURCES_HREF}&source=${created.Id}`);
        } catch (err) {
            if (redirectIfUnauthorized(err)) {
                setSaving(false);
                return;
            }
            setError(tc(errorToastKey(err)));
            setSaving(false);
        }
    }

    return (
        <PageShell
            variant="detail"
            topBar={<>
                <FormTopBar column="detail" className="py-3.5 max-md:hidden" innerClassName="gap-3.5">
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="eyebrow mb-[2px]">{t('add_source_overline')}</div>
                        <FormTopBarTitle>{t('add_source_title')}</FormTopBarTitle>
                        <div className="muted text-meta mt-[2px]">
                            {t('add_source_desc')}
                        </div>
                    </div>
                    <Button variant="ghost" onClick={() => { if (guardNavigation()) router.push(SOURCES_HREF); }}>{t('cancel')}</Button>
                    <Button type="submit" form="source-form" disabled={saving} variant="primary">
                        {saving ? t('saving_source') : t('save_source')}
                    </Button>
                </FormTopBar>
                {/* Phones: the same header and footer as every other form (#807). */}
                <MobileFormHeader className="md:hidden" backHref={SOURCES_HREF} backLabel={tc('back')} title={t('add_source_title')} />
            </>}
            footer={
                <MobileFormFooter className="md:hidden">
                    <Button variant="outline" className="min-h-11 flex-1" onClick={() => { if (guardNavigation()) router.push(SOURCES_HREF); }}>{t('cancel')}</Button>
                    <Button type="submit" form="source-form" disabled={saving} variant="primary" className="min-h-11 flex-[1.4]">
                        {saving ? t('saving_source') : t('save_source')}
                    </Button>
                </MobileFormFooter>
            }
        >
            {/* Keeps its 760px reading width, left-aligned so the fields start under the title. */}
            <div className="max-w-[760px]">
                {error && (
                    <div
                        className="card card-pad mb-[14px] py-3 px-[14px] text-sm"
                        style={{ background: 'var(--error-bg)', borderColor: 'var(--error)', color: 'var(--error)' }}
                    >
                        {error}
                    </div>
                )}

                <form id="source-form" ref={formRef} onSubmit={handleSubmit} autoComplete="off">
                    <SourceFields
                        value={form}
                        onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
                        disabled={saving}
                        treeId={activeTreeId}
                    />
                    <div className="mt-2 text-meta" style={{ color: 'var(--text-muted)' }}>
                        {t('post_save_note')}
                    </div>
                </form>
            </div>
        </PageShell>
    );
}
