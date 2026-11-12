'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { getDataClient } from '@/lib/data';
import type { Note, NoteLinkEnd, NoteOwnerFact } from '@/lib/data/types';
import type { PersonWithRelations } from '@/lib/db/schema';
import { EVENT_TYPES, getEventDisplayType } from '@/lib/db/schema';
import { sortableYear } from '@/lib/date-utils';
import { ActionLink, AddRow, Card, InlinePanel, SectionHeader, SelectField, cx, fieldClass } from '@/app/components/ui';
import { biographyNote, visibleNotes } from '@/app/components/notes/OwnerNotesCard';
import { hasBirthFact, hasDeathFact } from '../derive';
import { nameBarParts } from '../mobile/model';
import type { RunChange } from '../mobile/useChange';

/** One note on the page, with the record it is linked through. */
interface NoteRow {
  note: Note;
  end: NoteLinkEnd;
  label: string;
  /** The person's biography: listed, but edited in the cover. */
  biography: boolean;
}

/** An "About" choice, keyed so the select can hold it as a string. */
interface About {
  key: string;
  label: string;
  end: NoteLinkEnd;
}

const endKey = (end: NoteLinkEnd) => `${end.ownerTable}:${end.ownerId}:${end.ownerFact ?? ''}`;
const excerpt = (text: string) => (text.length > 40 ? `${text.slice(0, 40)}…` : text);

/**
 * The desktop person page's Notes (#49): everything written about the person,
 * each labelled with what it is about (the biography, the person in general, the
 * birth or death, one of their events). Opening a note edits it in place, and its
 * "About" select moves it to another of those (ADR 0043). It loads the person's
 * notes for the whole page and reports them, so the cover's biography and the
 * timeline's Birth/Death counts read the same rows.
 */
export function NotesSection({ person, treeId, canEdit, canDelete, run, refreshKey, onNotesChange, onEditBiography }: {
  person: PersonWithRelations;
  treeId: number | null;
  canEdit: boolean;
  canDelete: boolean;
  run: RunChange;
  refreshKey: number;
  onNotesChange: (notes: Note[]) => void;
  onEditBiography: () => void;
}) {
  const t = useTranslations('personDesktop');
  const tn = useTranslations('notes');
  const tp = useTranslations('personDetail');
  const tTypes = useTranslations('eventTypes');
  const ids = useId();
  const [personNotes, setPersonNotes] = useState<Note[]>([]);
  const [eventNotes, setEventNotes] = useState<{ eventId: number; notes: Note[] }[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [about, setAbout] = useState('');
  const [saving, setSaving] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const report = useRef(onNotesChange);
  useEffect(() => { report.current = onNotesChange; }, [onNotesChange]);

  const events = person.events ?? [];
  // Re-read whenever the person reloads (an event panel writes event notes) or a
  // sibling surface writes the person's notes (the cover's biography).
  const withNotes = events.filter((e) => (e.noteCount ?? 0) > 0).map((e) => e.Id).join(',');
  useEffect(() => {
    let live = true;
    (async () => {
      const client = await getDataClient();
      const [own, ...byEvent] = await Promise.all([
        client.notes.listForOwner('People', person.Id, treeId),
        ...(withNotes ? withNotes.split(',').map(Number) : []).map(async (eventId) => ({ eventId, notes: await client.notes.listForOwner('Events', eventId, treeId) })),
      ]);
      if (!live) return;
      setPersonNotes(own as Note[]);
      setEventNotes(byEvent as { eventId: number; notes: Note[] }[]);
      report.current(own as Note[]);
    })().catch(() => { /* The page shows the person's own load errors; notes stay as they were. */ });
    return () => { live = false; };
  }, [person.Id, treeId, withNotes, refreshKey]);

  const given = nameBarParts(person).given || tp('this_person');
  const eventLabel = (type: string, date: string | null | undefined) => {
    const title = EVENT_TYPES[type] ? tTypes(type as Parameters<typeof tTypes>[0]) : getEventDisplayType(type);
    const year = sortableYear(date ?? null);
    return year != null ? `${title} · ${year}` : title;
  };
  const factLabel = (fact: NoteOwnerFact) => {
    if (fact === 'Birth') return eventLabel('BIRT', person.BirthDate);
    if (fact === 'Death') return eventLabel('DEAT', person.DeathDate);
    return tn('scope_marriage');
  };

  const biography = biographyNote(visibleNotes(personNotes, 'unscoped'));
  const person0 = (ownerFact: NoteOwnerFact | null): NoteLinkEnd => ({ ownerTable: 'People', ownerId: person.Id, ownerFact });
  const rows: NoteRow[] = [
    ...(biography ? [{ note: biography, end: person0(null), label: t('note_biography'), biography: true }] : []),
    ...personNotes.filter((n) => n.Id !== biography?.Id || n.OwnerFact).map((n) => ({
      note: n,
      end: person0(n.OwnerFact ?? null),
      label: n.OwnerFact ? factLabel(n.OwnerFact) : t('note_about_person', { name: given }),
      biography: false,
    })),
    ...eventNotes.flatMap(({ eventId, notes }) => {
      const ev = events.find((e) => e.Id === eventId);
      return ev ? notes.map((n) => ({ note: n, end: { ownerTable: 'Events' as const, ownerId: eventId, ownerFact: null }, label: eventLabel(ev.Type, ev.Date), biography: false })) : [];
    }),
  ];

  const abouts: About[] = [
    { end: person0(null), label: t('note_about_general', { name: given }) },
    ...(hasBirthFact(person) ? [{ end: person0('Birth'), label: factLabel('Birth') }] : []),
    ...(hasDeathFact(person) ? [{ end: person0('Death'), label: factLabel('Death') }] : []),
    ...events.map((e) => ({ end: { ownerTable: 'Events' as const, ownerId: e.Id, ownerFact: null }, label: eventLabel(e.Type, e.Date) })),
  ].map((a) => ({ ...a, key: endKey(a.end) }));

  const rowKey = (r: NoteRow) => `${endKey(r.end)}#${r.note.Id}`;
  const editing = rows.find((r) => rowKey(r) === open) ?? null;
  // An imported note can sit on a fact this page no longer offers (a Marriage note
  // on a person): keep it choosable so opening the note never moves it.
  const choices = editing && !abouts.some((a) => a.key === endKey(editing.end))
    ? [{ key: endKey(editing.end), label: editing.label, end: editing.end }, ...abouts]
    : abouts;

  const close = () => {
    const was = open;
    setOpen(null);
    requestAnimationFrame(() => {
      const target = was && was !== 'new' ? wrap.current?.querySelector<HTMLElement>(`[data-note-row="${CSS.escape(was)}"]`) : null;
      (target ?? wrap.current?.querySelector<HTMLElement>('[data-note-add]'))?.focus();
    });
  };
  const start = (r: NoteRow | null) => {
    if (r?.biography) { onEditBiography(); return; }
    setText(r?.note.Text ?? '');
    setAbout(r ? endKey(r.end) : endKey(person0(null)));
    setOpen(r ? rowKey(r) : 'new');
  };

  const target = choices.find((a) => a.key === about)?.end ?? person0(null);
  const dirty = editing
    ? text.trim() !== editing.note.Text.trim() || about !== endKey(editing.end)
    : text.trim() !== '';

  const save = async () => {
    const body = text.trim();
    if (saving || !body) return;
    if (!dirty) { close(); return; }
    setSaving(true);
    const ok = await run(async () => {
      const client = await getDataClient();
      if (!editing) {
        const note = await client.notes.create(target.ownerTable, target.ownerId, body, treeId, target.ownerFact ?? undefined);
        return { auditIds: note.auditIds };
      }
      const auditIds: number[] = [];
      if (body !== editing.note.Text.trim()) {
        auditIds.push(...(await client.notes.update(editing.note.Id, editing.end.ownerTable, editing.end.ownerId, body, treeId)).auditIds);
      }
      if (about !== endKey(editing.end)) {
        auditIds.push(...(await client.notes.move(editing.note.Id, editing.end, target, treeId)).auditIds);
      }
      return { auditIds };
    }, { message: editing ? t('note_saved') : t('note_added') });
    setSaving(false);
    if (ok) close();
  };

  const remove = async () => {
    if (!editing) return;
    setSaving(true);
    const ok = await run(async () => {
      const client = await getDataClient();
      return client.notes.remove(editing.note.Id, editing.end.ownerTable, editing.end.ownerId, treeId);
    }, { message: t('note_deleted') });
    setSaving(false);
    if (ok) close();
  };

  const makeBiography = async () => {
    if (!editing) return;
    setSaving(true);
    const ok = await run(async () => {
      const client = await getDataClient();
      const auditIds: number[] = [];
      if (text.trim() !== editing.note.Text.trim() && text.trim()) {
        auditIds.push(...(await client.notes.update(editing.note.Id, 'People', person.Id, text.trim(), treeId)).auditIds);
      }
      auditIds.push(...(await client.notes.setPrimary(editing.note.Id, 'People', person.Id, true, treeId)).auditIds);
      return { auditIds };
    }, { message: t('note_now_biography') });
    setSaving(false);
    if (ok) close();
  };

  const panel = (r: NoteRow | null) => (
    <InlinePanel
      label={r ? t('note_edit') : tn('new_note')}
      onSave={save}
      onCancel={close}
      saving={saving}
      saveDisabled={!text.trim()}
      dirty={dirty}
      onDelete={r && canDelete ? remove : undefined}
      deleteLabel={t('note_delete')}
    >
      <div className="flex flex-col gap-1 max-w-[340px]">
        <label htmlFor={`${ids}-about`} className="text-meta font-medium text-text-secondary">{t('note_about')}</label>
        <SelectField id={`${ids}-about`} value={about} onChange={setAbout} options={choices.map((a) => ({ value: a.key, label: a.label }))} />
      </div>
      <label htmlFor={`${ids}-text`} className="sr-only">{tn('section_title')}</label>
      <textarea
        id={`${ids}-text`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        placeholder={t('note_placeholder')}
        className={cx(fieldClass(), 'text-base leading-relaxed resize-y min-h-[120px]')}
      />
      {r && r.end.ownerTable === 'People' && about === endKey(person0(null)) && r.end.ownerFact == null && (
        <div><ActionLink onClick={makeBiography}>{tn('use_as_biography')}</ActionLink></div>
      )}
    </InlinePanel>
  );

  return (
    <div ref={wrap}>
      <SectionHeader headingId="notes-title" title={tn('section_title')} count={rows.length} />
      {rows.length === 0 && !canEdit ? (
        <p className="m-0 text-sm text-text-muted">{tn('empty')}</p>
      ) : (
        <Card pad={false}>
          {rows.length > 0 && (
            <ul className="list-none m-0 p-2">
              {rows.map((r) => {
                const key = rowKey(r);
                return (
                  <li key={key} className="border-t border-border-light first:border-t-0">
                    {open === key && canEdit ? <div className="p-2">{panel(r)}</div> : (
                      <button
                        type="button"
                        data-note-row={key}
                        disabled={!canEdit}
                        onClick={() => start(r)}
                        aria-label={canEdit ? tn('edit_for', { excerpt: excerpt(r.note.Text) }) : undefined}
                        className="block w-full text-left rounded-btn border-0 bg-transparent px-2 py-2.5 enabled:hover:bg-hover-surface enabled:cursor-pointer focus-ring disabled:cursor-default"
                      >
                        <span className="block eyebrow mb-1">{r.label}</span>
                        <span className="block text-base leading-[1.6] text-text whitespace-pre-wrap break-words line-clamp-4">{r.note.Text}</span>
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {canEdit && (open === 'new'
            ? <div className={cx('p-4', rows.length > 0 && 'border-t border-border-light')}>{panel(null)}</div>
            : <AddRow data-note-add label={tn('add_button')} onClick={() => start(null)} className={cx(rows.length > 0 && 'border-t border-border-light')} />)}
        </Card>
      )}
    </div>
  );
}
