'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { PersonResult } from '@/lib/db/schema';
import type { RelationshipResult } from '@/lib/data/types';
import { ArrowLeftRight, ChevronRight, Plus } from '@/lib/icons';
import { CopperPill, InlineDataError, Lifespan, MobileListHeader, PageShell } from '@/app/components/ui';
import PersonAvatar from '@/app/components/PersonAvatar';
import { PersonPickerSheet } from '@/app/components/PersonPickerSheet';
import { displayFullName } from '@/lib/utils/names';
import { getInitials } from '@/lib/utils/initials';

/** What the phone page needs to draw a person: the list row or a picker result. */
type RelPerson = Pick<PersonResult, 'Id' | 'FirstName' | 'LastName' | 'EffectiveFirstName' | 'Nickname'>
    & Partial<Pick<PersonResult, 'Sex' | 'BirthDate' | 'DeathDate' | 'PrimaryMediaId' | 'FocalX' | 'FocalY' | 'FocalRadius'>>;

/**
 * The phone relationship calculator (#1122). A tool page, not a list: the header says
 * "Relationships", two person rows open the shared person picker, Swap is a text link
 * by the People heading, the copper pill finds the answer, and the path is person rows
 * joined by a line carrying each relation word.
 */
export function MobileRelationship({ treeId, people, person1, person2, onPick, onSwap, onFind, loading, result, resultError, peopleError, onRetryPeople }: {
    treeId: number | null;
    people: RelPerson[];
    person1: number | null;
    person2: number | null;
    onPick: (slot: 1 | 2, id: number) => void;
    onSwap: () => void;
    onFind: () => void;
    loading: boolean;
    result: RelationshipResult | null;
    resultError: string | null;
    peopleError: string | null;
    onRetryPeople: () => void;
}) {
    const t = useTranslations('relationship');
    const tm = useTranslations('mobileRelationship');
    const tc = useTranslations('common');
    const [picking, setPicking] = useState<1 | 2 | null>(null);
    // A pick can land before the tree's people list does, so keep what the picker gave.
    const [picked, setPicked] = useState<Record<number, RelPerson>>({});
    const find = (id: number | null) => (id == null ? undefined : people.find((p) => p.Id === id) ?? picked[id]);
    const a = find(person1);
    const b = find(person2);

    return (
        <PageShell topBar={<MobileListHeader title={tm('title')} />} contentClassName="max-md:p-0!">
            {peopleError && <div className="px-4 pt-3"><InlineDataError message={peopleError} retryLabel={tc('retry')} onRetry={onRetryPeople} /></div>}
            <div className="flex items-baseline justify-between gap-2.5 px-4 pt-3.5 pb-1.5">
                <h2 className="eyebrow m-0">{tm('people')}</h2>
                <button type="button" onClick={onSwap} disabled={person1 == null && person2 == null} title={t('swap_title')}
                    className="inline-flex items-center gap-1.5 min-h-11 -my-3 text-sm font-medium text-text cursor-pointer rounded-lg focus-ring disabled:opacity-40 disabled:cursor-default">
                    <ArrowLeftRight className="w-[15px] h-[15px]" aria-hidden="true" />{t('swap')}
                </button>
            </div>
            <Slot person={a} label={t('first_person')} treeId={treeId} onClick={() => setPicking(1)} />
            <Slot person={b} label={t('second_person')} treeId={treeId} onClick={() => setPicking(2)} divided />

            <div className="px-4 pt-3.5 pb-1">
                <CopperPill onClick={onFind} disabled={person1 == null || person2 == null || loading}>
                    {loading ? t('calculating') : t('find_relationship')}
                </CopperPill>
            </div>

            {resultError && <div className="px-4 pt-3"><InlineDataError message={resultError} retryLabel={tc('retry')} onRetry={onFind} /></div>}

            {result && (
                <section className="mt-3 border-t border-border">
                    <h2 className="eyebrow m-0 px-4 pt-4 pb-1.5">{tm('result')}</h2>
                    <div className="grid gap-[3px] px-4 pt-1 pb-1.5">
                        <p role="status" className="m-0 serif text-xl font-semibold leading-tight">{result.relationship}</p>
                        {result.degree > 0 && <p className="m-0 text-sm text-text-muted">{t('steps_apart', { count: result.degree })}</p>}
                    </div>
                    {result.path.length > 0 && (
                        <>
                            <h2 className="eyebrow m-0 px-4 pt-4 pb-1.5">{t('path_heading')}</h2>
                            <ol className="m-0 p-0 list-none">
                                {result.path.map((step, i) => {
                                    const who = people.find((p) => p.Id === step.id);
                                    return (
                                        <li key={`${step.id}-${i}`}>
                                            {i > 0 && (
                                                <div className="flex items-center gap-3 h-6 px-4" aria-hidden="true">
                                                    <span className="w-9 flex justify-center self-stretch"><span className="w-[1.5px] bg-border" /></span>
                                                    <span className="text-meta text-text-muted">{step.relationship}</span>
                                                </div>
                                            )}
                                            <Link href={`/people/view?id=${step.id}`}
                                                className="flex items-center gap-3 min-h-[52px] px-4 py-1.5 no-underline text-inherit active:bg-surface-2 focus-ring-inset">
                                                <PersonAvatar as="span" treeId={treeId} name={step.name} size={36}
                                                    initials={who ? getInitials(who.FirstName, who.LastName) : undefined} sex={who?.Sex ?? null}
                                                    mediaId={who?.PrimaryMediaId} focalX={who?.FocalX} focalY={who?.FocalY} focalRadius={who?.FocalRadius} />
                                                <span className="flex-1 min-w-0 grid gap-0.5">
                                                    <span className="serif text-md font-semibold truncate">
                                                        {i > 0 && <span className="sr-only">{step.relationship}: </span>}{step.name}
                                                    </span>
                                                    {(who?.BirthDate || who?.DeathDate) && <span className="text-meta"><Lifespan birth={who.BirthDate ?? null} death={who.DeathDate ?? null} /></span>}
                                                </span>
                                            </Link>
                                        </li>
                                    );
                                })}
                            </ol>
                        </>
                    )}
                </section>
            )}
            <div className="h-6" aria-hidden="true" />

            <PersonPickerSheet open={picking != null} onClose={() => setPicking(null)} title={tm('choose_person')} treeId={treeId}
                excludeIds={[person1, person2].filter((id): id is number => id != null)}
                onPick={([p]) => {
                    const slot = picking;
                    setPicking(null);
                    if (!slot || p?.kind !== 'existing') return;
                    setPicked((m) => ({ ...m, [p.person.Id]: p.person }));
                    onPick(slot, p.person.Id);
                }} />
        </PageShell>
    );
}

function Slot({ person, label, treeId, onClick, divided = false }: { person: RelPerson | undefined; label: string; treeId: number | null; onClick: () => void; divided?: boolean }) {
    const tm = useTranslations('mobileRelationship');
    const tc = useTranslations('common');
    const name = person ? displayFullName(person) || tc('unknown') : null;
    return (
        <button type="button" onClick={onClick}
            className={`flex w-full items-center gap-3 min-h-[60px] px-4 py-[11px] text-left cursor-pointer active:bg-surface-2 focus-ring-inset ${divided ? 'border-t border-border' : ''}`}>
            {person && name ? (
                <PersonAvatar as="span" treeId={treeId} name={name} size={40} initials={getInitials(person.FirstName, person.LastName)}
                    sex={person.Sex ?? null} mediaId={person.PrimaryMediaId} focalX={person.FocalX} focalY={person.FocalY} focalRadius={person.FocalRadius} />
            ) : (
                <span aria-hidden="true" className="grid place-items-center w-10 h-10 shrink-0 rounded-full border-[1.5px] border-dashed border-text-muted text-text-muted">
                    <Plus className="w-[17px] h-[17px]" />
                </span>
            )}
            <span className="flex-1 min-w-0 grid gap-0.5">
                {name
                    ? <span className="serif text-md font-semibold truncate">{name}</span>
                    : <span className="text-base font-semibold text-link">{tm('choose_person')}</span>}
                <span className="text-meta text-text-muted truncate">
                    {label}
                    {(person?.BirthDate || person?.DeathDate) && <> · <Lifespan birth={person.BirthDate ?? null} death={person.DeathDate ?? null} /></>}
                </span>
            </span>
            <ChevronRight className="w-[18px] h-[18px] text-text-muted shrink-0" aria-hidden="true" />
        </button>
    );
}
