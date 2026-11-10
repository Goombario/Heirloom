'use client';

import { useCallback, useId, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { getDataClient } from '@/lib/data';
import type { Source } from '@/lib/data/types';
import type { CitedByRow } from '@/lib/db/queries/citations';
import type { PersonResult } from '@/lib/db/schema';
import { EVENT_TYPES, getEventDisplayType } from '@/lib/db/schema';
import { QUAY_LABEL_KEY, QUAY_VALUES } from '@/lib/citations/quay';
import { formatDateForDisplay } from '@/lib/date-utils';
import { useTree } from '@/app/contexts/TreeContext';
import { useLanguage } from '@/app/components/LanguageProvider';
import { useDateQualifierWords } from '@/app/components/date-input/aliases';
import { useErrorToast } from '@/app/components/useErrorToast';
import { PersonPickerSheet } from '@/app/components/PersonPickerSheet';
import { MobileListChip, MobileRow, cx, showChangeToast } from '@/app/components/ui';
import { Sheet } from '@/app/components/ui/Sheet';
import { Check, StickyNote } from '@/lib/icons';
import { familyMembers, familyOf } from '@/app/people/view/mobile/model';
import { useRelationLabel } from '@/app/people/view/mobile/panes';
import { citeKey, citeOnPersonFrom, preselectedKeys, sourceYear, type CiteOnPerson } from '../source-modal/citeOnFacts';

type Kin = PersonResult & { relation: string };

/**
 * Cite on, on phones (#1119): two steps. "Who's in it?" is the phone person picker,
 * ticking several; ticking someone shows their immediate family with the relation word
 * and a Tick all link. Then the facts sheet: checkboxes per person, facts dated in the
 * title's year ticked for you, facts already citing it dimmed, "All births" chips, and
 * a Page link per ticked fact. The page, certainty and transcription shared by every
 * fact sit in a bar pinned at the bottom, which opens the small "For every fact" sheet.
 */
export function CiteOnSheets({ open, source, citedBy, onClose, onCited }: {
    open: boolean;
    source: Source;
    citedBy: CitedByRow[];
    onClose: () => void;
    onCited: () => void;
}) {
    const t = useTranslations('mobileLibrary');
    const { activeTreeId } = useTree();
    const { reportError } = useErrorToast();
    const relationLabel = useRelationLabel();
    const [step, setStep] = useState<'people' | 'facts' | 'details'>('people');
    const [wasOpen, setWasOpen] = useState(open);
    const [loaded, setLoaded] = useState<Map<number, { person: CiteOnPerson; kin: Kin[]; given: string }>>(new Map());
    const [pickedIds, setPickedIds] = useState<number[]>([]);
    const [people, setPeople] = useState<CiteOnPerson[]>([]);
    const [ticked, setTicked] = useState<Set<string>>(new Set());
    const [rowPages, setRowPages] = useState<Record<string, string>>({});
    const [pageOpen, setPageOpen] = useState<Set<string>>(new Set());
    const [page, setPage] = useState('');
    const [quay, setQuay] = useState('');
    const [dataText, setDataText] = useState('');
    const [busy, setBusy] = useState(false);
    if (open !== wasOpen) {
        setWasOpen(open);
        if (open) {
            setStep('people'); setPickedIds([]); setPeople([]); setTicked(new Set()); setRowPages({}); setPageOpen(new Set());
            setPage(''); setQuay(''); setDataText('');
        }
    }

    const year = sourceYear(source.Title);
    const cited = useMemo(() => new Set(citedBy.map((r) => citeKey(r.factTable, r.factId))), [citedBy]);

    // Each ticked person loads once, with their facts and their immediate family.
    const loadPeople = useCallback(async (ids: number[]) => {
        setPickedIds(ids);
        const fresh = ids.filter((id) => !loaded.has(id));
        if (fresh.length === 0) return;
        try {
            const client = await getDataClient();
            const got = await Promise.all(fresh.map((id) => client.people.get(id, activeTreeId)));
            setLoaded((prev) => {
                const next = new Map(prev);
                for (const p of got) {
                    const kin = familyMembers(familyOf(p)).map((m): Kin => ({
                        Id: m.person.Id, FirstName: m.person.FirstName, LastName: m.person.LastName, Sex: m.person.Sex,
                        BirthDate: m.person.BirthDate, DeathDate: m.person.DeathDate,
                        PrimaryMediaId: (m.person as { PrimaryMediaId?: number }).PrimaryMediaId,
                        relation: relationLabel(m.relation, m.parentLink),
                    }));
                    next.set(p.Id, { person: citeOnPersonFrom(p), kin, given: (p.FirstName ?? '').trim() || citeOnPersonFrom(p).name });
                }
                return next;
            });
        } catch (e) {
            reportError(e);
        }
    }, [loaded, activeTreeId, relationLabel, reportError]);

    // The family of the ticked people, newest pick first, each person once.
    const related = useMemo(() => {
        const seen = new Set<number>();
        return [...pickedIds].reverse().flatMap((id) => {
            const l = loaded.get(id);
            if (!l) return [];
            const kin = l.kin.filter((k) => !seen.has(k.Id));
            kin.forEach((k) => seen.add(k.Id));
            return kin.length ? [{ key: String(id), label: t('family_of', { name: l.given }), people: kin }] : [];
        });
    }, [pickedIds, loaded, t]);

    const toFacts = async (ids: number[]) => {
        setBusy(true);
        try {
            const client = await getDataClient();
            const missing = ids.filter((id) => !loaded.has(id));
            const extra = await Promise.all(missing.map((id) => client.people.get(id, activeTreeId)));
            const byId = new Map([...loaded.entries()].map(([id, l]) => [id, l.person]));
            for (const p of extra) byId.set(p.Id, citeOnPersonFrom(p));
            const list = ids.map((id) => byId.get(id)).filter((p): p is CiteOnPerson => p != null);
            setPeople(list);
            setTicked((prev) => {
                const next = new Set([...prev].filter((k) => list.some((p) => p.facts.some((f) => f.key === k))));
                for (const p of list) for (const k of preselectedKeys(p, year, cited)) next.add(k);
                return next;
            });
            setStep('facts');
        } catch (e) {
            reportError(e);
        } finally {
            setBusy(false);
        }
    };

    const open1 = open && step === 'people';
    const openFacts = people.flatMap((p) => p.facts).filter((f) => !cited.has(f.key));
    const count = openFacts.filter((f) => ticked.has(f.key)).length;

    const submit = async () => {
        const facts = openFacts.filter((f) => ticked.has(f.key));
        if (facts.length === 0 || busy) return;
        setBusy(true);
        try {
            const client = await getDataClient();
            await client.citations.createMany({
                SourceId: source.Id,
                Page: page.trim() || null,
                Quay: quay || null,
                DataText: dataText.trim() || null,
                facts: facts.map((f) => ({ FactTable: f.factTable, FactId: f.factId, Page: rowPages[f.key]?.trim() || null })),
            }, activeTreeId);
            showChangeToast({ message: t('cited_on', { count: facts.length }) });
            onCited();
        } catch (e) {
            reportError(e);
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <PersonPickerSheet
                open={open1}
                onClose={onClose}
                title={t('whos_in_it')}
                treeId={activeTreeId}
                multiple
                onPickedChange={(ids) => { void loadPeople(ids); }}
                related={related}
                pickLabel={(n) => (n > 0 ? t('next_n', { count: n }) : t('next'))}
                onPick={(picked) => { void toFacts(picked.flatMap((p) => (p.kind === 'existing' ? [p.person.Id] : []))); }}
            />
            <FactsSheet
                open={open && step !== 'people'}
                people={people}
                cited={cited}
                ticked={ticked}
                setTicked={setTicked}
                rowPages={rowPages}
                setRowPages={setRowPages}
                pageOpen={pageOpen}
                setPageOpen={setPageOpen}
                page={page}
                quay={quay}
                dataText={dataText}
                count={count}
                busy={busy}
                onBack={() => setStep('people')}
                onClose={onClose}
                onSubmit={submit}
                onDetails={() => setStep('details')}
            >
                <DetailsSheet open={open && step === 'details'} page={page} setPage={setPage} quay={quay} setQuay={setQuay}
                    dataText={dataText} setDataText={setDataText} onDone={() => setStep('facts')} />
            </FactsSheet>
        </>
    );
}

function FactsSheet({ open, people, cited, ticked, setTicked, rowPages, setRowPages, pageOpen, setPageOpen, page, quay, dataText, count, busy, onBack, onClose, onSubmit, onDetails, children }: {
    open: boolean;
    people: CiteOnPerson[];
    cited: ReadonlySet<string>;
    ticked: Set<string>;
    setTicked: (fn: (prev: Set<string>) => Set<string>) => void;
    rowPages: Record<string, string>;
    setRowPages: (fn: (prev: Record<string, string>) => Record<string, string>) => void;
    pageOpen: Set<string>;
    setPageOpen: (fn: (prev: Set<string>) => Set<string>) => void;
    page: string;
    quay: string;
    dataText: string;
    count: number;
    busy: boolean;
    onBack: () => void;
    onClose: () => void;
    onSubmit: () => void;
    onDetails: () => void;
    children: React.ReactNode;
}) {
    const t = useTranslations('mobileLibrary');
    const tl = useTranslations('library');
    const tTypes = useTranslations('eventTypes');
    const { language } = useLanguage();
    const words = useDateQualifierWords();
    const ids = useId();
    const typeLabel = (type: string) => (EVENT_TYPES[type] ? tTypes(type as Parameters<typeof tTypes>[0]) : getEventDisplayType(type));
    const open1 = people.flatMap((p) => p.facts).filter((f) => !cited.has(f.key));
    const types = [...new Set(open1.map((f) => f.type))];
    const toggle = (key: string) => setTicked((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });
    const toggleType = (type: string) => {
        const keys = open1.filter((f) => f.type === type).map((f) => f.key);
        const allOn = keys.every((k) => ticked.has(k));
        setTicked((prev) => { const n = new Set(prev); for (const k of keys) { if (allOn) n.delete(k); else n.add(k); } return n; });
    };
    const summary = [page.trim() && <span key="p" className="font-mono font-medium">{page.trim()}</span>, quay && tl(`certainty_short_${quay}`), dataText.trim() && t('transcribed')].filter(Boolean);

    return (
        <Sheet open={open} onClose={onClose} title={t('facts')} size="full" onBack={onBack} backKeepsChanges
            onSave={onSubmit} saveLabel={count > 0 ? t('cite_n', { count }) : t('cite')} saveDisabled={busy || count === 0} saveWhenClean dirty={count > 0}>
            {people.length > 1 && types.length > 1 && (
                <div className="hscroll-strip flex gap-1.5 overflow-x-auto -mx-4 px-4 pb-2" role="group" aria-label={tl('cite_on_tick_every')}>
                    {types.map((type) => {
                        const keys = open1.filter((f) => f.type === type).map((f) => f.key);
                        return <MobileListChip key={type} active={keys.every((k) => ticked.has(k))} label={t('all_of_type', { type: typeLabel(type) })} onClick={() => toggleType(type)} />;
                    })}
                </div>
            )}
            <div className="-mx-4 pb-24">
                {people.map((p) => (
                    <section key={p.id} aria-labelledby={`${ids}-${p.id}`}>
                        <h3 id={`${ids}-${p.id}`} className="eyebrow m-0 px-4 pt-4 pb-1">{p.name}</h3>
                        {p.facts.length === 0 && <p className="m-0 px-4 py-2 text-sm text-text-muted">{tl('cite_on_no_facts')}</p>}
                        {p.facts.map((f) => {
                            const done = cited.has(f.key);
                            const on = done || ticked.has(f.key);
                            const own = rowPages[f.key]?.trim();
                            return (
                                <div key={f.key}>
                                    <div className={cx('flex items-center gap-3 min-h-12 px-4 py-1', done && 'opacity-55')}>
                                        <button type="button" role="checkbox" aria-checked={on} aria-disabled={done || undefined} disabled={done}
                                            onClick={() => toggle(f.key)}
                                            className="flex flex-1 min-w-0 items-center gap-3 min-h-11 text-left cursor-pointer disabled:cursor-default focus-ring-inset rounded-md">
                                            <span aria-hidden="true" className={cx('grid place-items-center w-[22px] h-[22px] shrink-0 rounded-md border-2', on ? 'bg-text border-text text-card' : 'border-text-muted text-transparent')}>
                                                <Check className="w-3.5 h-3.5" strokeWidth={3} />
                                            </span>
                                            <span className="flex-1 min-w-0 grid gap-px">
                                                <span className="text-base font-semibold text-text">{typeLabel(f.type)}</span>
                                                <span className="text-meta text-text-muted truncate">
                                                    {f.date && <span className="date-mono">{formatDateForDisplay(f.date, language, words)}</span>}
                                                    {f.date && f.place && ' · '}{f.place}
                                                </span>
                                            </span>
                                        </button>
                                        {done ? <span className="text-meta text-text-muted">{t('already_cited')}</span> : on && (
                                            <button type="button" onClick={() => setPageOpen((prev) => { const n = new Set(prev); if (n.has(f.key)) n.delete(f.key); else n.add(f.key); return n; })}
                                                aria-expanded={pageOpen.has(f.key)}
                                                className={cx('min-h-11 px-0.5 text-sm cursor-pointer rounded focus-ring', own ? 'font-mono text-text-secondary' : page.trim() ? 'font-mono text-text-muted' : 'font-medium text-link')}>
                                                {own || page.trim() || t('page')}
                                            </button>
                                        )}
                                    </div>
                                    {on && !done && pageOpen.has(f.key) && (
                                        <div className="pl-[50px] pr-4 pb-2">
                                            <input value={rowPages[f.key] ?? ''} onChange={(e) => setRowPages((prev) => ({ ...prev, [f.key]: e.target.value }))}
                                                placeholder={page.trim() || t('page_or_line')} aria-label={t('page_for', { fact: typeLabel(f.type), name: p.name })}
                                                autoComplete="off" className="w-full h-10 rounded-[10px] border border-border bg-surface px-3 font-mono text-md text-text input-nozoom focus-ring" />
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </section>
                ))}
            </div>
            <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-card shadow-[0_-6px_16px_rgba(0,0,0,0.06)]"
                style={{ paddingBottom: 'calc(6px + env(safe-area-inset-bottom, 0px))' }}>
                <MobileRow icon={<StickyNote />} end="chevron" onClick={onDetails}
                    label={summary.length ? <>{summary.map((s, i) => <span key={i}>{i > 0 && ' · '}{s}</span>)}</> : t('shared_details')}
                    sub={summary.length ? t('for_every_fact') : t('for_every_fact_optional')} />
            </div>
            {children}
        </Sheet>
    );
}

function DetailsSheet({ open, page, setPage, quay, setQuay, dataText, setDataText, onDone }: {
    open: boolean; page: string; setPage: (v: string) => void; quay: string; setQuay: (v: string) => void;
    dataText: string; setDataText: (v: string) => void; onDone: () => void;
}) {
    const t = useTranslations('mobileLibrary');
    const tl = useTranslations('library');
    const ids = useId();
    const field = 'w-full rounded-[10px] border border-border bg-surface px-3 text-md text-text placeholder:text-text-muted input-nozoom focus-ring';
    return (
        <Sheet open={open} onClose={onDone} title={t('for_every_fact_title')} onBack={onDone} backKeepsChanges onSave={onDone} saveLabel={t('done')} saveWhenClean>
            <div className="grid gap-4 pt-1">
                <label className="grid gap-1.5" htmlFor={`${ids}-page`}>
                    <span className="text-meta font-semibold text-text-secondary">{t('page_or_line')}</span>
                    <input id={`${ids}-page`} value={page} onChange={(e) => setPage(e.target.value)} autoComplete="off" placeholder="p. 12" className={cx(field, 'h-11 font-mono')} />
                    <span className="text-meta text-text-muted">{t('own_page_kept')}</span>
                </label>
                <div className="grid gap-2">
                    <span id={`${ids}-quay`} className="text-meta font-semibold text-text-secondary">{tl('field_certainty')}</span>
                    <div role="group" aria-labelledby={`${ids}-quay`} className="flex flex-wrap gap-x-1.5 gap-y-2.5">
                        {QUAY_VALUES.map((v) => (
                            <MobileListChip key={v} active={quay === v} label={tl(`certainty_short_${v}`)} title={tl(QUAY_LABEL_KEY[v])}
                                onClick={() => setQuay(quay === v ? '' : v)} />
                        ))}
                    </div>
                </div>
                <label className="grid gap-1.5" htmlFor={`${ids}-data`}>
                    <span className="text-meta font-semibold text-text-secondary">{tl('field_transcription')}</span>
                    <textarea id={`${ids}-data`} rows={4} value={dataText} onChange={(e) => setDataText(e.target.value)}
                        placeholder={t('passage_ph')} className={cx(field, 'py-2.5 leading-normal resize-none')} />
                </label>
            </div>
        </Sheet>
    );
}
