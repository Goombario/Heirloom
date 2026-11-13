'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { Note } from '@/lib/data/types';
import { getDataClient } from '@/lib/data';
import { ActionLink, InlinePanel, LeadText, cx, fieldClass } from '@/app/components/ui';
import type { RunChange } from '@/app/people/view/mobile/useChange';

export interface LeadNoteLabels {
  /** The eyebrow over it: "Biography", "About this family". */
  heading: string;
  add: string;
  /** A line under "Add …" saying what goes here. */
  hint?: string;
  edit: string;
  remove: string;
  placeholder: string;
  saved: string;
  removed: string;
}

/**
 * The lead note beside a v1.1 cover's portrait: three lines and "Read all ⌄", with
 * Edit opening it in place. It writes the owner's preferred note (ADR 0010/0012); a
 * stand-in note (an imported one, #902) becomes the chosen one. Clearing it removes
 * the note from this owner, with Undo for editors. The person page's biography and
 * the family page's "About this family" are both this.
 */
export function LeadNote({ ownerTable, ownerId, note, treeId, canEdit, canDelete, run, request = 0, labels }: {
  ownerTable: 'People' | 'Families';
  ownerId: number;
  note: Note | null;
  treeId: number | null;
  canEdit: boolean;
  canDelete: boolean;
  run: RunChange;
  /** Bumped from elsewhere on the page (Notes → Biography): opens the editor here. */
  request?: number;
  labels: LeadNoteLabels;
}) {
  const ids = useId();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  // Closing hands focus back to whichever link opened the panel (#690).
  const wrap = useRef<HTMLDivElement>(null);
  const saved = note?.Text ?? '';

  const close = () => {
    setEditing(false);
    requestAnimationFrame(() => Array.from(wrap.current?.querySelectorAll<HTMLElement>('button') ?? []).pop()?.focus());
  };
  const open = () => { setText(saved); setEditing(true); };
  // A request from elsewhere opens the editor during render (no effect round-trip),
  // then an effect brings it into view.
  const [seen, setSeen] = useState(request);
  const [scrollTo, setScrollTo] = useState(0);
  if (request !== seen) {
    setSeen(request);
    if (canEdit) {
      setText(note?.Text ?? '');
      setEditing(true);
      setScrollTo((n) => n + 1);
    }
  }
  useEffect(() => {
    if (scrollTo > 0) wrap.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [scrollTo]);

  const save = async () => {
    const body = text.trim();
    if (saving) return;
    if (body === saved.trim()) { close(); return; }
    if (!body) { await remove(); return; }
    setSaving(true);
    const ok = await run(async () => {
      const client = await getDataClient();
      const auditIds: number[] = [];
      let id = note?.Id;
      if (note) {
        auditIds.push(...(await client.notes.update(note.Id, ownerTable, ownerId, body, treeId)).auditIds);
      } else {
        const created = await client.notes.create(ownerTable, ownerId, body, treeId);
        auditIds.push(...created.auditIds);
        id = created.Id;
      }
      if (id != null && note?.IsPrimary !== 1) {
        auditIds.push(...(await client.notes.setPrimary(id, ownerTable, ownerId, true, treeId)).auditIds);
      }
      return { auditIds };
    }, { message: labels.saved });
    setSaving(false);
    if (ok) close();
  };

  const remove = async () => {
    if (!note) { close(); return; }
    setSaving(true);
    // Unlinking deletes the note only when no other record still points at it.
    const ok = await run(async () => {
      const client = await getDataClient();
      return client.notes.remove(note.Id, ownerTable, ownerId, treeId);
    }, { message: labels.removed });
    setSaving(false);
    if (ok) close();
  };

  let body: React.ReactNode = null;
  if (editing) {
    body = (
      <InlinePanel label={labels.edit} onSave={save} onCancel={close} saving={saving} dirty={text.trim() !== saved.trim()}
        onDelete={canDelete && note ? remove : undefined} deleteLabel={labels.remove}>
        <label htmlFor={`${ids}-lead`} className="sr-only">{labels.heading}</label>
        <textarea
          id={`${ids}-lead`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={20000}
          rows={6}
          placeholder={labels.placeholder}
          className={cx(fieldClass(), 'serif text-md leading-relaxed resize-y min-h-[140px]')}
        />
      </InlinePanel>
    );
  } else if (!note) {
    body = canEdit ? (
      <>
        <span><ActionLink onClick={open}>{labels.add}</ActionLink></span>
        {labels.hint && <p className="m-0 text-meta text-text-muted">{labels.hint}</p>}
      </>
    ) : null;
  } else {
    body = <LeadText onEdit={canEdit ? open : undefined} editLabel={labels.edit}>{note.Text}</LeadText>;
  }

  // The board labels the lead whenever there is one, or an editor can write one.
  return (
    <div ref={wrap} className="grid gap-1.5">
      {(note || canEdit) && <h2 className="eyebrow m-0">{labels.heading}</h2>}
      {body}
    </div>
  );
}
