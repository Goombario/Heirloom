'use client';

import React, { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { PersonWithRelations } from '@/lib/db/schema';
import { FACT_TABLES } from '@/lib/db/fact-tables';
import { getDataClient } from '@/lib/data';
import type { Note, NoteOwnerFact } from '@/lib/data/types';
import type { NameVariant } from '@/app/components/person-form/NamesPanel';
import type { CitationFactDescriptor } from '@/app/components/citations/types';
import type { SourceNumbers } from '@/app/components/citations/factDescriptors';
import type { CiteSheetsSlot } from '@/app/components/citations/CiteSheets';
import DateInput from '@/app/components/DateInput';
import { FilterChip, MobileRow, citeClass, cx, fieldClass } from '@/app/components/ui';
import { ConfirmSheet, Sheet } from '@/app/components/ui/Sheet';
import { Plus, Trash2 } from '@/lib/icons';
import { nameBarParts, vitalBirth, vitalDeath } from './model';
import type { RunChange } from './useChange';

/*
 * The phone's typing sheets for the person's own words (#1052, tracking #1054): the
 * biography, a name variant and a note. Each is full height with Save in the header,
 * asks before discarding, and reports through the Undo toast. They replace the
 * desktop's save-on-blur, which on a phone fires when the keyboard closes.
 */

/** The six name types (ADR 0001), in the chips' order. */
const NAME_TYPES = ['Nickname', 'Maiden', 'Married', 'Anglicized', 'Alias', 'Given'] as const;

/** "12 Sep 2026" in the reader's language, or null for a missing or broken stamp. */
export function noteDate(n: Pick<Note, 'UpdatedAt' | 'CreatedAt'>, language: string): string | null {
    const at = n.UpdatedAt ?? n.CreatedAt;
    const d = at ? new Date(at) : null;
    return d && !Number.isNaN(d.getTime())
        ? new Intl.DateTimeFormat(language, { day: 'numeric', month: 'short', year: 'numeric' }).format(d)
        : null;
}

function Chip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
    return (
        <FilterChip active={active} label={label} aria-pressed={active} onClick={onClick}
            className="!h-[34px] px-3.5 relative before:absolute before:-inset-[5px] before:content-['']" />
    );
}

function SwitchRow({ label, sub, checked, onChange }: { label: string; sub?: string; checked: boolean; onChange: (v: boolean) => void }) {
    return (
        <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
            className="flex w-full min-h-11 items-center gap-3 py-3 text-left cursor-pointer active:bg-surface-2 focus-ring-inset">
            <span className="flex-1 min-w-0 grid gap-px">
                <span className="text-base font-semibold text-text">{label}</span>
                {sub && <span className="text-meta text-text-muted">{sub}</span>}
            </span>
            <span aria-hidden="true" className={cx('relative w-11 h-[26px] shrink-0 rounded-full transition-colors', checked ? 'bg-text' : 'bg-surface-2 border border-border')}>
                <span className={cx('absolute top-[3px] w-5 h-5 rounded-full bg-card shadow transition-[left]', checked ? 'left-[21px]' : 'left-[3px]')} />
            </span>
        </button>
    );
}

/* ── Biography ────────────────────────────────────────────────────────────── */

export function BiographySheet({ open, onClose, person, biography, treeId, language, run, onSaved }: {
    open: boolean; onClose: () => void; person: PersonWithRelations; biography: Note | null;
    treeId: number | null; language: string; run: RunChange; onSaved: () => void;
}) {
    // A fresh opening starts from what's saved.
    const [opened, setOpened] = useState(0);
    const [wasOpen, setWasOpen] = useState(open);
    if (open !== wasOpen) { setWasOpen(open); if (open) setOpened((n) => n + 1); }
    return <BiographyBody key={opened} open={open} onClose={onClose} person={person} biography={biography} treeId={treeId} language={language} run={run} onSaved={onSaved} />;
}

function BiographyBody({ open, onClose, person, biography, treeId, language, run, onSaved }: Parameters<typeof BiographySheet>[0]) {
    const t = useTranslations('mobileProfile');
    const ids = useId();
    const [text, setText] = useState(biography?.Text ?? '');
    const [saving, setSaving] = useState(false);
    const name = nameBarParts(person).given || t('this_person');
    const dirty = text.trim() !== (biography?.Text ?? '').trim();
    const edited = biography ? noteDate(biography, language) : null;

    const save = async () => {
        const body = text.trim();
        if (!body || saving) return;
        setSaving(true);
        const ok = await run(async () => {
            const client = await getDataClient();
            const auditIds: number[] = [];
            let id = biography?.Id;
            if (biography) {
                auditIds.push(...(await client.notes.update(biography.Id, 'People', person.Id, body, treeId)).auditIds);
            } else {
                const note = await client.notes.create('People', person.Id, body, treeId);
                auditIds.push(...note.auditIds);
                id = note.Id;
            }
            // A biography that was only standing in (an imported note, #902) becomes the chosen one.
            if (id != null && biography?.IsPrimary !== 1) {
                auditIds.push(...(await client.notes.setPrimary(id, 'People', person.Id, true, treeId)).auditIds);
            }
            return { auditIds };
        }, { message: t('bio_saved') });
        setSaving(false);
        if (ok) { onSaved(); onClose(); }
    };

    return (
        <Sheet open={open} onClose={onClose} title={t('biography')} size="full" dirty={dirty} onSave={save}
            saveDisabled={saving || !text.trim()} discardMessage={t('bio_discard')}>
            <label htmlFor={`${ids}-bio`} className="sr-only">{t('biography')}</label>
            <textarea
                id={`${ids}-bio`}
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={20000}
                placeholder={t('bio_placeholder', { name })}
                className="block w-full min-h-[260px] py-3.5 bg-transparent border-0 resize-none serif text-md leading-relaxed text-text outline-none placeholder:text-text-muted input-nozoom"
            />
            <div className="flex justify-between gap-3 pt-2.5 border-t border-border text-meta text-text-muted">
                <span>{t('plain_text')}</span>
                <span>{edited ? t('edited', { date: edited }) : t('new')}</span>
            </div>
        </Sheet>
    );
}

/* ── Names ────────────────────────────────────────────────────────────────── */

export function NameSheet({ variant, variants, open, onClose, person, treeId, canDelete, facts, sourceNumbers, run, citeSheets }: {
    /** The variant to edit, or null to add one. */
    variant: NameVariant | null;
    /** All their names, for the first-nickname rule. */
    variants: NameVariant[];
    open: boolean; onClose: () => void; person: PersonWithRelations; treeId: number | null;
    canDelete: boolean; facts: CitationFactDescriptor[]; sourceNumbers: SourceNumbers; run: RunChange;
    citeSheets: CiteSheetsSlot;
}) {
    const [opened, setOpened] = useState(0);
    const [wasOpen, setWasOpen] = useState(open);
    if (open !== wasOpen) { setWasOpen(open); if (open) setOpened((n) => n + 1); }
    return <NameBody key={opened} {...{ variant, variants, open, onClose, person, treeId, canDelete, facts, sourceNumbers, run, citeSheets }} />;
}

function NameBody({ variant, variants, open, onClose, person, treeId, canDelete, facts, sourceNumbers, run, citeSheets }: Parameters<typeof NameSheet>[0]) {
    const t = useTranslations('mobileProfile');
    const tp = useTranslations('personDetail');
    const ids = useId();
    const saved = {
        name: variant?.Name ?? '',
        type: variant?.Type ?? 'Nickname',
        primary: !!variant?.IsPrimary,
        from: variant?.FromDate ?? '',
    };
    const [draft, setDraft] = useState(saved);
    // A first nickname becomes the shown first name unless they say otherwise (#436, ADR 0001),
    // so a new name's switch follows its type until it's touched.
    const [primaryTouched, setPrimaryTouched] = useState(false);
    const autoPrimary = !variant && !primaryTouched && draft.type === 'Nickname' && !variants.some((v) => v.IsPrimary);
    const primary = autoPrimary || (primaryTouched || variant ? draft.primary : false);
    const [showFrom, setShowFrom] = useState(Boolean(saved.from));
    const [saving, setSaving] = useState(false);
    const [confirming, setConfirming] = useState(false);
    // Whose first name: their birth one, since this switch may be what changes it.
    const first = (person.FirstName ?? '').trim().split(/\s+/)[0] || nameBarParts(person).given || t('this_person');
    const changed = (k: keyof typeof saved) => draft[k] !== saved[k];
    // A new name starts from the automatic switch, so that start isn't a change.
    const startPrimary = variant ? saved.primary : saved.type === 'Nickname' && !variants.some((v) => v.IsPrimary);
    const dirty = changed('name') || changed('type') || primary !== startPrimary || draft.from.trim() !== saved.from.trim();
    const typeLabel = (type: string) => {
        const key = `vtype_${type.toLowerCase()}`;
        return tp.has(key as Parameters<typeof tp>[0]) ? tp(key as Parameters<typeof tp>[0]) : type;
    };
    const [citing, setCiting] = useState(false);
    const factDescriptor = variant ? facts.find((x) => x.factTable === FACT_TABLES.NAME_VARIANT && x.factId === variant.Id) ?? null : null;
    const citations = factDescriptor?.citations ?? [];

    const save = async () => {
        const name = draft.name.trim();
        if (!name || saving) return;
        setSaving(true);
        const from = draft.from.trim() || null;
        const ok = await run(async () => {
            const client = await getDataClient();
            const auditIds: number[] = [];
            let id = variant?.Id;
            let created: { IsPrimary: number } | null = null;
            if (variant) {
                if (changed('name') || changed('type') || (from ?? '') !== saved.from) {
                    auditIds.push(...(await client.people.updateNameVariant(person.Id, variant.Id, name, treeId,
                        { FromDate: from, ToDate: variant.ToDate, Type: draft.type })).auditIds);
                }
            } else {
                const v = await client.people.createNameVariant(person.Id, { Type: draft.type, Name: name, FromDate: from }, treeId);
                auditIds.push(...v.auditIds);
                id = v.Id;
                created = v;
            }
            const isPrimary = variant ? !!variant.IsPrimary : !!created?.IsPrimary;
            if (id != null && primary !== isPrimary) {
                auditIds.push(...(await client.people.setPrimaryNameVariant(person.Id, id, primary, treeId)).auditIds);
            }
            return { auditIds };
        }, { message: variant ? t('name_updated') : t('name_added'), detail: name });
        setSaving(false);
        if (ok) onClose();
    };

    const remove = async () => {
        if (!variant) return;
        setSaving(true);
        const ok = await run(async () => {
            const client = await getDataClient();
            return client.people.removeNameVariant(person.Id, variant.Id, treeId);
        }, { message: t('name_deleted'), detail: variant.Name });
        setSaving(false);
        setConfirming(false);
        if (ok) onClose();
    };

    return (
        <Sheet open={open} onClose={onClose} title={variant ? t('edit_name') : t('add_name')} size="full" dirty={dirty}
            onSave={save} saveDisabled={saving || !draft.name.trim()}>
            <div className="grid gap-3 pb-3">
                <div className="grid gap-1.5">
                    <label htmlFor={`${ids}-name`} className="text-meta font-medium text-text-secondary">{t('field_name')}</label>
                    <input id={`${ids}-name`} type="text" value={draft.name} maxLength={200} autoComplete="off" enterKeyHint="done"
                        placeholder={t('name_placeholder')}
                        onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                        className={cx(fieldClass(), 'min-h-11')} />
                </div>
                <div role="group" aria-labelledby={`${ids}-type`} className="grid gap-1.5">
                    <span id={`${ids}-type`} className="text-meta font-medium text-text-secondary">{t('field_type')}</span>
                    <div className="flex flex-wrap gap-1.5">
                        {/* An imported type outside the six stays offered while chosen. */}
                        {[...NAME_TYPES, ...((NAME_TYPES as readonly string[]).includes(saved.type) ? [] : [saved.type])].map((type) => (
                            <Chip key={type} active={draft.type === type} label={typeLabel(type)} onClick={() => setDraft((d) => ({ ...d, type }))} />
                        ))}
                    </div>
                </div>
            </div>

            <div className="border-t border-border">
                <SwitchRow label={t('show_as_first', { name: first })} checked={primary}
                    onChange={(next) => { setPrimaryTouched(true); setDraft((d) => ({ ...d, primary: next })); }} />
                {showFrom ? (
                    <div className="grid gap-1.5 pt-2 pb-3">
                        <label htmlFor={`${ids}-from`} className="text-meta font-medium text-text-secondary">{t('used_from')}</label>
                        <DateInput id={`${ids}-from`} value={draft.from} onChange={(from) => setDraft((d) => ({ ...d, from }))} touch className={cx(fieldClass(), 'min-h-11')} />
                    </div>
                ) : (
                    <MobileRow icon={<Plus />} label={t('add_used_from')} end="chevron" onClick={() => setShowFrom(true)} className="!px-0 border-t border-border" />
                )}
            </div>

            {variant && (
                <div className="-mx-4 border-t border-border pt-4">
                    <h3 className="eyebrow m-0 px-4 mb-1">{t('sources')}</h3>
                    {citations.length === 0 && <p className="m-0 px-4 pb-1 text-base text-text-muted">{t('no_source_yet')}</p>}
                    {citations.map((c) => (
                        <div key={c.Id} className="flex items-start gap-2 px-4 py-1.5 text-base leading-snug">
                            <span className={cx(citeClass(), 'shrink-0 mt-0.5')}>{sourceNumbers.get(c.SourceId)}</span>
                            <span className="min-w-0">{c.sourceTitle ?? t('source_fallback')}{c.Page ? <span className="text-text-muted"> · {c.Page}</span> : null}</span>
                        </div>
                    ))}
                    {/* Cite a source opens on top of this sheet, so nothing typed here is lost. */}
                    <MobileRow icon={<Plus />} end="chevron" label={t('cite_source')} onClick={() => setCiting(true)} />
                    {citeSheets(citing && factDescriptor ? { fact: factDescriptor, start: 'pick' } : null, () => setCiting(false))}
                </div>
            )}

            {variant && canDelete && (
                <div className="-mx-4 border-t border-border mt-2">
                    <MobileRow icon={<Trash2 />} tone="danger" label={t('delete_name')} onClick={() => setConfirming(true)} />
                </div>
            )}
            {variant && (
                <ConfirmSheet open={confirming} title={t('delete_name_title', { name: variant.Name })} body={t('delete_name_body')}
                    confirmLabel={t('delete_name')} onConfirm={remove} onClose={() => setConfirming(false)} busy={saving} />
            )}
        </Sheet>
    );
}

/* ── Notes ────────────────────────────────────────────────────────────────── */

/** What a note is about: the person in general, or one of their promoted facts (ADR 0016). */
type About = NoteOwnerFact | null;

export function useAboutLabel(person: PersonWithRelations) {
    const t = useTranslations('mobileProfile');
    const name = nameBarParts(person).given || t('this_person');
    return (about: About) => (about === 'Birth' ? t('about_birth') : about === 'Death' ? t('about_death') : about === 'Marriage' ? t('about_marriage') : t('about_person', { name }));
}

export function NoteSheet({ note, open, onClose, person, treeId, canDelete, run }: {
    /** The note to edit, or null to add one. */
    note: Note | null;
    open: boolean; onClose: () => void; person: PersonWithRelations; treeId: number | null;
    canDelete: boolean; run: RunChange;
}) {
    const [opened, setOpened] = useState(0);
    const [wasOpen, setWasOpen] = useState(open);
    if (open !== wasOpen) { setWasOpen(open); if (open) setOpened((n) => n + 1); }
    return <NoteBody key={opened} {...{ note, open, onClose, person, treeId, canDelete, run }} />;
}

function NoteBody({ note, open, onClose, person, treeId, canDelete, run }: Parameters<typeof NoteSheet>[0]) {
    const t = useTranslations('mobileProfile');
    const ids = useId();
    const aboutLabel = useAboutLabel(person);
    const [text, setText] = useState(note?.Text ?? '');
    const [about, setAbout] = useState<About>(note?.OwnerFact ?? null);
    const [asBio, setAsBio] = useState(false);
    const [saving, setSaving] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const name = nameBarParts(person).given || t('this_person');
    const dirty = text.trim() !== (note?.Text ?? '').trim() || about !== (note?.OwnerFact ?? null) || asBio;
    // A note's fact is set when it's written and never moved after (ADR 0016), so
    // only a new note offers the choice: the person, or a birth or death they have.
    const choices: About[] = [null, ...(vitalBirth(person) ? ['Birth' as const] : []), ...(vitalDeath(person) ? ['Death' as const] : [])];

    const save = async () => {
        const body = text.trim();
        if (!body || saving) return;
        setSaving(true);
        const ok = await run(async () => {
            const client = await getDataClient();
            const auditIds: number[] = [];
            let id = note?.Id;
            if (note) {
                if (body !== note.Text.trim()) auditIds.push(...(await client.notes.update(note.Id, 'People', person.Id, body, treeId)).auditIds);
            } else {
                const created = await client.notes.create('People', person.Id, body, treeId, about ?? undefined);
                auditIds.push(...created.auditIds);
                id = created.Id;
            }
            // Only by choice: a note written here never becomes the biography on its own (#902).
            if (asBio && id != null) auditIds.push(...(await client.notes.setPrimary(id, 'People', person.Id, true, treeId)).auditIds);
            return { auditIds };
        }, { message: asBio ? t('note_now_bio') : note ? t('note_saved') : t('note_added') });
        setSaving(false);
        if (ok) onClose();
    };

    const remove = async () => {
        if (!note) return;
        setSaving(true);
        const ok = await run(async () => {
            const client = await getDataClient();
            return client.notes.remove(note.Id, 'People', person.Id, treeId);
        }, { message: t('note_deleted') });
        setSaving(false);
        setConfirming(false);
        if (ok) onClose();
    };

    return (
        <Sheet open={open} onClose={onClose} title={note ? t('note') : t('new_note')} size="full" dirty={dirty} onSave={save}
            saveDisabled={saving || !text.trim()} discardMessage={note ? undefined : t('note_discard')}>
            <label htmlFor={`${ids}-note`} className="sr-only">{t('note')}</label>
            <textarea
                id={`${ids}-note`}
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={20000}
                placeholder={t('note_placeholder')}
                className="block w-full min-h-[150px] py-3.5 bg-transparent border-0 resize-none text-md leading-relaxed text-text outline-none placeholder:text-text-muted input-nozoom"
            />
            <div className="grid gap-2.5 pt-4 pb-1 border-t border-border">
                <h3 id={`${ids}-about`} className="eyebrow m-0">{t('about')}</h3>
                {note ? (
                    <p className="m-0 text-base text-text">{aboutLabel(note.OwnerFact ?? null)}</p>
                ) : (
                    <div role="group" aria-labelledby={`${ids}-about`} className="flex flex-wrap gap-1.5">
                        {choices.map((c) => (
                            <Chip key={c ?? 'person'} active={about === c} label={c ? aboutLabel(c) : t('about_in_general', { name })}
                                onClick={() => { setAbout(c); if (c) setAsBio(false); }} />
                        ))}
                    </div>
                )}
            </div>
            {/* The biography is about the person, not one fact. */}
            {about == null && (
                <div className="mt-2 border-t border-border">
                    <SwitchRow label={t('use_as_bio')} sub={t('use_as_bio_sub')} checked={asBio} onChange={setAsBio} />
                </div>
            )}
            {note && canDelete && (
                <div className="-mx-4 border-t border-border mt-2">
                    <MobileRow icon={<Trash2 />} tone="danger" label={t('delete_note')} onClick={() => setConfirming(true)} />
                </div>
            )}
            {note && (
                <ConfirmSheet open={confirming} title={t('delete_note_title')} body={t('delete_note_body')}
                    confirmLabel={t('delete_note')} onConfirm={remove} onClose={() => setConfirming(false)} busy={saving} />
            )}
        </Sheet>
    );
}
