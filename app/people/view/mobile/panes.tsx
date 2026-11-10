'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { Person, PersonWithRelations, PersonGalleryMedia } from '@/lib/db/schema';
import { EVENT_TYPES, getEventDisplayType } from '@/lib/db/schema';
import { FACT_TABLES } from '@/lib/db/fact-tables';
import { calculateAge, formatDateForDisplay, formatYearOrEmpty, sortableYear } from '@/lib/date-utils';
import { livingStatus, mayBeLiving } from '@/lib/living';
import { getInitials } from '@/lib/utils/initials';
import { avatarClass } from '@/lib/utils/avatar';
import type { Note } from '@/lib/data/types';
import type { NameVariant } from '@/app/components/person-form/NamesPanel';
import type { CitationFactDescriptor } from '@/app/components/citations/types';
import type { CiteSheetsSlot } from '@/app/components/citations/CiteSheets';
import { groupCitationFactsBySource, type SourceNumbers } from '@/app/components/citations/factDescriptors';
import { useTimelineMarks, type DataCheckMarks } from '@/app/components/data-checks/marks';
import { useDateQualifierWords } from '@/app/components/date-input/aliases';
import MediaGallery from '@/app/components/media/MediaGallery';
import GuardedLink from '@/app/components/GuardedLink';
import ProfileImage from '@/app/components/ProfileImage';
import { Badge, CopperPill, Lifespan, MobileRow, SegmentedControl, citeClass, cx } from '@/app/components/ui';
import { mediaFactLabel } from '@/app/components/media/mediaFactLabel';
import { WarningDot } from '@/app/components/ui/DatesToCheckFlag';
import { ArrowUpRight, Camera, Network, Pencil, Plus, Users } from '@/lib/icons';
import { kindKey } from '@/app/families/view/mobile/model';
import { familyMembers, nameBarParts, timelineFacts, vitalBirth, vitalDeath, type FamilyCard, type FamilyMember, type JourneyPlace, type MobileFact, type MobileFamily, type ParentLink, type PortraitPerson, type Relation } from './model';
import { noteDate, useAboutLabel } from './ProfileSheets';
import { JourneyRow } from './JourneyPage';
import type { EventFlow, EventFocus } from './EventSheet';
import type { FamilyRole } from './familyLinks';
import { librarySourceHref } from '@/app/library/links';

/** The three living statuses the Died panel switches between. */
export type LivingChoice = 'unknown' | 'living' | 'deceased';

/** Who is looking: the panes draw edit affordances for editors and contributors only. */
type MobileRole = 'viewer' | 'contributor' | 'editor';

export interface PaneContext {
    person: PersonWithRelations;
    family: MobileFamily;
    media: PersonGalleryMedia[];
    variants: NameVariant[];
    /** The person's notes, the biography and fact-scoped ones among them. */
    notes: Note[];
    biography: Note | null;
    /** Every citable fact on the page, in page order (numbers the chips). */
    facts: CitationFactDescriptor[];
    sourceNumbers: SourceNumbers;
    marks: DataCheckMarks;
    treeId: number | null;
    role: MobileRole;
    language: string;
    /** Every place they lived or passed through, for the Journey row. */
    journey: JourneyPlace[];
    descendants: number;
    /** A fact's citation chips; for an editor, "No source" when it has none. */
    citePins: (fact: Pick<MobileFact, 'factTable' | 'factId'>, label: string) => React.ReactNode;
    onShowJourney: () => void;
    /** The biography editor (#1052). */
    onBiography: () => void;
    /** A name variant's sheet, or Add name with null. */
    onName: (variant: NameVariant | null) => void;
    /** A note's sheet, or Add note with null. */
    onNote: (note: Note | null) => void;
    onShowDescendants: () => void;
    onCite: (fact: Pick<MobileFact, 'factTable' | 'factId'>, label: string) => void;
    /** The cite sheets, for a sheet that opens them on top of itself (#1049). */
    citeSheets: CiteSheetsSlot;
    onAddMedia: () => void;
    /** An edit with no phone sheet yet (Edit person, Add family): offers the full page. */
    onEdit: () => void;
    /** Open Add family (#1050): the chooser, or one role straight away. */
    onAddFamily: (role?: FamilyRole) => void;
    onShowTab: (tab: 'family') => void;
    /** Open the event sheet: the Add event chooser, a new event of one type, or a fact to edit. */
    onEvent: (flow: EventFlow) => void;
    /** The Died panel's switcher; the page asks first when a death would go. */
    onSetStatus: (next: LivingChoice) => void;
    /** The row or cell just changed, which flashes amber once (its fact key). */
    flash: string | null;
}

const canEdit = (c: PaneContext) => c.role !== 'viewer';

/** The eyebrow over a section, with its count in mono, and an optional link on the right. */
export function Head({ title, count, action }: { title: string; count?: number; action?: React.ReactNode }) {
    return (
        <div className="flex items-baseline justify-between gap-2 px-4 mb-1">
            <h2 className="eyebrow m-0">
                {title}
                {count != null && count > 0 && <>{' '}<span className="font-mono font-normal tracking-normal">{count}</span></>}
            </h2>
            {action}
        </div>
    );
}

export function Section({ children, first = false, className }: { children: React.ReactNode; first?: boolean; className?: string }) {
    return <section className={cx('pt-[18px] pb-1.5', !first && 'border-t border-border', className)}>{children}</section>;
}

export function HeadLink({ label, onClick, icon = <Plus /> }: { label: string; onClick: () => void; icon?: React.ReactElement }) {
    return (
        <button type="button" onClick={onClick}
            className="relative inline-flex items-center gap-1 text-sm font-medium text-link cursor-pointer before:absolute before:-inset-x-3 before:-inset-y-[13px] before:content-[''] focus-ring [&_svg]:w-3.5 [&_svg]:h-3.5">
            {React.cloneElement(icon, { 'aria-hidden': true } as React.HTMLAttributes<SVGElement>)}{label}
        </button>
    );
}

export function Quiet({ children }: { children: React.ReactNode }) {
    return <p className="m-0 px-4 pt-6 pb-2 text-base text-text-muted">{children}</p>;
}

/** The empty state an editor sees: a title, a line, and the way out of it. */
export function Empty({ title, body, children }: { title: string; body?: string; children?: React.ReactNode }) {
    return (
        <div className="grid gap-2 px-4 pt-[30px] pb-2.5">
            <h3 className="serif font-semibold text-lg m-0 text-balance">{title}</h3>
            {body && <p className="m-0 text-base text-text-secondary max-w-[36ch]">{body}</p>}
            {children && <div className="mt-2.5">{children}</div>}
        </div>
    );
}

function useFormat(c: PaneContext) {
    const words = useDateQualifierWords();
    return {
        date: (d: string | null | undefined) => (d ? formatDateForDisplay(d, c.language, words) : ''),
        year: (d: string | null | undefined) => formatYearOrEmpty(d ?? null),
    };
}

function useTypeLabel() {
    const tTypes = useTranslations('eventTypes');
    return (type: string) => (EVENT_TYPES[type] ? tTypes(type as Parameters<typeof tTypes>[0]) : getEventDisplayType(type));
}

const town = (place: string | null | undefined) => place?.split(',')[0]?.trim() || '';

/* ── Person rows ──────────────────────────────────────────────────────────── */

function PersonRow({ person, sub, divided }: { person: Person; sub?: string; divided?: boolean }) {
    const t = useTranslations('mobilePerson');
    const name = `${person.FirstName ?? ''} ${person.LastName ?? ''}`.trim() || t('unknown');
    const years = <Lifespan birth={person.BirthDate} death={person.DeathDate} status={livingStatus(person)} />;
    return (
        <MobileRow
            href={`/people/view?id=${person.Id}`}
            end="leave"
            divided={divided}
            lead={(
                <span aria-hidden="true" className={cx(avatarClass(person.Sex), 'grid place-items-center w-9 h-9 shrink-0 rounded-full text-xs font-semibold text-[color:var(--color-on-media)]')}>
                    {getInitials(person.FirstName, person.LastName)}
                </span>
            )}
            label={<span className="serif font-semibold text-md">{name}</span>}
            sub={(
                <span className="font-mono">
                    {person.BirthDate || person.DeathDate ? years : t('no_dates')}
                    {sub && <span className="font-sans"> · {sub}</span>}
                </span>
            )}
        />
    );
}

/** The photo stack's cards, front first: a slight fan, like prints dropped on a table. */
const STACK_CARD = ['left-0 top-[3px] -rotate-3', 'left-[8px] top-px rotate-[5deg]', 'left-4 top-1 rotate-[11deg]'];

function FamilyStack({ people, treeId }: { people: PortraitPerson[]; treeId: number | null }) {
    // Painted back to front, so the first face lands on top.
    const cards = people.map((p, i) => ({ p, cls: STACK_CARD[i] })).reverse();
    return (
        <span aria-hidden="true" className="relative w-[54px] h-12 shrink-0">
            {cards.map(({ p, cls }) => (
                <span key={p.Id} className={cx('absolute w-9 h-[42px] rounded-[4px] border-2 border-card overflow-hidden shadow-sm bg-card', cls)}>
                    {p.PrimaryMediaId
                        ? <ProfileImage mediaId={p.PrimaryMediaId} treeId={treeId} alt="" focalX={p.FocalX ?? 50} focalY={p.FocalY ?? 50} focalRadius={p.FocalRadius ?? null}
                            containerWidth={32} containerHeight={38} circular={false} />
                        : (
                            <span className={cx(avatarClass(p.Sex), 'grid place-items-center w-full h-full text-xs font-semibold text-[color:var(--color-on-media)]')}>
                                {getInitials(p.FirstName, p.LastName)}
                            </span>
                        )}
                </span>
            ))}
        </span>
    );
}

/**
 * The way into a family record (#1098): a tinted row with a photo stack, so it reads
 * as a family, not one more person. "Anders & Greta’s family", "Marriage · 1902 · 3 children".
 */
function FamilyRecordRow({ card, c }: { card: FamilyCard; c: PaneContext }) {
    const t = useTranslations('mobilePerson');
    const tk = useTranslations('familyPhone');
    const f = useFormat(c);
    const [a, b] = card.names;
    const title = b ? t('family_of_two', { first: a, second: b }) : a ? t('family_of_one', { name: a }) : tk('family');
    const sub = [
        tk(`kind_${kindKey(card.type)}`),
        f.year(card.startDate),
        card.childCount > 0 ? t('children_count', { count: card.childCount }) : '',
    ].filter(Boolean).join(' · ');
    return (
        <GuardedLink href={`/families/view?id=${card.familyId}`}
            className="flex w-full min-h-[72px] items-center gap-3 px-4 py-3 bg-surface-2 active:bg-border text-text no-underline focus-ring-inset transition-colors">
            {card.stack.length > 0 && <FamilyStack people={card.stack} treeId={c.treeId} />}
            <span className="flex-1 min-w-0 grid gap-px">
                <span className="serif font-semibold text-md leading-snug">{title}</span>
                <span className="text-meta text-text-muted">{sub}</span>
            </span>
            <ArrowUpRight className="w-[18px] h-[18px] shrink-0 text-text-muted" aria-hidden="true" />
        </GuardedLink>
    );
}

export function useRelationLabel() {
    const t = useTranslations('mobilePerson');
    return (r: Relation, link?: ParentLink) => t(link ? `rel_${r}_${link}` : `rel_${r}`);
}

/* ── Vitals strip ─────────────────────────────────────────────────────────── */

type Cell = 0 | 1 | 2;

function VitalsStrip({ c }: { c: PaneContext }) {
    const t = useTranslations('mobilePerson');
    const td = useTranslations('dataChecks');
    const f = useFormat(c);
    const p = c.person;
    const [open, setOpen] = useState<Cell | null>(null);
    const birth = vitalBirth(p);
    const death = vitalDeath(p);
    const status = livingStatus(p);
    const nowYear = new Date().getFullYear();
    const mayLive = mayBeLiving(p, nowYear);
    const by = sortableYear(p.BirthDate);
    const dy = sortableYear(p.DeathDate);

    const te = useTranslations('mobileEvents');
    const editor = canEdit(c);
    const marksFor = (fact: MobileFact | null) => (fact ? c.marks.byFact.get(`${fact.factTable}:${fact.factId}`) ?? [] : []);
    // fr and ru agree the status word with the person's sex.
    const sex = { sex: p.Sex ?? 'U' };
    const statusWord = status === 'living' ? t('living', sex) : status === 'deceased' ? t('deceased', sex) : t('unknown');
    const unk = <span className="italic text-text-muted">{t('not_recorded')}</span>;
    const citationsOf = (fact: MobileFact) => c.facts.find((x) => x.factTable === fact.factTable && x.factId === fact.factId)?.citations ?? [];

    const panel = (fact: MobileFact | null, title: string, extra?: React.ReactNode) => {
        const entries = marksFor(fact);
        // Editors tap any row to open the event sheet on that field (#1047); quiet
        // rows, no chevrons. The source row then shows the pins as plain numbers,
        // since a chip can't sit inside the row's button.
        const row = (label: string, focus: EventFocus, value: React.ReactNode) => (fact && editor
            ? <PanelRow label={label} onClick={() => c.onEvent({ kind: 'edit', fact, focus })}>{value}</PanelRow>
            : <PanelRow label={label}>{value}</PanelRow>);
        const cites = fact ? citationsOf(fact) : [];
        return (
            <>
                {fact && (
                    <>
                        <div className="eyebrow mb-1">{title}</div>
                        {row(t('row_date'), 'date', fact.date ? <span className="date-mono">{f.date(fact.date)}</span> : unk)}
                        {row(t('row_place'), 'place', fact.place || unk)}
                        {fact.detail && row(t('row_cause'), 'detail', fact.detail)}
                        {editor ? row(t('row_source'), 'sources', cites.length > 0 ? (
                            <span className="grid gap-0.5">
                                {cites.map((x) => (
                                    <span key={x.Id} className="flex items-start gap-1.5">
                                        <span className={cx(citeClass(), 'shrink-0 mt-px')}>{c.sourceNumbers.get(x.SourceId)}</span>
                                        <span className="min-w-0">{x.sourceTitle ?? te('source_fallback')}</span>
                                    </span>
                                ))}
                            </span>
                        ) : <span className="italic text-text-muted">{t('none_cited')}</span>) : (
                            <PanelRow label={t('row_source')}>
                                {cites.length > 0
                                    ? <span className="inline-flex flex-wrap gap-1">{c.citePins(fact, title)}</span>
                                    : <span className="italic text-text-muted">{t('none_cited')}</span>}
                            </PanelRow>
                        )}
                    </>
                )}
                {entries.length > 0 && (
                    <div className="grid gap-1 mt-2 text-sm">
                        {entries.map((e) => <p key={e.id} className="m-0 font-semibold text-warning-text">{c.marks.text.sentence(e)}</p>)}
                        <Link href={`/data-checks?entry=${encodeURIComponent(entries[0].id)}`} className="text-sm text-link underline">{td('open_in_data_checks')}</Link>
                    </div>
                )}
                {fact && editor && (
                    <MobileRow icon={<Pencil />} label={fact.type === 'BIRT' ? t('edit_birth') : t('edit_death')} end="chevron"
                        onClick={() => c.onEvent({ kind: 'edit', fact })} className="!px-0 mt-1.5" />
                )}
                {extra}
            </>
        );
    };

    const value = (text: string, tone: 'date' | 'plain' | 'word' | 'dim' = 'date') => (
        <span className={cx(
            tone === 'word' ? 'text-base font-semibold text-text' : 'font-mono text-md font-medium',
            tone === 'date' && 'text-[color:var(--color-date)]', tone === 'plain' && 'text-text', tone === 'dim' && 'text-text-muted',
        )}>{text}</span>
    );

    const add = editor ? <span className="text-base font-semibold text-link">{t('add')}</span> : value(t('unknown'), 'word');
    const born: CellSpec = {
        key: t('born'),
        value: birth ? value(f.year(birth.date) || t('unknown'), birth.date ? 'date' : 'word') : add,
        sub: birth ? (town(birth.place) || t('place_unknown')) : t('date_and_place'),
        panel: panel(birth, t('panel_birth')),
        marked: marksFor(birth).length > 0,
        // With no birth, an editor's tap goes straight to Add birth.
        onAdd: !birth && editor ? () => c.onEvent({ kind: 'add', type: 'BIRT' }) : undefined,
        flashKey: `birth-${p.Id}`,
    };

    // Unknown / Living / Deceased, always in the Died panel for editors (#1047). With a
    // death recorded it sits at the bottom; picking Living or Unknown asks first.
    const switcher = (
        <div className="grid gap-1.5 mt-3">
            <div className="eyebrow">{t('row_status')}</div>
            <SegmentedControl
                fullWidth
                aria-label={te('status_label')}
                value={status}
                onChange={(v) => { if (v !== status) c.onSetStatus(v as LivingChoice); }}
                options={[{ v: 'unknown', l: t('unknown') }, { v: 'living', l: t('living', sex) }, { v: 'deceased', l: t('deceased', sex) }]}
            />
        </div>
    );
    const statusPart = (after?: React.ReactNode) => (editor
        ? <>{switcher}{after}</>
        : <PanelRow label={t('row_status')}>{statusWord}</PanelRow>);
    const addDeath = (label: string, sub?: string) => (
        <MobileRow divided icon={<Plus />} label={label} sub={sub} end="chevron" onClick={() => c.onEvent({ kind: 'add', type: 'DEAT' })} className="!px-0 mt-2" />
    );
    let died: CellSpec;
    if (death) {
        died = {
            key: t('died'), value: value(f.year(death.date) || t('unknown'), death.date ? 'date' : 'word'),
            sub: death.place ? town(death.place) : death.date ? t('place_unknown') : t('date_unknown'),
            panel: panel(death, t('panel_death'), editor
                ? <>{switcher}<p className="m-0 mt-1.5 text-sm text-text-muted">{t('deceased_because', sex)}</p></>
                : <div className="mt-3"><PanelRow label={t('row_status')}>{statusWord}</PanelRow><p className="m-0 mt-1 text-sm text-text-muted">{t('deceased_because', sex)}</p></div>),
            marked: marksFor(death).length > 0,
            flashKey: `death-${p.Id}`,
        };
    } else if (status === 'living') {
        died = {
            key: t('status'), value: <span className="inline-flex items-center gap-1.5 text-base font-semibold text-text"><span aria-hidden="true" className="w-[9px] h-[9px] rounded-full bg-[color:var(--color-status-living)]" />{t('living', sex)}</span>,
            sub: t('no_death'), panel: statusPart(editor && addDeath(te('record_death'), te('record_death_sub'))), marked: false, flashKey: `death-${p.Id}`,
        };
    } else if (status === 'deceased') {
        died = {
            key: t('died'), value: value(t('deceased', sex), 'word'), sub: t('date_unknown'),
            panel: statusPart(editor && addDeath(te('add_death_details'))), marked: false, flashKey: `death-${p.Id}`,
        };
    } else {
        died = {
            key: mayLive ? t('status') : t('died'), value: value(t('unknown'), 'word'), sub: t('not_recorded'),
            panel: statusPart(editor && addDeath(te('add_death'))), marked: false, flashKey: `death-${p.Id}`,
        };
    }

    let age: { value: React.ReactNode; sub: string };
    if (by == null) age = { value: value('—', 'dim'), sub: t('needs_birth') };
    else if (death && dy != null) {
        const a = calculateAge(p.BirthDate, p.DeathDate, true);
        age = { value: value(a && a.kind !== 'deceased' && a.kind !== 'months' ? String(a.value) : String(dy - by), 'plain'), sub: t('at_death') };
    }
    else if (status === 'living') age = { value: value(String(nowYear - by), 'plain'), sub: nowYear - by >= 100 ? t('over_100') : t('this_year') };
    else if (status === 'deceased') age = { value: value('—', 'dim'), sub: t('needs_death') };
    else if (mayLive) age = { value: value(String(nowYear - by), 'plain'), sub: t('if_living') };
    else age = { value: value('—', 'dim'), sub: t('unknown') };

    const cells = [born, died];
    return (
        <div className="border-b border-border">
            <div className="grid grid-cols-3">
                {cells.map((cell, i) => {
                    const on = open === i;
                    return (
                        <button key={`${i}-${c.flash === cell.flashKey ? c.flash : ''}`} type="button" aria-expanded={cell.onAdd ? undefined : on}
                            onClick={cell.onAdd ?? (() => setOpen(on ? null : (i as Cell)))}
                            className={cx('grid gap-0.5 content-start min-w-0 text-left pt-3.5 pb-[13px] pr-2.5 cursor-pointer focus-ring-inset transition-colors',
                                i === 0 ? 'pl-4' : 'pl-3.5 border-l border-border', on ? 'bg-surface-2' : 'active:bg-surface-2',
                                c.flash === cell.flashKey && 'mp-flash')}>
                            <span className="eyebrow inline-flex items-center gap-1.5">
                                {cell.key}
                                {cell.marked && <><WarningDot /><span className="sr-only">{td('mark_label')}</span></>}
                                {!cell.onAdd && <span aria-hidden="true" className={cx('inline-block w-1.5 h-1.5 border-r-[1.5px] border-b-[1.5px] border-text-muted transition-transform motion-reduce:transition-none', on ? 'rotate-[-135deg] translate-y-[2px]' : 'rotate-45 -translate-y-[1px]')} />}
                            </span>
                            {cell.value}
                            <span className="text-xs leading-snug text-text-secondary">{cell.sub}</span>
                        </button>
                    );
                })}
                <div className="grid gap-0.5 content-start min-w-0 pt-3.5 pb-[13px] pl-3.5 pr-2.5 border-l border-border">
                    <span className="eyebrow">{t('age')}</span>
                    {age.value}
                    <span className="text-xs leading-snug text-text-secondary">{age.sub}</span>
                </div>
            </div>
            {open != null && (
                <div className="grid gap-0.5 px-4 pt-3 pb-2.5 bg-surface-2 border-t border-border">
                    {cells[open].panel}
                </div>
            )}
        </div>
    );
}

interface CellSpec {
    key: string;
    value: React.ReactNode;
    sub: string;
    panel: React.ReactNode;
    marked: boolean;
    /** Tapping adds instead of opening a panel (an editor's empty Born). */
    onAdd?: () => void;
    flashKey: string;
}

/** A vitals panel line; with `onClick`, a quiet row that opens the event sheet on that field. */
export function PanelRow({ label, children, onClick }: { label: string; children: React.ReactNode; onClick?: () => void }) {
    const cls = 'grid grid-cols-[82px_1fr] gap-2 py-[3px] text-base leading-snug';
    if (onClick) {
        return (
            <button type="button" onClick={onClick}
                className={cx(cls, 'w-[calc(100%+16px)] -mx-2 px-2 rounded-md text-left text-text cursor-pointer active:bg-[color:var(--surface)] focus-ring-inset')}>
                <span className="text-meta text-text-muted pt-px">{label}</span>
                <span className="min-w-0">{children}</span>
            </button>
        );
    }
    return (
        <div className={cls}>
            <span className="text-meta text-text-muted pt-px">{label}</span>
            <span className="min-w-0">{children}</span>
        </div>
    );
}

/* ── Overview ─────────────────────────────────────────────────────────────── */

export function OverviewPane({ c }: { c: PaneContext }) {
    const t = useTranslations('mobilePerson');
    const tp = useTranslations('personDetail');
    const relation = useRelationLabel();
    const f = useFormat(c);
    const p = c.person;
    const editor = canEdit(c);
    const members = familyMembers(c.family);
    const otherNotes = c.notes.filter((n) => n.Id !== c.biography?.Id);
    const when = (n: Note) => noteDate(n, c.language);
    const aboutLabel = useAboutLabel(p);
    const tm = useTranslations('mobileProfile');
    const sexLabel = p.Sex === 'M' ? tp('sex_male') : p.Sex === 'F' ? tp('sex_female') : p.Sex ? tp('sex_nonbinary') : null;
    const marriages = c.family.partners.filter((g) => g.marriageDate);
    const variantType = (type: string) => {
        const key = `vtype_${type.toLowerCase()}`;
        return tp.has(key as Parameters<typeof tp>[0]) ? tp(key as Parameters<typeof tp>[0]) : type;
    };
    const birthName = `${p.FirstName ?? ''} ${p.LastName ?? ''}`.trim();
    const memberSub = (m: FamilyMember) => {
        const g = m.relation === 'husband' || m.relation === 'wife' || m.relation === 'partner'
            ? c.family.partners.find((x) => x.partner?.Id === m.person.Id) : null;
        return [relation(m.relation, m.parentLink), g?.marriageDate ? t('married_short', { date: f.year(g.marriageDate) }) : null].filter(Boolean).join(' · ');
    };

    return (
        <>
            <VitalsStrip c={c} />

            {c.biography ? (
                <Section first>
                    <Head title={t('biography')} action={editor ? <HeadLink label={tm('edit_bio')} icon={<Pencil />} onClick={c.onBiography} /> : undefined} />
                    {editor ? (
                        // The text itself opens the editor too; the Edit link is the labelled way in.
                        <button type="button" onClick={c.onBiography} tabIndex={-1} aria-hidden="true"
                            className="block w-full px-4 mt-1 mb-1.5 text-left serif italic text-md leading-relaxed text-text whitespace-pre-line cursor-pointer active:bg-surface-2">
                            {c.biography.Text}
                        </button>
                    ) : (
                        <p className="m-0 px-4 mt-1 mb-1.5 serif italic text-md leading-relaxed text-text whitespace-pre-line">{c.biography.Text}</p>
                    )}
                    {editor && <p className="sr-only">{c.biography.Text}</p>}
                    {when(c.biography) && <p className="m-0 px-4 text-meta text-text-muted">{t('bio_edited', { date: when(c.biography)! })}</p>}
                </Section>
            ) : editor ? (
                <Section first>
                    <Head title={t('biography')} />
                    <MobileRow icon={<Pencil />} label={t('write_bio')} end="chevron" onClick={c.onBiography} />
                </Section>
            ) : null}

            {(sexLabel || marriages.length > 0) && (
                <Section first={!c.biography && !editor}>
                    <Head title={t('key_facts')} />
                    <dl className="grid grid-cols-[82px_1fr] m-0 px-4">
                        {marriages.map((g, i) => (
                            <React.Fragment key={g.familyId}>
                                <dt className={cx('py-[9px] text-meta text-text-muted', i > 0 && 'border-t border-border')}>{t('married')}</dt>
                                <dd className={cx('m-0 py-[9px] min-w-0', i > 0 && 'border-t border-border')}>
                                    <span className="date-mono">{f.date(g.marriageDate)}</span>
                                    {g.partner && <div className="text-sm text-text-secondary">{`${g.partner.FirstName ?? ''} ${g.partner.LastName ?? ''}`.trim()}</div>}
                                </dd>
                            </React.Fragment>
                        ))}
                        {sexLabel && (
                            <>
                                <dt className={cx('py-[9px] text-meta text-text-muted', marriages.length > 0 && 'border-t border-border')}>{t('sex')}</dt>
                                <dd className={cx('m-0 py-[9px]', marriages.length > 0 && 'border-t border-border')}>{sexLabel}</dd>
                            </>
                        )}
                    </dl>
                </Section>
            )}

            {members.length > 0 && (
                <Section>
                    <Head title={t('family')} />
                    {members.slice(0, 3).map((m, i) => <PersonRow key={m.person.Id} person={m.person} sub={memberSub(m)} divided={i > 0} />)}
                    {members.length > 3 && (
                        <MobileRow divided label={t('see_all_family')} sub={t('people_count', { count: members.length })} end="chevron" onClick={() => c.onShowTab('family')} />
                    )}
                </Section>
            )}

            {(editor || c.variants.length > 0) && (
                <Section>
                    <Head title={t('names')} count={c.variants.length + 1} />
                    {/* The birth name is edited with the rest of the person (Edit person). */}
                    <NameRow name={birthName || t('unknown')} sub={t('birth_name')}
                        pins={c.citePins({ factTable: FACT_TABLES.PERSON_NAME, factId: p.Id }, t('birth_name'))}
                        onClick={editor ? c.onEdit : undefined} editLabel={tm('edit_birth_name')} />
                    {c.variants.map((v) => (
                        <NameRow key={v.Id} divided name={v.Name}
                            sub={[variantType(v.Type), v.FromDate ? t('name_from', { date: f.date(v.FromDate) }) : null, v.IsPrimary ? t('shown_as_first') : null].filter(Boolean).join(' · ')}
                            pins={c.citePins({ factTable: FACT_TABLES.NAME_VARIANT, factId: v.Id }, v.Name)}
                            onClick={editor ? () => c.onName(v) : undefined} editLabel={tm('edit_name_named', { name: v.Name })} />
                    ))}
                    {editor && <MobileRow divided icon={<Plus />} label={t('add_name')} end="chevron" onClick={() => c.onName(null)} />}
                </Section>
            )}

            {(editor || otherNotes.length > 0) && (
                <Section>
                    <Head title={t('notes')} count={otherNotes.length} />
                    {otherNotes.map((n, i) => {
                        const body = (
                            <>
                                <span className="text-base leading-normal text-text line-clamp-2">{n.Text}</span>
                                <span className="text-meta text-text-muted">{[aboutLabel(n.OwnerFact ?? null), when(n)].filter(Boolean).join(' · ')}</span>
                            </>
                        );
                        const cls = cx('grid gap-[3px] w-full px-4 py-[11px] text-left', i > 0 && 'border-t border-border');
                        return editor
                            ? <button key={n.Id} type="button" onClick={() => c.onNote(n)} className={cx(cls, 'cursor-pointer active:bg-surface-2 focus-ring-inset')}>{body}</button>
                            : <div key={n.Id} className={cls}>{body}</div>;
                    })}
                    {otherNotes.length === 0 && <p className="m-0 px-4 pb-1 text-base text-text-muted">{t('no_notes')}</p>}
                    {editor && <MobileRow divided icon={<Plus />} label={t('add_note')} end="chevron" onClick={() => c.onNote(null)} />}
                </Section>
            )}
        </>
    );
}

/** A name; for an editor the whole row opens its sheet, while the pins keep their own taps. */
function NameRow({ name, sub, pins, divided, onClick, editLabel }: {
    name: string; sub: string; pins: React.ReactNode; divided?: boolean; onClick?: () => void; editLabel?: string;
}) {
    return (
        <div className={cx('relative grid gap-0.5 px-4 py-[11px]', divided && 'border-t border-border', onClick && 'active:bg-surface-2')}>
            {onClick && (
                <button type="button" onClick={onClick} aria-label={editLabel}
                    className="absolute inset-0 w-full cursor-pointer bg-transparent focus-ring-inset" />
            )}
            <span className="serif font-semibold text-md">{name}<span className="relative z-[1] inline-flex gap-1 ml-1 align-[1px]">{pins}</span></span>
            <span className="text-meta text-text-muted">{sub}</span>
        </div>
    );
}

/* ── Events ───────────────────────────────────────────────────────────────── */

export function EventsPane({ c }: { c: PaneContext }) {
    const t = useTranslations('mobilePerson');
    const f = useFormat(c);
    const typeLabel = useTypeLabel();
    const markRow = useTimelineMarks(c.marks);
    const te = useTranslations('mobileEvents');
    const p = c.person;
    const editor = canEdit(c);
    const facts = timelineFacts(p);
    const status = livingStatus(p);
    const by = sortableYear(p.BirthDate);
    const name = nameBarParts(p).given || t('this_person');

    if (facts.length === 0) {
        return editor
            ? <Empty title={t('no_events_title')} body={t('no_events_body', { name })}><CopperPill icon={<Plus />} onClick={() => c.onEvent({ kind: 'choose' })}>{t('add_event')}</CopperPill></Empty>
            : <Quiet>{t('no_events')}</Quiet>;
    }

    return (
        <>
            {c.journey.some((x) => x.at) && <JourneyRow places={c.journey} onOpen={c.onShowJourney} />}
            <Section first>
                <Head title={t('life_events')} count={facts.length} action={editor ? <HeadLink label={t('add_event')} onClick={() => c.onEvent({ kind: 'choose' })} /> : undefined} />
                <ol className="list-none m-0 p-0 relative before:absolute before:left-[62px] before:top-2.5 before:bottom-2.5 before:w-px before:bg-border">
                    {facts.map((fact) => {
                        const label = typeLabel(fact.type);
                        const y = sortableYear(fact.date);
                        const age = y != null && by != null && fact.type !== 'BIRT' && y - by >= 0 ? y - by : null;
                        const sub = [fact.detail, fact.place].filter(Boolean).join(' · ');
                        const marked = markRow(`${fact.factTable}:${fact.factId}`);
                        return (
                            <li key={`${fact.key}-${c.flash === fact.key ? 'flash' : ''}`}
                                className={cx('relative grid grid-cols-[40px_1fr] gap-x-[18px] px-4 py-[9px]', marked.flagged && 'bg-warning-bg/40', editor && 'active:bg-surface-2', c.flash === fact.key && 'mp-flash')}>
                                {/* The whole row opens the event sheet (#1048); pins and the
                                    data-check callout sit above it and keep their own taps. */}
                                {editor && (
                                    <button type="button" onClick={() => c.onEvent({ kind: 'edit', fact })} aria-label={te('edit_fact', { fact: label })}
                                        className="absolute inset-0 w-full cursor-pointer bg-transparent focus-ring-inset" />
                                )}
                                <span aria-hidden="true" className={cx('absolute left-[59px] top-[15px] w-[7px] h-[7px] rounded-full border-[1.5px] pointer-events-none',
                                    fact.vital || fact.type === 'BIRT' || fact.type === 'DEAT' ? 'bg-text border-text' : 'bg-[color:var(--surface)] border-text-muted')} />
                                <span className="date-mono text-meta pt-px">{f.year(fact.date) || '?'}</span>
                                <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 font-semibold text-base">
                                        {label}
                                        {age != null && <span className="font-normal text-meta text-text-muted">{t('age_at', { age })}</span>}
                                        <span className="relative z-[1] inline-flex gap-1 font-normal">{c.citePins(fact, label)}</span>
                                        <span className="relative z-[1] inline-flex">{marked.mark}</span>
                                    </div>
                                    {(fact.date || sub) && (
                                        <div className="text-sm leading-snug mt-px text-text-secondary">
                                            {fact.date && <span className="date-mono text-meta mr-1.5">{f.date(fact.date)}</span>}
                                            {sub}
                                        </div>
                                    )}
                                    {marked.callout && <div className="relative z-[1] mt-2">{marked.callout}</div>}
                                </div>
                            </li>
                        );
                    })}
                    {/* No death row while the person may still be alive (lib/living.ts). */}
                    {!vitalDeath(p) && !facts.some((x) => x.type === 'DEAT') && !mayBeLiving(p, new Date().getFullYear()) && (
                        <li className={cx('relative grid grid-cols-[40px_1fr] gap-x-[18px] px-4 py-[9px]', editor && 'active:bg-surface-2')}>
                            {editor && (
                                <button type="button" onClick={() => c.onEvent({ kind: 'add', type: 'DEAT' })} aria-label={te('add_death')}
                                    className="absolute inset-0 w-full cursor-pointer bg-transparent focus-ring-inset" />
                            )}
                            <span aria-hidden="true" className="absolute left-[59px] top-[15px] w-[7px] h-[7px] rounded-full border-[1.5px] border-dashed border-text-muted bg-[color:var(--surface)] pointer-events-none" />
                            <span className="date-mono text-meta pt-px">?</span>
                            <div>
                                <div className="font-semibold text-base">{typeLabel('DEAT')}</div>
                                <div className="text-sm italic text-text-muted">{status === 'deceased' ? t('death_open_deceased') : t('not_recorded')}</div>
                            </div>
                        </li>
                    )}
                </ol>
            </Section>
        </>
    );
}

/* ── Family ───────────────────────────────────────────────────────────────── */

export function FamilyPane({ c }: { c: PaneContext }) {
    const t = useTranslations('mobilePerson');
    const tf = useTranslations('mobileFamily');
    const relation = useRelationLabel();
    const f = useFormat(c);
    const editor = canEdit(c);
    const { parents, partners, siblings } = c.family;
    const name = nameBarParts(c.person).given || t('this_person');

    if (parents.length === 0 && partners.length === 0 && siblings.length === 0) {
        return editor
            ? (
                <Empty title={t('no_family_title')} body={t('no_family_body', { name })}>
                    <div className="-mx-4 border-t border-border">
                        <MobileRow icon={<Users />} label={tf('add_partner_row')} end="chevron" onClick={() => c.onAddFamily('partner')} />
                        <MobileRow divided icon={<Network />} label={tf('add_parents_row')} end="chevron" onClick={() => c.onAddFamily('parent')} />
                        <MobileRow divided icon={<Plus />} label={tf('add_child_row')} end="chevron" onClick={() => c.onAddFamily('child')} />
                    </div>
                </Empty>
            )
            : <Quiet>{t('no_family')}</Quiet>;
    }

    return (
        <>
            {(editor || c.descendants > 0) && (
                <div className="pt-2 pb-1.5">
                    {editor && <MobileRow icon={<Plus />} label={t('add_family')} end="chevron" onClick={() => c.onAddFamily()} />}
                    {c.descendants > 0 && (
                        <MobileRow divided={editor} icon={<Users />} label={t('descendants')} sub={t('descendants_sub')} end="leave" onClick={c.onShowDescendants} />
                    )}
                </div>
            )}
            {(parents.length > 0 || editor) && (
                <Section first={!editor && c.descendants === 0}>
                    <Head title={t('parents')} />
                    {c.family.parentFamilies.map((card) => <FamilyRecordRow key={card.familyId} card={card} c={c} />)}
                    {parents.length > 0
                        ? parents.map((m, i) => <PersonRow key={m.person.Id} person={m.person} sub={relation(m.relation, m.parentLink)} divided={i > 0} />)
                        : (
                            <>
                                <p className="m-0 px-4 pb-1 text-base text-text-muted">{t('no_parents')}</p>
                                <MobileRow icon={<Network />} label={tf('add_parents_row')} end="chevron" onClick={() => c.onAddFamily('parent')} />
                            </>
                        )}
                </Section>
            )}
            {/* No partner recorded drops the section: an empty line with nothing to tap is dead text. */}
            {partners.map((g, i) => (
                <Section key={g.familyId} first={i === 0 && parents.length === 0 && !editor && c.descendants === 0}>
                    <Head title={t('partner')} />
                    <FamilyRecordRow card={g.card} c={c} />
                    {g.partner
                        ? <PersonRow person={g.partner} sub={g.marriageDate ? t('married_short', { date: f.year(g.marriageDate) }) : undefined} />
                        : <p className="m-0 px-4 pt-2.5 pb-1 text-base text-text-muted">{t('partner_unknown')}</p>}
                    {g.children.length > 0 && (
                        <>
                            <p className="m-0 px-4 mt-2.5 mb-0.5 text-meta font-semibold text-text-secondary">
                                {g.partner?.FirstName
                                    ? t('children_with', { count: g.children.length, name: g.partner.FirstName.split(/\s+/)[0] })
                                    : t('children_count', { count: g.children.length })}
                            </p>
                            {g.children.map((k, i) => <PersonRow key={k.Id} person={k} divided={i > 0} />)}
                        </>
                    )}
                </Section>
            ))}
            {siblings.length > 0 && (
                <Section first={parents.length === 0 && partners.length === 0 && !editor && c.descendants === 0}>
                    <Head title={t('siblings')} count={siblings.length} />
                    {siblings.map((m, i) => <PersonRow key={m.person.Id} person={m.person} divided={i > 0} />)}
                </Section>
            )}
        </>
    );
}

/* ── Media ────────────────────────────────────────────────────────────────── */

export function MediaPane({ c, onMediaChanged }: { c: PaneContext; onMediaChanged: () => void }) {
    const t = useTranslations('mobilePerson');
    const tp = useTranslations('personDetail');
    const tm = useTranslations('ownerMedia');
    const editor = canEdit(c);
    const name = nameBarParts(c.person).given || t('this_person');
    if (c.media.length === 0) {
        return editor
            ? <Empty title={t('no_media_title')} body={t('no_media_body', { name })}><CopperPill icon={<Camera />} onClick={c.onAddMedia}>{t('add_media')}</CopperPill></Empty>
            : <Quiet>{t('no_media')}</Quiet>;
    }
    return (
        <Section first>
            <Head title={t('media')} count={c.media.length} action={editor ? <HeadLink label={t('add_media_short')} onClick={c.onAddMedia} /> : undefined} />
            <div className="px-1">
                <MediaGallery
                    items={c.media}
                    treeId={c.treeId}
                    lightbox={{
                        context: 'person', galleryPersonId: c.person.Id, canEdit: editor, canDelete: c.role === 'editor',
                        onPrimaryChanged: onMediaChanged, onTagsChanged: onMediaChanged, onDeleted: onMediaChanged,
                    }}
                    // No Birth / Death tag on the tile: no other media carries one (#1215).
                    // The alt text still says which fact the photo belongs to.
                    getAlt={(item) => [item.Title ?? tp('photo_alt'), mediaFactLabel(tm, item.OwnerFacts)].filter(Boolean).join(', ')}
                />
            </div>
        </Section>
    );
}

/* ── Sources ──────────────────────────────────────────────────────────────── */

export function SourcesPane({ c }: { c: PaneContext }) {
    const t = useTranslations('mobilePerson');
    const tc = useTranslations('common');
    const typeLabel = useTypeLabel();
    const f = useFormat(c);
    const editor = canEdit(c);
    const timeline = timelineFacts(c.person);
    const cited = (fact: MobileFact) => (c.facts.find((x) => x.factTable === fact.factTable && x.factId === fact.factId)?.citations.length ?? 0) > 0;
    const need = timeline.filter((x) => !cited(x));
    const done = timeline.length - need.length;
    const sources = groupCitationFactsBySource(c.facts);
    const name = nameBarParts(c.person).given || t('this_person');

    if (timeline.length === 0 && sources.length === 0) {
        return editor ? <Empty title={t('no_sources_title')} body={t('no_sources_body', { name })} /> : <Quiet>{t('no_sources')}</Quiet>;
    }
    if (!editor && sources.length === 0) return <Quiet>{t('no_sources')}</Quiet>;

    return (
        <>
            {timeline.length > 0 && (
                <Section first>
                    <Head title={t('sourcing')} />
                    <div className="grid gap-2 px-4 pt-1.5 pb-1">
                        <p className="m-0 text-md text-text-secondary">
                            {t.rich('facts_sourced', { sourced: done, total: timeline.length, b: (chunks) => <b className="font-mono text-xl font-medium text-text">{chunks}</b> })}
                        </p>
                        <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden" aria-hidden="true">
                            <i className="block h-full bg-[color:var(--color-date)]" style={{ width: `${Math.round((done / timeline.length) * 100)}%` }} />
                        </div>
                    </div>
                    {need.length > 0 && (
                        <>
                            <p className="m-0 px-4 mt-2.5 text-meta font-semibold text-text-secondary">{t('needs_source')}</p>
                            {need.map((fact) => {
                                const label = typeLabel(fact.type);
                                return editor ? (
                                    <MobileRow key={fact.key} divided label={<>{label}{fact.date && <> · <span className="date-mono">{f.year(fact.date)}</span></>}</>}
                                        sub={fact.place || t('place_not_recorded')} icon={<Plus />} end="chevron" onClick={() => c.onCite(fact, label)} aria-label={t('add_source_for', { fact: label })} />
                                ) : (
                                    <div key={fact.key} className="grid gap-px px-4 py-2.5 border-t border-border">
                                        <span className="text-base font-semibold">{label}{fact.date && <> · <span className="date-mono">{f.year(fact.date)}</span></>}</span>
                                        <span className="text-meta text-text-secondary">{fact.place || t('place_not_recorded')}</span>
                                    </div>
                                );
                            })}
                        </>
                    )}
                </Section>
            )}
            {sources.length > 0 && (
                <Section first={timeline.length === 0}>
                    <Head title={t('sources_cited')} count={sources.length} />
                    <ol className="list-none m-0 p-0">
                        {sources.map((s, i) => {
                            const title = s.title ?? tc('source_fallback', { id: s.sourceId });
                            return (
                                <li key={s.sourceId}>
                                    <MobileRow href={librarySourceHref(s.sourceId)} divided={i > 0} end="leave"
                                        lead={<span className={cx(citeClass(), 'shrink-0 self-start mt-0.5')}>{c.sourceNumbers.get(s.sourceId)}</span>}
                                        label={title}
                                        sub={s.facts.map((x) => x.label).join(' · ')} />
                                </li>
                            );
                        })}
                    </ol>
                </Section>
            )}
        </>
    );
}
