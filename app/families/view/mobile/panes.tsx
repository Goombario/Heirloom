'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { OwnerGalleryMedia, SpouseRelation } from '@/lib/db/schema';
import type { Note } from '@/lib/data/types';
import { formatDateForDisplay, formatYearOrEmpty, sortableYear } from '@/lib/date-utils';
import { livingStatus } from '@/lib/living';
import { getInitials } from '@/lib/utils/initials';
import { displayFullName } from '@/lib/utils/names';
import type { CitationFactDescriptor } from '@/app/components/citations/types';
import { groupCitationFactsBySource, type SourceNumbers } from '@/app/components/citations/factDescriptors';
import { useTimelineMarks, type DataCheckMarks } from '@/app/components/data-checks/marks';
import { useDateQualifierWords } from '@/app/components/date-input/aliases';
import { familyEventLabel } from '@/app/components/familyEventTypes';
import MediaGallery from '@/app/components/media/MediaGallery';
import PersonAvatar from '@/app/components/PersonAvatar';
import { Badge, CopperPill, Lifespan, MobileRow, citeClass, cx } from '@/app/components/ui';
import { mediaFactLabel } from '@/app/components/media/mediaFactLabel';
import { WarningDot } from '@/app/components/ui/DatesToCheckFlag';
import { Camera, HeartCrack, Pencil, Plus } from '@/lib/icons';
import { Empty, Head, HeadLink, PanelRow, Quiet, Section } from '@/app/people/view/mobile/panes';
import { noteDate } from '@/app/people/view/mobile/ProfileSheets';
import { FACT_TABLES } from '@/lib/db/fact-tables';
import type { PartnerPerson } from '../useFamilyDetail';
import { calcAgeAtDeath, childRelationshipTags, partnerName, partnerShortName } from '../derive';
import {
    endingOf, kindKey, partnersOf, sourcingFacts, startKey, timelineRows, togetherOf,
    type PhoneFamily, type Slot, type TimelineRow,
} from './model';
import type { FamilyEventFlow, FamilyEventFocus } from './FamilyEventSheet';
import { librarySourceHref } from '@/app/library/links';

/** Who is looking: the panes draw edit affordances for editors and contributors only. */
export type FamilyRole = 'viewer' | 'contributor' | 'editor';

/** One partner's other families, for Other partnerships. */
export interface OtherPartnerships {
    slot: Slot;
    partner: PartnerPerson;
    spouses: SpouseRelation[];
}

export interface FamilyPaneContext {
    data: PhoneFamily;
    others: OtherPartnerships[];
    notes: Note[];
    /** Null while loading. */
    media: OwnerGalleryMedia[] | null;
    /** Every citable fact on the page, in page order (numbers the chips). */
    facts: CitationFactDescriptor[];
    sourceNumbers: SourceNumbers;
    marks: DataCheckMarks;
    treeId: number | null;
    role: FamilyRole;
    language: string;
    /** A fact's citation chips; for an editor, "No source" when it has none. */
    citePins: (fact: { factTable: string; factId: number }, label: string) => React.ReactNode;
    onCite: (fact: { factTable: string; factId: number }, label: string) => void;
    /** Open a family event sheet: the start, the end, the Add event chooser, or one event. */
    onEvent: (flow: FamilyEventFlow) => void;
    onAddPartner: (slot: Slot) => void;
    onAddChild: () => void;
    onEditChildren: () => void;
    /** A note's sheet, or Add note with null. */
    onNote: (note: Note | null) => void;
    onAddMedia: () => void;
    onMediaChanged: () => void;
    /** Take a photo off this family (it stays in the library). */
    onUnlinkMedia: (mediaId: number) => void;
    /** The row or cell just changed, which flashes amber once. */
    flash: string | null;
}

const canEdit = (c: FamilyPaneContext) => c.role !== 'viewer';
const town = (place: string | null | undefined) => place?.split(',')[0]?.trim() || '';

function useFormat(c: FamilyPaneContext) {
    const words = useDateQualifierWords();
    return {
        date: (d: string | null | undefined) => (d ? formatDateForDisplay(d, c.language, words) : ''),
        year: (d: string | null | undefined) => formatYearOrEmpty(d ?? null),
    };
}

/** A family event type's shown name; a custom type is its own name. */
export function useFamilyEventLabel() {
    const te = useTranslations('eventEdit');
    return (type: string) => familyEventLabel(type, te);
}

/* ── Person rows ──────────────────────────────────────────────────────────── */

/** A partner or child: always opens their page (↗). */
function PersonRow({ person, sub, divided, treeId, flash }: { person: PartnerPerson; sub?: React.ReactNode; divided?: boolean; treeId: number | null; flash?: boolean }) {
    const t = useTranslations('mobilePerson');
    const name = partnerName(person) || t('unknown');
    return (
        <MobileRow
            href={`/people/view?id=${person.Id}`}
            end="leave"
            divided={divided}
            className={cx(flash && 'mp-flash')}
            lead={(
                <PersonAvatar as="span" size={36} treeId={treeId} name={name} initials={getInitials(person.FirstName, person.LastName)} sex={person.Sex}
                    mediaId={person.PrimaryMediaId} focalX={person.FocalX} focalY={person.FocalY} focalRadius={person.FocalRadius} />
            )}
            label={<span className="serif font-semibold text-md">{name}</span>}
            sub={(
                <span>
                    {(person.BirthDate || person.DeathDate) && (
                        <span className="font-mono"><Lifespan birth={person.BirthDate} death={person.DeathDate} status={livingStatus(person)} /></span>
                    )}
                    {sub && (person.BirthDate || person.DeathDate) && ' · '}
                    {sub}
                </span>
            )}
        />
    );
}

/* ── Vitals strip ─────────────────────────────────────────────────────────── */

interface CellSpec {
    key: string;
    label: string;
    value: React.ReactNode;
    sub: string;
    /** The panel under the strip, or null for a cell that doesn't open. */
    panel: React.ReactNode | null;
    marked?: boolean;
    /** Tapping adds instead of opening a panel (an editor's empty Married). */
    onAdd?: () => void;
}

function VitalsStrip({ c }: { c: FamilyPaneContext }) {
    const t = useTranslations('familyPhone');
    const tp = useTranslations('mobilePerson');
    const tf = useTranslations('mobileFamily');
    const td = useTranslations('dataChecks');
    const te = useTranslations('mobileEvents');
    const f = useFormat(c);
    const [open, setOpen] = useState<number | null>(null);
    const { family } = c.data;
    const editor = canEdit(c);
    const type = family.Type ?? 'Unknown';
    const ending = endingOf(c.data);
    const together = togetherOf(c.data);
    const unk = <span className="italic text-text-muted">{tp('not_recorded')}</span>;
    const factOf = (factTable: string, factId: number) => c.facts.find((x) => x.factTable === factTable && x.factId === factId);
    const marksFor = (key: string) => c.marks.byFact.get(key) ?? [];

    const value = (text: string, tone: 'date' | 'plain' | 'word' | 'dim' = 'date') => (
        <span className={cx(
            tone === 'word' ? 'text-base font-semibold text-text' : 'font-mono text-md font-medium',
            tone === 'date' && 'text-[color:var(--color-date)]', tone === 'plain' && 'text-text', tone === 'dim' && 'text-text-muted',
        )}>{text}</span>
    );

    // An editor's source row lists the citations as plain numbers (a chip can't sit
    // inside the row's button); a viewer's keeps the chips, which open the source.
    const sources = (facts: { factTable: string; factId: number }[], label: string, onClick?: () => void) => {
        const cites = facts.flatMap((x) => factOf(x.factTable, x.factId)?.citations ?? []);
        if (onClick) {
            return (
                <PanelRow label={tp('row_source')} onClick={onClick}>
                    {cites.length > 0 ? (
                        <span className="grid gap-0.5">
                            {cites.map((x) => (
                                <span key={x.Id} className="flex items-start gap-1.5">
                                    <span className={cx(citeClass(), 'shrink-0 mt-px')}>{c.sourceNumbers.get(x.SourceId)}</span>
                                    <span className="min-w-0">{x.sourceTitle ?? te('source_fallback')}</span>
                                </span>
                            ))}
                        </span>
                    ) : <span className="italic text-text-muted">{tp('none_cited')}</span>}
                </PanelRow>
            );
        }
        return (
            <PanelRow label={tp('row_source')}>
                {cites.length > 0
                    // The first fact's pins carry the rest (a marriage's imported MARR citations ride the family's).
                    ? <span className="inline-flex flex-wrap gap-1">{c.citePins(facts[0], label)}</span>
                    : <span className="italic text-text-muted">{tp('none_cited')}</span>}
            </PanelRow>
        );
    };
    const checks = (keys: string[]) => {
        const entries = keys.flatMap(marksFor);
        if (entries.length === 0) return null;
        return (
            <div className="grid gap-1 mt-2 text-sm">
                {entries.map((e) => <p key={e.id} className="m-0 font-semibold text-warning-text">{c.marks.text.sentence(e)}</p>)}
                <Link href={`/data-checks?entry=${encodeURIComponent(entries[0].id)}`} className="text-sm text-link underline">{td('open_in_data_checks')}</Link>
            </div>
        );
    };

    /* Married / Started */
    const kind = t(`kind_${kindKey(type)}`);
    const startKeys = [`${FACT_TABLES.FAMILIES}:${family.Id}`, `${FACT_TABLES.FAMILY_MARRIAGE}:${family.Id}`];
    const startFacts = [{ factTable: FACT_TABLES.FAMILIES, factId: family.Id }, { factTable: FACT_TABLES.FAMILY_MARRIAGE, factId: family.Id }];
    const startRow = (label: string, focus: FamilyEventFocus, v: React.ReactNode) => (editor
        ? <PanelRow key={label} label={label} onClick={() => c.onEvent({ kind: 'start', focus })}>{v}</PanelRow>
        : <PanelRow key={label} label={label}>{v}</PanelRow>);
    const hasStart = Boolean(family.MarriageDate || family.MarriagePlace);
    const married: CellSpec = hasStart ? {
        key: 'start',
        label: tf(startKey(type)),
        value: value(f.year(family.MarriageDate) || tp('unknown'), family.MarriageDate ? 'date' : 'word'),
        sub: town(family.MarriagePlace) || tp('place_unknown'),
        marked: startKeys.some((k) => marksFor(k).length > 0),
        panel: (
            <>
                <div className="eyebrow mb-1">{kind}</div>
                {startRow(t('row_type'), 'type', tf(`ftype_${ftypeKey(type)}`))}
                {startRow(tp('row_date'), 'date', family.MarriageDate ? <span className="date-mono">{f.date(family.MarriageDate)}</span> : unk)}
                {startRow(tp('row_place'), 'place', family.MarriagePlace || unk)}
                {sources(startFacts, kind, editor ? () => c.onEvent({ kind: 'start', focus: 'sources' }) : undefined)}
                {checks(startKeys)}
                {editor && (
                    <MobileRow icon={<Pencil />} label={t(type === 'Marriage' ? 'edit_marriage' : 'edit_partnership')} end="chevron"
                        onClick={() => c.onEvent({ kind: 'start' })} className="!px-0 mt-1.5" />
                )}
            </>
        ),
    } : {
        key: 'start',
        label: tf(startKey(type)),
        value: editor ? <span className="text-base font-semibold text-link">{tp('add')}</span> : value(tp('unknown'), 'dim'),
        sub: tp('date_and_place'),
        panel: null,
        onAdd: editor ? () => c.onEvent({ kind: 'start', focus: 'date' }) : undefined,
    };

    /* Ended */
    const both = Boolean(c.data.partner1 && c.data.partner2);
    const recordEnd = (sub?: string) => editor && (
        <MobileRow divided icon={<HeartCrack />} label={t('record_end')} sub={sub} end="chevron" onClick={() => c.onEvent({ kind: 'end' })} className="!px-0 mt-2" />
    );
    let ended: CellSpec;
    if (ending?.kind === 'event') {
        const ev = ending.event;
        const endKey = `${FACT_TABLES.EVENTS}:${ev.Id}`;
        const endRow = (label: string, focus: FamilyEventFocus, v: React.ReactNode) => (editor
            ? <PanelRow key={label} label={label} onClick={() => c.onEvent({ kind: 'end', focus })}>{v}</PanelRow>
            : <PanelRow key={label} label={label}>{v}</PanelRow>);
        ended = {
            key: 'end',
            label: t('ended'),
            value: value(f.year(ev.Date) || '?', ev.Date ? 'date' : 'word'),
            sub: [town(ev.Place), t(`reason_${ending.reason}`)].filter(Boolean).join(' · '),
            marked: marksFor(endKey).length > 0,
            panel: (
                <>
                    <div className="eyebrow mb-1">{t('how_it_ended')}</div>
                    {endRow(t('row_reason'), 'type', t(`reason_${ending.reason}`))}
                    {endRow(tp('row_date'), 'date', ev.Date ? <span className="date-mono">{f.date(ev.Date)}</span> : unk)}
                    {endRow(tp('row_place'), 'place', ev.Place || unk)}
                    {sources([{ factTable: FACT_TABLES.EVENTS, factId: ev.Id }], t(`reason_${ending.reason}`), editor ? () => c.onEvent({ kind: 'end', focus: 'sources' }) : undefined)}
                    {checks([endKey])}
                    {editor && (
                        <MobileRow icon={<Pencil />} label={t(`edit_${ending.reason}`)} end="chevron" onClick={() => c.onEvent({ kind: 'end' })} className="!px-0 mt-1.5" />
                    )}
                </>
            ),
        };
    } else if (ending?.kind === 'death') {
        const who = partnerShortName(ending.partner) || tp('unknown');
        ended = {
            key: 'end',
            label: t('ended'),
            value: value(f.year(ending.date) || '?'),
            sub: t('death_of_short', { name: who }),
            panel: (
                <>
                    <div className="eyebrow mb-1">{t('how_it_ended')}</div>
                    {/* The death is the partner's own record: the row leaves for their page. */}
                    <Link href={`/people/view?id=${ending.partner.Id}`}
                        className="grid grid-cols-[82px_1fr] gap-2 py-[3px] w-[calc(100%+16px)] -mx-2 px-2 rounded-md text-base leading-snug text-text no-underline active:bg-[color:var(--surface)] focus-ring-inset">
                        <span className="text-meta text-text-muted pt-px">{t('row_reason')}</span>
                        <span className="min-w-0">{t('death_of', { name: partnerName(ending.partner) || who })} <span aria-hidden="true" className="text-text-muted">↗</span></span>
                    </Link>
                    <PanelRow label={tp('row_date')}>{ending.date ? <span className="date-mono">{f.date(ending.date)}</span> : unk}</PanelRow>
                    <p className="m-0 mt-1.5 text-sm text-text-muted">{t('derived_note', { name: who })}</p>
                    {recordEnd(t('record_end_over'))}
                </>
            ),
        };
    } else {
        ended = {
            key: 'end',
            label: t('ended'),
            value: value('—', 'dim'),
            sub: both ? tp('not_recorded') : t('needs_both'),
            panel: editor && both ? (
                <>
                    <div className="eyebrow mb-1">{t('how_it_ended')}</div>
                    <p className="m-0 text-sm text-text-muted">{t('nothing_ended')}</p>
                    {recordEnd()}
                </>
            ) : null,
        };
    }

    /* Together */
    const [a1, a2] = together.ages;
    const startWord = type === 'Marriage' ? 'marriage' : 'other';
    let togetherSub: string;
    if (together.years != null) {
        const missing = [c.data.partner1, c.data.partner2].find((p, i) => p && together.ages[i] == null);
        togetherSub = a1 != null && a2 != null ? t('ages_at_start', { a: a1, b: a2, type: startWord })
            : missing ? t('age_unknown', { name: partnerShortName(missing) || tp('unknown') }) : '';
    } else {
        togetherSub = family.MarriageDate && sortableYear(family.MarriageDate) != null ? t('needs_end') : t('needs_start', { type: startWord });
    }
    const togetherCell = (
        <div className="grid gap-0.5 content-start min-w-0 pt-3.5 pb-[13px] pl-3.5 pr-2.5 border-l border-border">
            <span className="eyebrow">{t('together')}</span>
            {together.years != null
                ? <span className="font-mono text-md font-medium text-text">{together.approx ? '~' : ''}{together.years} <small className="text-meta">{t('yrs')}</small></span>
                : value('—', 'dim')}
            <span className="text-xs leading-snug text-text-secondary">{togetherSub}</span>
        </div>
    );

    const cells = [married, ended];
    return (
        <div className="border-b border-border">
            <div className="grid grid-cols-3">
                {cells.map((cell, i) => {
                    const on = open === i;
                    const flash = c.flash === `cell-${cell.key}`;
                    const tappable = cell.onAdd != null || cell.panel != null;
                    const body = (
                        <>
                            <span className="eyebrow inline-flex items-center gap-1.5">
                                {cell.label}
                                {cell.marked && <><WarningDot /><span className="sr-only">{td('mark_label')}</span></>}
                                {cell.panel != null && <span aria-hidden="true" className={cx('inline-block w-1.5 h-1.5 border-r-[1.5px] border-b-[1.5px] border-text-muted transition-transform motion-reduce:transition-none', on ? 'rotate-[-135deg] translate-y-[2px]' : 'rotate-45 -translate-y-[1px]')} />}
                            </span>
                            {cell.value}
                            <span className={cx('text-xs leading-snug', cell.sub === tp('not_recorded') || cell.sub === t('needs_both') ? 'italic text-text-muted' : 'text-text-secondary')}>{cell.sub}</span>
                        </>
                    );
                    const cls = cx('grid gap-0.5 content-start min-w-0 text-left pt-3.5 pb-[13px] pr-2.5',
                        i === 0 ? 'pl-4' : 'pl-3.5 border-l border-border', on && 'bg-surface-2', flash && 'mp-flash');
                    return tappable ? (
                        <button key={`${cell.key}-${flash ? 'flash' : ''}`} type="button" aria-expanded={cell.onAdd ? undefined : on}
                            onClick={cell.onAdd ?? (() => setOpen(on ? null : i))}
                            className={cx(cls, 'cursor-pointer focus-ring-inset transition-colors', !on && 'active:bg-surface-2')}>
                            {body}
                        </button>
                    ) : (
                        <div key={cell.key} className={cls}>{body}</div>
                    );
                })}
                {togetherCell}
            </div>
            {open != null && cells[open]?.panel && (
                <div className="grid gap-0.5 px-4 pt-3 pb-2.5 bg-surface-2 border-t border-border">
                    {cells[open].panel}
                </div>
            )}
        </div>
    );
}

/** The `mobileFamily.ftype_*` key for a partnership type. */
export function ftypeKey(type: string): 'marriage' | 'civil_union' | 'common_law' | 'other' | 'unknown' {
    return type === 'Marriage' ? 'marriage' : type === 'Civil union' ? 'civil_union' : type === 'Common-law' ? 'common_law' : type === 'Other' ? 'other' : 'unknown';
}

/* ── Overview ─────────────────────────────────────────────────────────────── */

/** What a child row says about their link: "Adopted", "Stepchild of Tom" (#982). */
export function useChildLinkText(data: Pick<PhoneFamily, 'partner1' | 'partner2'>) {
    const tf = useTranslations('editFamily');
    return (child: PartnerPerson) => childRelationshipTags(child, data.partner1, data.partner2)
        .map((tag) => (tag.name ? tf(`rel_of_${tag.type.toLowerCase()}`, { name: tag.name }) : tf(`rel_${tag.type.toLowerCase()}`)))
        .join(' · ');
}

export function OverviewPane({ c }: { c: FamilyPaneContext }) {
    const t = useTranslations('familyPhone');
    const tp = useTranslations('mobilePerson');
    const tm = useTranslations('mobileProfile');
    const editor = canEdit(c);
    const { data } = c;
    const linkText = useChildLinkText(data);
    const othersCount = (slot: Slot) => c.others.find((o) => o.slot === slot)?.spouses.length ?? 0;
    const partners = partnersOf(data);
    const missing: Slot | null = !data.partner1 ? 'partner1' : !data.partner2 ? 'partner2' : null;
    const when = (n: Note) => noteDate(n, c.language);

    return (
        <>
            <VitalsStrip c={c} />

            <Section first>
                <Head title={t('partners')} />
                {partners.map(({ slot, person }, i) => (
                    <PersonRow key={person.Id} person={person} treeId={c.treeId} divided={i > 0} flash={c.flash === `person-${person.Id}`}
                        sub={othersCount(slot) > 0 ? t('other_partnerships_count', { count: othersCount(slot) }) : undefined} />
                ))}
                {partners.length === 0 && !editor && <p className="m-0 px-4 pb-1 text-base italic text-text-muted">{t('no_partners')}</p>}
                {missing && editor && (
                    <MobileRow divided={partners.length > 0} icon={<Plus />} label={t('add_partner')} end="chevron" onClick={() => c.onAddPartner(missing)} />
                )}
            </Section>

            <Section>
                <Head title={t('children')} count={data.children.length} />
                {data.children.map((k, i) => {
                    const age = calcAgeAtDeath(k.BirthDate, k.DeathDate);
                    const sub = [linkText(k), age != null && age < 18 ? t('died_aged', { age }) : null].filter(Boolean).join(' · ');
                    return <PersonRow key={k.Id} person={k} treeId={c.treeId} divided={i > 0} sub={sub || undefined} flash={c.flash === `person-${k.Id}`} />;
                })}
                {data.children.length === 0 && !editor && <p className="m-0 px-4 pb-1 text-base text-text-muted">{t('no_children')}</p>}
                {editor && (
                    <>
                        <MobileRow divided={data.children.length > 0} icon={<Plus />} label={t('add_child')} end="chevron" onClick={c.onAddChild} />
                        {data.children.length > 0 && <MobileRow divided icon={<Pencil />} label={t('edit_children')} end="chevron" onClick={c.onEditChildren} />}
                    </>
                )}
            </Section>

            {c.others.some((o) => o.spouses.length > 0) && (
                <Section>
                    <Head title={t('other_partnerships')} />
                    {c.others.filter((o) => o.spouses.length > 0).map((o) => (
                        <div key={o.slot}>
                            <p className="m-0 px-4 pt-1 text-meta font-semibold text-text-secondary">{partnerShortName(o.partner) || tp('unknown')}</p>
                            {o.spouses.map((s, i) => {
                                const other = s.person;
                                const name = other ? displayFullName(other) || tp('unknown') : t('partner_unknown');
                                const years = formatYearOrEmpty(s.family.MarriageDate);
                                return (
                                    <MobileRow key={s.family.Id} href={`/families/view?id=${s.family.Id}`} end="leave" divided={i > 0}
                                        lead={other
                                            ? <PersonAvatar as="span" size={36} treeId={c.treeId} name={name} initials={getInitials(other.FirstName, other.LastName)} sex={other.Sex} />
                                            : <span aria-hidden="true" className="w-9 h-9 shrink-0 rounded-full mf-hatch" />}
                                        label={<span className="serif font-semibold text-md">{t('with_partner', { name })}</span>}
                                        sub={[years ? tp('married_short', { date: years }) : null, t('children_count', { count: s.children.length })].filter(Boolean).join(' · ')} />
                                );
                            })}
                        </div>
                    ))}
                </Section>
            )}

            {(editor || c.notes.length > 0) && (
                <Section>
                    <Head title={tp('notes')} count={c.notes.length} />
                    {c.notes.map((n, i) => {
                        const body = (
                            <>
                                <span className="text-base leading-normal text-text line-clamp-2">{n.Text}</span>
                                {when(n) && <span className="text-meta text-text-muted">{when(n)}</span>}
                            </>
                        );
                        const cls = cx('grid gap-[3px] w-full px-4 py-[11px] text-left', i > 0 && 'border-t border-border');
                        return editor
                            ? <button key={n.Id} type="button" onClick={() => c.onNote(n)} aria-label={tm('note')} className={cx(cls, 'cursor-pointer active:bg-surface-2 focus-ring-inset')}>{body}</button>
                            : <div key={n.Id} className={cls}>{body}</div>;
                    })}
                    {c.notes.length === 0 && <p className="m-0 px-4 pb-1 text-base text-text-muted">{tp('no_notes')}</p>}
                    {editor && <MobileRow divided icon={<Plus />} label={tp('add_note')} end="chevron" onClick={() => c.onNote(null)} />}
                </Section>
            )}
        </>
    );
}

/* ── Timeline ─────────────────────────────────────────────────────────────── */

/** A timeline row's title and its muted "who". */
function useRowTitle(data: PhoneFamily) {
    const t = useTranslations('familyPhone');
    const tf = useTranslations('mobileFamily');
    const tp = useTranslations('mobilePerson');
    const label = useFamilyEventLabel();
    const first = (p: PartnerPerson | undefined) => (p ? partnerShortName(p) || tp('unknown') : tp('unknown'));
    return (row: TimelineRow): { title: string; who: string } => {
        switch (row.kind) {
            case 'start': {
                const type = data.family.Type ?? 'Unknown';
                return { title: tf(startKey(type)), who: type !== 'Marriage' && type !== 'Unknown' ? tf(`ftype_${ftypeKey(type)}`) : '' };
            }
            case 'event': return { title: label(row.type ?? ''), who: row.detail ?? '' };
            case 'child-birth': return { title: t('birth'), who: first(row.person) };
            case 'child-adoption': return { title: label('ADOP'), who: first(row.person) };
            case 'child-death': {
                const age = row.person ? calcAgeAtDeath(row.person.BirthDate, row.person.DeathDate) : null;
                return { title: t('death'), who: age != null ? t('who_aged', { name: first(row.person), age }) : first(row.person) };
            }
            case 'derived-end': return { title: t('partnership_ended'), who: t('death_of_short', { name: first(row.person) }) };
        }
    };
}

export function TimelinePane({ c }: { c: FamilyPaneContext }) {
    const t = useTranslations('familyPhone');
    const tp = useTranslations('mobilePerson');
    const te = useTranslations('mobileEvents');
    const f = useFormat(c);
    const markRow = useTimelineMarks(c.marks);
    const titleOf = useRowTitle(c.data);
    const editor = canEdit(c);
    const rows = timelineRows(c.data);
    const ending = endingOf(c.data);

    if (rows.length === 0) {
        return editor
            ? <Empty title={t('no_events_title')} body={t('no_events_body')}><CopperPill icon={<Plus />} onClick={() => c.onEvent({ kind: 'choose' })}>{tp('add_event')}</CopperPill></Empty>
            : <Quiet>{t('no_events')}</Quiet>;
    }

    /** What a tap on the row does: an editor's sheet, or the person's page. */
    const open = (row: TimelineRow): { href?: string; onClick?: () => void } => {
        if (row.kind === 'child-birth' || row.kind === 'child-adoption' || row.kind === 'child-death' || row.kind === 'derived-end') return { href: `/people/view?id=${row.person!.Id}` };
        if (!editor) return {};
        if (row.kind === 'start') return { onClick: () => c.onEvent({ kind: 'start' }) };
        const ev = row.event!;
        if (ending?.kind === 'event' && ending.event.Id === ev.Id) return { onClick: () => c.onEvent({ kind: 'end' }) };
        return { onClick: () => c.onEvent({ kind: 'edit', event: ev }) };
    };

    return (
        <Section first>
            <Head title={t('timeline')} count={rows.length} action={editor ? <HeadLink label={tp('add_event')} onClick={() => c.onEvent({ kind: 'choose' })} /> : undefined} />
            <ol className="list-none m-0 p-0 relative before:absolute before:left-[62px] before:top-2.5 before:bottom-2.5 before:w-px before:bg-border">
                {rows.map((row) => {
                    const { title, who } = titleOf(row);
                    const go = open(row);
                    const factKey = row.fact ? `${row.fact.factTable}:${row.fact.factId}` : '';
                    const marked = row.kind === 'start' || row.kind === 'event' ? markRow(factKey) : {};
                    const vital = row.kind === 'start' || row.kind === 'derived-end' || (row.kind === 'event' && ending?.kind === 'event' && ending.event.Id === row.event?.Id);
                    const child = row.kind === 'child-birth' || row.kind === 'child-adoption' || row.kind === 'child-death';
                    const sub = row.kind === 'derived-end' ? t('worked_out') : row.place;
                    const label = [title, who].filter(Boolean).join(' · ');
                    return (
                        <li key={`${row.key}-${c.flash === row.key ? 'flash' : ''}`}
                            className={cx('relative grid grid-cols-[40px_1fr] gap-x-[18px] px-4 py-[9px]', marked.flagged && 'bg-warning-bg/40', (go.href || go.onClick) && 'active:bg-surface-2', c.flash === row.key && 'mp-flash')}>
                            {/* The whole row is the tap; pins and the data-check callout sit above it. */}
                            {go.onClick && (
                                <button type="button" onClick={go.onClick} aria-label={te('edit_fact', { fact: title })}
                                    className="absolute inset-0 w-full cursor-pointer bg-transparent focus-ring-inset" />
                            )}
                            {go.href && (
                                <Link href={go.href} aria-label={t('open_person', { name: row.person ? partnerName(row.person) || tp('unknown') : tp('unknown') })}
                                    className="absolute inset-0 w-full focus-ring-inset" />
                            )}
                            <span aria-hidden="true" className={cx('absolute top-[15px] rounded-full border-[1.5px] pointer-events-none',
                                child ? 'left-[60px] top-[16px] w-[5px] h-[5px]' : 'left-[59px] w-[7px] h-[7px]',
                                vital ? 'bg-text border-text' : 'bg-[color:var(--surface)] border-text-muted')} />
                            <span className="date-mono text-meta pt-px">{f.year(row.date) || '?'}</span>
                            <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 font-semibold text-base">
                                    {title}
                                    {who && <span className="font-normal text-meta text-text-muted">{who}</span>}
                                    {row.fact && <span className="relative z-[1] inline-flex gap-1 font-normal">{c.citePins(row.fact, label)}</span>}
                                    {marked.mark && <span className="relative z-[1] inline-flex">{marked.mark}</span>}
                                    {go.href && <span aria-hidden="true" className="font-normal text-text-muted">↗</span>}
                                </div>
                                {((row.date && row.kind !== 'derived-end') || sub) && (
                                    <div className="text-sm leading-snug mt-px text-text-secondary">
                                        {row.date && row.kind !== 'derived-end' && <span className="date-mono text-meta mr-1.5">{f.date(row.date)}</span>}
                                        {sub}
                                    </div>
                                )}
                                {marked.callout && <div className="relative z-[1] mt-2">{marked.callout}</div>}
                            </div>
                        </li>
                    );
                })}
            </ol>
            {editor && <MobileRow divided icon={<Plus />} label={tp('add_event')} end="chevron" onClick={() => c.onEvent({ kind: 'choose' })} />}
        </Section>
    );
}

/* ── Media ────────────────────────────────────────────────────────────────── */

export function MediaPane({ c }: { c: FamilyPaneContext }) {
    const t = useTranslations('familyPhone');
    const tp = useTranslations('mobilePerson');
    const tm = useTranslations('ownerMedia');
    const editor = canEdit(c);
    const media = c.media ?? [];
    if (c.media && media.length === 0) {
        return editor
            ? (
                <Empty title={tp('no_media_title')} body={t('no_media_body')}>
                    <CopperPill icon={<Camera />} onClick={c.onAddMedia}>{tp('add_media')}</CopperPill>
                </Empty>
            )
            : <Quiet>{t('no_media')}</Quiet>;
    }
    return (
        <Section first>
            <Head title={tp('media')} count={media.length} action={editor ? <HeadLink label={tp('add_media_short')} onClick={c.onAddMedia} /> : undefined} />
            {media.length > 0 && (
                <div className="px-1">
                    <MediaGallery
                        items={media}
                        treeId={c.treeId}
                        lightbox={{
                            context: 'library', canEdit: editor, canDelete: c.role === 'editor',
                            canRemoveFromContext: editor,
                            onRemoveFromContext: editor ? c.onUnlinkMedia : undefined,
                            canRemoveItem: (item) => item.IsExplicit && editor,
                            showDeleteAction: (item) => item.IsExplicit && editor,
                            removeActionLabel: tm('remove'),
                            onDeleted: c.onMediaChanged,
                        }}
                        getAlt={(item) => [item.Title ?? tm('photo_alt'), mediaFactLabel(tm, item.OwnerFacts)].filter(Boolean).join(', ')}
                        renderBadge={(item) => {
                            const label = mediaFactLabel(tm, item.OwnerFacts);
                            return label ? <Badge tone="neutral" className="absolute left-1 bottom-1 px-1.5 py-0.5">{label}</Badge> : null;
                        }}
                    />
                </div>
            )}
            {editor && (
                <div className="mt-2">
                    <MobileRow divided icon={<Camera />} label={tp('add_media')} end="chevron" onClick={c.onAddMedia} />
                </div>
            )}
        </Section>
    );
}

/* ── Sources ──────────────────────────────────────────────────────────────── */

export function SourcesPane({ c }: { c: FamilyPaneContext }) {
    const t = useTranslations('familyPhone');
    const tp = useTranslations('mobilePerson');
    const tc = useTranslations('common');
    const f = useFormat(c);
    const titleOf = useRowTitle(c.data);
    const editor = canEdit(c);
    const facts = sourcingFacts(c.data);
    const citedOne = (x: { factTable: string; factId: number }) => (c.facts.find((d) => d.factTable === x.factTable && d.factId === x.factId)?.citations.length ?? 0) > 0;
    // The start cites the family or, from an import, the marriage itself (#962).
    const cited = (row: TimelineRow) => (row.kind === 'start'
        ? citedOne({ factTable: FACT_TABLES.FAMILIES, factId: c.data.family.Id }) || citedOne({ factTable: FACT_TABLES.FAMILY_MARRIAGE, factId: c.data.family.Id })
        : citedOne(row.fact!));
    const need = facts.filter((x) => !cited(x));
    const done = facts.length - need.length;
    const sources = groupCitationFactsBySource(c.facts);

    if (facts.length === 0 && sources.length === 0) {
        return editor ? <Empty title={tp('no_sources_title')} body={t('no_sources_body')} /> : <Quiet>{tp('no_sources')}</Quiet>;
    }
    if (!editor && sources.length === 0) return <Quiet>{tp('no_sources')}</Quiet>;

    return (
        <>
            {facts.length > 0 && (
                <Section first>
                    <Head title={tp('sourcing')} />
                    <div className="grid gap-2 px-4 pt-1.5 pb-1">
                        <p className="m-0 text-md text-text-secondary">
                            {tp.rich('facts_sourced', { sourced: done, total: facts.length, b: (chunks) => <b className="font-mono text-xl font-medium text-text">{chunks}</b> })}
                        </p>
                        <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden" aria-hidden="true">
                            <i className="block h-full bg-[color:var(--color-date)]" style={{ width: `${Math.round((done / facts.length) * 100)}%` }} />
                        </div>
                    </div>
                    {need.length > 0 && (
                        <>
                            <p className="m-0 px-4 mt-2.5 text-meta font-semibold text-text-secondary">{tp('needs_source')}</p>
                            {need.map((row) => {
                                const { title, who } = titleOf(row);
                                const label = [title, who].filter(Boolean).join(' · ');
                                const text = <>{label}{row.date && <> · <span className="date-mono">{f.year(row.date)}</span></>}</>;
                                return editor ? (
                                    <MobileRow key={row.key} divided label={text} sub={row.place || tp('place_not_recorded')} icon={<Plus />} end="chevron"
                                        onClick={() => c.onCite(row.fact!, label)} aria-label={tp('add_source_for', { fact: label })} />
                                ) : (
                                    <div key={row.key} className="grid gap-px px-4 py-2.5 border-t border-border">
                                        <span className="text-base font-semibold">{text}</span>
                                        <span className="text-meta text-text-secondary">{row.place || tp('place_not_recorded')}</span>
                                    </div>
                                );
                            })}
                        </>
                    )}
                </Section>
            )}
            {sources.length > 0 && (
                <Section first={facts.length === 0}>
                    <Head title={tp('sources_cited')} count={sources.length} />
                    <ol className="list-none m-0 p-0">
                        {sources.map((s, i) => (
                            <li key={s.sourceId}>
                                <MobileRow href={librarySourceHref(s.sourceId)} divided={i > 0} end="leave"
                                    lead={<span className={cx(citeClass(), 'shrink-0 self-start mt-0.5')}>{c.sourceNumbers.get(s.sourceId)}</span>}
                                    label={s.title ?? tc('source_fallback', { id: s.sourceId })}
                                    sub={s.facts.map((x) => x.label).join(' · ')} />
                            </li>
                        ))}
                    </ol>
                </Section>
            )}
        </>
    );
}
