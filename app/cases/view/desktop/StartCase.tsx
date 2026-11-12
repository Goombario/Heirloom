'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';
import { Banner, Button, CoverBand, PageShell, PersonFinder, cx, fieldClass } from '@/app/components/ui';
import { Plus, X } from '@/lib/icons';
import { displayFullName } from '@/lib/utils/names';
import { getDataClient } from '@/lib/data';

/** The kinds of question a case starts from (#58); stored as the case's QuestionKind. */
const QUESTION_KINDS = ['activity', 'moved', 'parents', 'identity', 'death', 'records', 'own'] as const;
type Kind = typeof QUESTION_KINDS[number];

const yearOrNull = (s: string): number | null => (/^\d{1,4}$/.test(s.trim()) ? Number(s.trim()) : null);

/**
 * Start a case (#58): full width, with no side column and no ⋯ menu. Pick the
 * kind of question, who it is about, the years and a focus place; the question
 * fills itself in from them until it is edited. Start the case creates it and
 * opens the workspace on its first lead. A lead a closed case left open starts
 * one here as its own question (`?q=`).
 */
export function StartCase({ treeId }: { treeId: number | null }) {
    const t = useTranslations('caseResearch');
    const router = useRouter();
    const id = useId();
    const asked = useSearchParams()?.get('q')?.trim().slice(0, 500) || null;
    const [kind, setKind] = useState<Kind | null>(asked ? 'own' : null);
    const [people, setPeople] = useState<Array<{ id: number; name: string }>>([]);
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [place, setPlace] = useState('');
    const [event, setEvent] = useState('');
    const [ownQuestion, setOwnQuestion] = useState<string | null>(asked);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fromYear = yearOrNull(from);
    const toYear = yearOrNull(to);
    const badYears = (from.trim() !== '' && fromYear == null) || (to.trim() !== '' && toYear == null) || (fromYear != null && toYear != null && fromYear > toYear);
    const gap = '…';
    const name = people[0]?.name || gap;
    const suggested = kind && kind !== 'own'
        ? t(`kind_${kind}_q`, { name, from: from.trim() || gap, to: to.trim() || gap, place: place.trim() || gap, event: event.trim() || gap })
        : '';
    // The question follows the details until it is edited by hand.
    const question = ownQuestion ?? suggested;
    const ready = kind != null && question.trim() !== '' && !question.includes(gap) && !badYears && !busy;

    const start = async () => {
        if (!ready || !kind) return;
        setBusy(true);
        setError(null);
        try {
            const client = await getDataClient();
            const made = await client.cases.create({
                Title: question.trim(), QuestionKind: kind, FromYear: fromYear, ToYear: toYear, Place: place.trim() || null,
                personIds: people.map((p) => p.id),
            }, treeId);
            router.replace(`/cases/view?id=${made.Id}`);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
            setBusy(false);
        }
    };

    return (
        <PageShell variant="workspace" className="pb-10">
            <div className="mx-auto w-full max-w-[1240px] px-4 md:px-7 pb-6 grid gap-6">
                <CoverBand variant="short" eyebrow={t('eyebrow')} title={t('start_title')} titleSize="record" meta={t('start_intro')} />
                {error && <Banner tone="error">{error}</Banner>}
                <form className={cx('rounded-panel', 'grid gap-7 bg-card border border-border p-6 md:p-8')} onSubmit={(e) => { e.preventDefault(); void start(); }}>
                    <fieldset className="m-0 p-0 border-0 grid gap-3">
                        <legend className="mb-3 serif text-md font-semibold text-text">{t('start_kind')}</legend>
                        <div className="grid gap-2 md:grid-cols-2">
                            {QUESTION_KINDS.map((k) => (
                                <label key={k} className={cx('flex items-start gap-3 rounded-card border px-4 py-3 cursor-pointer focus-ring-within',
                                    kind === k ? 'border-text bg-surface-2' : 'border-border bg-card hover:bg-hover-surface')}>
                                    <input type="radio" name={`${id}-kind`} checked={kind === k} onChange={() => { setKind(k); setOwnQuestion(k === 'own' ? (ownQuestion ?? '') : null); }} className="mt-1" />
                                    <span className="grid gap-0.5">
                                        <span className="text-sm font-medium text-text">{t(`kind_${k}`)}</span>
                                        <span className="text-meta text-text-muted">{t(`kind_${k}_hint`)}</span>
                                    </span>
                                </label>
                            ))}
                        </div>
                    </fieldset>

                    {kind && (
                        <>
                            <fieldset className="m-0 p-0 border-0 grid gap-2">
                                <legend className="mb-2 serif text-md font-semibold text-text">{t('start_who')}</legend>
                                {people.length > 0 && (
                                    <div className="flex flex-wrap gap-1.5">
                                        {people.map((p) => (
                                            <span key={p.id} className="inline-flex items-center gap-1 h-[30px] rounded-full bg-surface-2 pl-3 pr-1 text-sm text-text">
                                                {p.name}
                                                <button type="button" aria-label={t('remove_person', { name: p.name })} onClick={() => setPeople((list) => list.filter((x) => x.id !== p.id))}
                                                    className="grid place-items-center w-6 h-6 rounded-full bg-transparent border-0 text-text-muted hover:text-text cursor-pointer focus-ring">
                                                    <X className="w-3.5 h-3.5" aria-hidden="true" />
                                                </button>
                                            </span>
                                        ))}
                                    </div>
                                )}
                                <PersonFinder
                                    title={t('add_person')}
                                    treeId={treeId}
                                    excludeIds={people.map((p) => p.id)}
                                    onPick={(p) => setPeople((list) => [...list, { id: p.Id, name: displayFullName(p) || t('unnamed') }])}
                                    trigger={(p) => (
                                        <button {...p} type="button" className="justify-self-start inline-flex items-center gap-1 bg-transparent border-0 p-0 text-sm text-link hover:underline cursor-pointer focus-ring rounded-sm">
                                            <Plus className="w-3.5 h-3.5" aria-hidden="true" />{t('add_person')}
                                        </button>
                                    )}
                                />
                            </fieldset>

                            <div className="flex flex-wrap gap-4">
                                <fieldset className="m-0 p-0 border-0 grid gap-1.5">
                                    <legend className="mb-1.5 text-sm text-text-secondary">{t('years')}</legend>
                                    <div className="flex items-center gap-2">
                                        <input aria-label={t('from_year')} inputMode="numeric" value={from} onChange={(e) => setFrom(e.target.value)} className={cx(fieldClass('md', 'w-28'), 'date-mono')} placeholder={t('from')} />
                                        <span aria-hidden="true" className="text-text-muted">–</span>
                                        <input aria-label={t('to_year')} inputMode="numeric" value={to} onChange={(e) => setTo(e.target.value)} className={cx(fieldClass('md', 'w-28'), 'date-mono')} placeholder={t('to')} />
                                    </div>
                                </fieldset>
                                <label className="grid gap-1.5 text-sm text-text-secondary flex-1 min-w-48">
                                    {t('focus_place')}
                                    <input value={place} onChange={(e) => setPlace(e.target.value)} maxLength={500} className={fieldClass()} />
                                </label>
                                {kind === 'records' && (
                                    <label className="grid gap-1.5 text-sm text-text-secondary flex-1 min-w-48">
                                        {t('start_event')}
                                        <input value={event} onChange={(e) => setEvent(e.target.value)} maxLength={200} className={fieldClass()} placeholder={t('start_event_hint')} />
                                    </label>
                                )}
                            </div>
                            {badYears && <p role="alert" className="m-0 text-sm text-error">{t('years_invalid')}</p>}

                            <label className="grid gap-1.5 text-sm text-text-secondary">
                                {t('question')}
                                <input value={question} onChange={(e) => setOwnQuestion(e.target.value)} maxLength={500} className={fieldClass()} placeholder={t('lead_question_hint')} />
                                {question.includes(gap) && <span className="text-meta text-text-muted">{t('start_fill_gaps')}</span>}
                            </label>
                        </>
                    )}

                    <div className="flex justify-end gap-2 border-t border-border pt-5">
                        <Button variant="outline" onClick={() => router.push('/cases')} disabled={busy}>{t('cancel')}</Button>
                        <Button type="submit" disabled={!ready}>{t('start_case')}</Button>
                    </div>
                </form>
            </div>
        </PageShell>
    );
}
