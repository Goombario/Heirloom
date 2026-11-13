'use client';

import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { getDataClient } from '@/lib/data';
import { errorToastKey } from '@/lib/utils/data-error';
import { useErrorToast } from '@/app/components/useErrorToast';
import { AddRow, EditorActions, InlineDataError, RowAction, RowActions, fieldClass } from '@/app/components/ui';
// The rail has ONE add affordance — the row at the foot of the card. The mockup's
// second, header-corner "+" went with the built-in title it sat beside.
import ConfirmDialog from '@/app/components/ConfirmDialog';
import { Bookmark, BookmarkX } from '@/lib/icons';
import type { Note, NoteOwnerFact } from '@/lib/data/types';
import type { LinkOwnerTable } from '@/lib/db/fact-tables';

/**
 * A notes list for any owner record (person, family, source, …) backed by
 * Note + NoteLink — the "Direction C" rail.
 *
 * The preferred note sits FIRST under its own label and is otherwise styled
 * exactly like the rest: position and label are the only cue, never colour, so
 * the rail reads the same for a colour-blind user. Each row's actions (#760: shown
 * on hover or focus, always on touch) carry
 * make/unset preferred, edit and delete; delete routes through the project's
 * shared confirm dialog.
 */
export function OwnerNotesCard({
    ownerTable,
    ownerId,
    treeId,
    canEdit,
    canDelete,
    header,
    headerRule = false,
    onNotesChange,
    refreshKey,
    factScope,
    showPreferred = true,
    shownElsewhereId = null,
    preferredIsBiography = false,
    look = 'card',
}: {
    /**
     * `plain`: inside the desktop event panel (locked person board), with no card
     * chrome and no empty line: the label above it, the notes, and "Add a note".
     */
    look?: 'card' | 'plain';
    ownerTable: LinkOwnerTable;
    ownerId: number;
    treeId: number | null;
    canEdit: boolean;
    /** Delete note rows (owner/edit); contributors may still add and edit. */
    canDelete: boolean;
    /** Optional heading rendered in the card's title slot (rail sections pass one). */
    header?: ReactNode;
    /** The `header` draws its own rule (a rail `SectionHeader`), so the first row or
     *  section label below it doesn't add a second one. */
    headerRule?: boolean;
    /**
     * Called with the owner's FULL list after every load and mutation — deliberately
     * unfiltered, whatever `factScope` is set to. Lets a page render something derived
     * from these notes without a second fetch of the same rows: the person hero's
     * preferred-note quote, and the timeline's per-vital note counts, which have to know
     * a Birth note exists before its rail is ever mounted. Consumers that want only what
     * this card DISPLAYS pass the list back through `visibleNotes`.
     */
    onNotesChange?: (notes: Note[]) => void;
    /**
     * Bump to force a refetch. For a sibling surface that writes the same owner's
     * notes through its own client calls — the person hero's preferred-note editor —
     * so the list re-syncs instead of the two keeping divergent copies.
     */
    refreshKey?: number;
    /**
     * Which of the owner's notes this card is for, by `NoteLink."OwnerFact"`.
     *
     * Omitted (the default) shows every note the owner has — what places and sources
     * want. `'unscoped'` shows only notes with no fact, for a surface whose fact-scoped
     * notes are read somewhere better: the person's Birth/Death notes live on their
     * timeline rows, so every People card passes this. Naming a fact shows only that
     * fact's notes AND creates new ones already scoped to it, which is what those
     * timeline rails mount.
     *
     * This card has no re-scope control; this only decides where a note is read and
     * written. (The desktop person page's Notes can move a note, ADR 0043.)
     */
    factScope?: NoteOwnerFact | 'unscoped';
    /**
     * Whether the preferred-note affordances are offered at all: the row action's
     * make/unset item, the composer's checkbox, and the Preferred/Other section
     * labels. Default true.
     *
     * False is for the surfaces where nothing READS `IsPrimary` — the family page, the
     * tree sidebar, the timeline's rails — where the control was a promise the app
     * never kept. Purely presentational: no `IsPrimary` value is written or cleared, so
     * a note promoted elsewhere keeps its standing and turning this back on restores
     * the previous rendering exactly.
     */
    showPreferred?: boolean;
    /**
     * A note another surface on the page already shows — the person hero's biography
     * (ED-3). The card leaves it out, so the page shows it once; the page labels the
     * card "Other notes" to match. The hero is where that note is edited or cleared.
     */
    shownElsewhereId?: number | null;
    /**
     * The owner's preferred note is the person's biography, shown by the page and
     * left out of this card (`shownElsewhereId`). The row action then reads "Use as
     * the biography" (it replaces the current one), and the composer has no
     * "preferred" box: the biography is written in its own card (#902).
     */
    preferredIsBiography?: boolean;
}) {
    const t = useTranslations('notes');
    const tc = useTranslations('common');
    const scopeKey = `${ownerTable}:${ownerId}:${treeId ?? 'default'}`;
    const [notes, setNotes] = useState<Note[] | null>(null);
    const [notesKey, setNotesKey] = useState(scopeKey);
    const [busy, setBusy] = useState(false);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [editDraft, setEditDraft] = useState('');
    const [adding, setAdding] = useState(false);
    const [draft, setDraft] = useState('');
    const [addPreferred, setAddPreferred] = useState(false);
    const [pendingDelete, setPendingDelete] = useState<number | null>(null);
    const [loadError, setLoadError] = useState<unknown>(null);
    const [loadErrorKey, setLoadErrorKey] = useState<string | null>(null);
    const loadGeneration = useRef(0);
    const scopeRef = useRef({ key: scopeKey, generation: 0 });
    if (scopeRef.current.key !== scopeKey) {
        scopeRef.current = { key: scopeKey, generation: scopeRef.current.generation + 1 };
    }
    const mutationGeneration = useRef(0);
    const { reportError, redirectIfUnauthorized } = useErrorToast();

    type MutationToken = { key: string; scopeGeneration: number; mutationGeneration: number };
    const beginMutation = (): MutationToken => ({
        key: scopeRef.current.key,
        scopeGeneration: scopeRef.current.generation,
        mutationGeneration: ++mutationGeneration.current,
    });
    const isCurrentMutation = (token: MutationToken) => (
        token.key === scopeRef.current.key
        && token.scopeGeneration === scopeRef.current.generation
        && token.mutationGeneration === mutationGeneration.current
    );

    // The card's root, so focus lookups stay inside THIS rail.
    const cardRef = useRef<HTMLDivElement | null>(null);
    // Where focus should go once the next render has landed, for every case where
    // the element it came from has been unmounted in the meantime (a row leaving
    // edit mode, a promote reordering the list, a delete removing the row
    // outright). A note id targets that row's first action; `'add'` targets the add
    // affordance, for when the rail has just emptied and there is no row left.
    const [refocusRow, setRefocusRow] = useState<number | 'add' | null>(null);

    // Kept in a ref so `apply` does not have to list it as a dependency (the
    // parent's callback identity is out of this component's control).
    const notifyRef = useRef(onNotesChange);
    useEffect(() => { notifyRef.current = onNotesChange; }, [onNotesChange]);

    /** Single write path for the list, so the parent is notified exactly once. */
    const apply = useCallback((next: Note[]) => {
        setNotes(next);
        notifyRef.current?.(next);
    }, []);

    const load = useCallback(async () => {
        const generation = ++loadGeneration.current;
        const loadScopeGeneration = scopeRef.current.generation;
        const isCurrentLoad = () => (
            generation === loadGeneration.current
            && scopeRef.current.key === scopeKey
            && scopeRef.current.generation === loadScopeGeneration
        );
        setLoadError(null);
        setLoadErrorKey(null);
        try {
            const client = await getDataClient();
            if (!isCurrentLoad()) return;
            const list = await client.notes.listForOwner(ownerTable, ownerId, treeId);
            if (isCurrentLoad()) {
                apply(list);
                setNotesKey(scopeKey);
            }
        } catch (e) {
            if (!isCurrentLoad()) return;
            if (redirectIfUnauthorized(e)) return;
            if (isCurrentLoad()) {
                setLoadError(e);
                setLoadErrorKey(scopeKey);
            }
        }
        // The composer stays CLOSED here, for every owner including one with no
        // notes. Opening it from `load` would also re-open it on every `refreshKey`
        // bump, reviving a composer the user had just dismissed.
    }, [ownerTable, ownerId, treeId, apply, redirectIfUnauthorized, scopeKey]);

    useEffect(() => {
        // refreshKey is read here rather than inside `load` so it is a genuine
        // dependency of the effect (a bump refetches) instead of a suppressed
        // "unnecessary dependency" on the callback.
        void refreshKey;
        load();
    }, [load, refreshKey]);

    useEffect(() => {
        // Owner/tree changes invalidate every transient control. In particular,
        // an open composer draft belongs to its original owner and must never be
        // submitted using replacement props.
        setAdding(false);
        setDraft('');
        setAddPreferred(false);
        setEditingId(null);
        setEditDraft('');
        setPendingDelete(null);
        setRefocusRow(null);
        setBusy(false);
    }, [scopeKey]);

    // Runs after the render that removed or moved whatever had focus, so the
    // target is looked up fresh rather than held as a node React has thrown away.
    // It also runs AFTER `Modal`'s unmount cleanup on the delete path — React
    // flushes every passive destroy before any passive create — so this wins over
    // the dialog's own restore-to-a-detached-node, without touching the dialog.
    useEffect(() => {
        if (refocusRow === null) return;
        // Scoped to THIS card: the same shared note can be linked to two owners
        // rendered on one page, so a document-wide lookup could focus the twin.
        const selector = refocusRow === 'add' ? '[data-note-add]' : `[data-note-row="${refocusRow}"] .ev-act`;
        cardRef.current?.querySelector<HTMLElement>(selector)?.focus();
        setRefocusRow(null);
    }, [refocusRow]);

    function startAdd() {
        setAdding(true);
        setDraft('');
        // Pre-checked ONLY for an owner with no notes — otherwise adding a note
        // would silently demote the one the user already chose. Never when the
        // affordance is hidden: an invisible checkbox must not promote anything, and
        // the emptiness test reads the FULL list, since a note this card filters out
        // still holds the owner's one preferred slot.
        setAddPreferred(showPreferred && (currentNotes ?? []).length === 0);
        setEditingId(null);
    }

    function cancelAdd() {
        setAdding(false);
        setDraft('');
    }

    async function addNote() {
        const text = draft.trim();
        if (!text || busy) return;
        const token = beginMutation();
        setBusy(true);
        try {
            const client = await getDataClient();
            if (!isCurrentMutation(token)) return;
            // A card scoped to one fact BORNS its notes into that scope, so a note added
            // on the timeline's Birth rail comes back to the same rail on reload instead
            // of falling into the person's general list. `'unscoped'` and the default
            // both create with no fact.
            const ownerFact = factScope === undefined || factScope === 'unscoped' ? undefined : factScope;
            const note = await client.notes.create(ownerTable, ownerId, text, treeId, ownerFact);
            if (!isCurrentMutation(token)) return;
            let created = note;
            let rest = currentNotes ?? [];
            if (addPreferred) {
                await client.notes.setPrimary(note.Id, ownerTable, ownerId, true, treeId);
                if (!isCurrentMutation(token)) return;
                created = { ...note, IsPrimary: 1 };
                rest = rest.map((n) => ({ ...n, IsPrimary: 0 }));
            }
            if (!isCurrentMutation(token)) return;
            apply([...rest, created]);
            setDraft('');
            setAdding(false);
            setAddPreferred(false);
        } catch (e) {
            if (!isCurrentMutation(token)) return;
            reportError(e);
        } finally {
            if (isCurrentMutation(token)) setBusy(false);
        }
    }

    function startEdit(n: Note) {
        setEditingId(n.Id);
        setEditDraft(n.Text);
        setAdding(false);
    }

    function cancelEdit() {
        // Focus came from the row's Edit, which the textarea replaced. Hand it back
        // to the row's actions once the row remounts, or Esc/Cancel drops the
        // keyboard user on <body>.
        setRefocusRow(editingId);
        setEditingId(null);
        setEditDraft('');
    }

    async function saveEdit(id: number) {
        const text = editDraft.trim();
        if (!text || busy) return;
        const token = beginMutation();
        setBusy(true);
        try {
            const client = await getDataClient();
            if (!isCurrentMutation(token)) return;
            const updated = await client.notes.update(id, ownerTable, ownerId, text, treeId);
            if (!isCurrentMutation(token)) return;
            // Carry IsPrimary AND OwnerFact over: both live on the NoteLink, and
            // `updateNote` returns `n.*` from the Note row alone, so a text update
            // arrives with neither. Dropping IsPrimary silently demotes the note;
            // dropping OwnerFact silently un-scopes it, which on a scoped rail makes
            // the row the user just edited disappear out from under them.
            apply((currentNotes ?? []).map((n) => (
                n.Id === id ? { ...updated, IsPrimary: n.IsPrimary, OwnerFact: n.OwnerFact } : n
            )));
            cancelEdit();
        } catch (e) {
            if (!isCurrentMutation(token)) return;
            reportError(e);
        } finally {
            if (isCurrentMutation(token)) setBusy(false);
        }
    }

    async function removeNote(id: number) {
        const token = beginMutation();
        setBusy(true);
        try {
            const client = await getDataClient();
            if (!isCurrentMutation(token)) return;
            await client.notes.remove(id, ownerTable, ownerId, treeId);
            if (!isCurrentMutation(token)) return;
            const survivors = (currentNotes ?? []).filter((n) => n.Id !== id);
            apply(survivors);
            setPendingDelete(null);
            // A confirmed delete takes the Delete the dialog would return focus to away
            // with it, so `Modal`'s restore aims at a detached node and silently
            // does nothing. Aim somewhere live instead: the row that takes the
            // deleted one's place (its predecessor if it was last), or the add
            // affordance once the rail is empty.
            setRefocusRow(successorOf(id, currentNotes ?? [], factScope, showPreferred) ?? 'add');
        } catch (e) {
            // Deliberately NO focus move here. A failure leaves `pendingDelete` set,
            // so the dialog stays open with the Confirm the user just pressed still
            // mounted and still focused — there is nothing to recover, and pulling
            // focus out to the rail behind an open modal would be the worse bug.
            if (isCurrentMutation(token)) reportError(e);
        } finally {
            if (isCurrentMutation(token)) setBusy(false);
        }
    }

    /**
     * Promote a note to the owner's preferred one (or demote it). At most one per
     * owner, so promoting demotes whatever held it — mirrored locally rather than
     * refetched. Demoting promotes nothing: the slot is left empty until the user
     * picks a successor. The flag is on the NoteLink, so this never affects the
     * same shared note's standing with any OTHER owner (ADR 0010/0012).
     */
    async function togglePrimary(id: number, makePrimary: boolean) {
        if (busy) return;
        const token = beginMutation();
        if (!isCurrentMutation(token)) return;
        setBusy(true);
        try {
            const client = await getDataClient();
            if (!isCurrentMutation(token)) return;
            await client.notes.setPrimary(id, ownerTable, ownerId, makePrimary, treeId);
            if (!isCurrentMutation(token)) return;
            apply((currentNotes ?? []).map((n) => ({
                ...n,
                IsPrimary: makePrimary && n.Id === id ? 1 : 0,
            })));
            // Promoting moves the row between the "preferred" and "other" lists,
            // which remounts it — so the focus return has to be by id, after the
            // render, not a stored node that React has already thrown away. A note
            // made the biography leaves this card, so focus goes to its neighbour.
            setRefocusRow(preferredIsBiography && makePrimary
                ? successorOf(id, currentNotes ?? [], factScope, showPreferred) ?? 'add'
                : id);
        } catch (e) {
            if (!isCurrentMutation(token)) return;
            reportError(e);
            // The list is unchanged on a failure; hand focus back to the row just
            // as the success path does.
            setRefocusRow(id);
        } finally {
            if (isCurrentMutation(token)) setBusy(false);
        }
    }

    function handleAddKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            addNote();
        } else if (e.key === 'Escape') {
            e.stopPropagation();
            cancelAdd();
        }
    }

    function handleEditKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>, id: number) {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
            e.preventDefault();
            saveEdit(id);
        } else if (e.key === 'Escape') {
            e.stopPropagation();
            cancelEdit();
        }
        // Blur is deliberately NOT a save or a cancel — the draft simply stays.
    }

    // What this card SHOWS, which is not always what it fetched: `onNotesChange` reports
    // the owner's whole list for the page's sake, while everything below renders the
    // `factScope` slice of it.
    const currentNotes = notesKey === scopeKey ? notes : null;
    const visibleLoadError = loadErrorKey === scopeKey ? loadError : null;
    const list = visibleNotes(currentNotes ?? [], factScope).filter((n) => n.Id !== shownElsewhereId);
    // Split into the labelled sections only when the preferred affordance is on show.
    // With it off there is one flat list — the rows keep their query order
    // (`IsPrimary DESC, Id ASC`), so a note promoted on another surface still sorts
    // first; it just isn't announced as preferred here.
    const preferred = showPreferred ? list.filter((n) => n.IsPrimary === 1) : [];
    const others = showPreferred ? list.filter((n) => n.IsPrimary !== 1) : list;
    const hasNotes = list.length > 0;
    const hasHeader = header != null;
    const target = pendingDelete === null ? null : list.find((n) => n.Id === pendingDelete) ?? null;

    const sectionLabel = (text: string, topBorder: boolean) => (
        <div className={`px-[15px] pt-[11px] pb-1 ${topBorder ? 'border-t border-border-light' : ''}`}>
            <span className="text-xs font-semibold uppercase tracking-[0.07em] text-text-muted">{text}</span>
        </div>
    );

    function renderRow(n: Note, first: boolean) {
        const editing = editingId === n.Id;
        return (
            <div
                key={n.Id}
                data-testid="note-row"
                data-note-row={n.Id}
                className={`relative flex items-start gap-1.5 pl-[15px] pr-2.5 py-2 ${editing ? '' : 'row-host'} ${first ? '' : 'border-t border-border-light'}`}
            >
                {editing ? (
                    <div className="inline-panel flex-1 min-w-0">
                        <textarea
                            value={editDraft}
                            onChange={(e) => setEditDraft(e.target.value)}
                            onKeyDown={(e) => handleEditKeyDown(e, n.Id)}
                            rows={4}
                            aria-label={tc('edit')}
                            className={`${fieldClass()} serif leading-relaxed resize-y`}
                            autoFocus
                        />
                        <div className="mt-1">
                            <EditorActions
                                size="sm"
                                onSave={() => saveEdit(n.Id)}
                                onCancel={cancelEdit}
                                saving={busy}
                                saveLabel={tc('save')}
                                saveDisabled={!editDraft.trim()}
                                leading={<span className="text-xs text-text-muted">{t('save_hint')}</span>}
                            />
                        </div>
                    </div>
                ) : (
                    <>
                        <div className="flex-1 min-w-0">
                            {/* Suppressed on a card scoped to ONE fact: every row would
                                carry the same label, and the rail's own heading already
                                says which record these belong to. */}
                            {n.OwnerFact && factScope === undefined && (
                                <div data-testid="note-scope" className="eyebrow mb-0.5">{scopeLabel(t, n.OwnerFact)}</div>
                            )}
                            <div className="text-base leading-[1.6] text-text whitespace-pre-wrap break-words">
                                {n.Text}
                            </div>
                        </div>
                        {canEdit && (
                            // The excerpt names WHICH note each action is for: a screen
                            // reader's element list would otherwise read five identical
                            // "Edit" buttons.
                            <RowActions
                                compact
                                editLabel={t('edit_for', { excerpt: excerpt(n.Text) })}
                                onEdit={() => startEdit(n)}
                                deleteLabel={t('delete_for', { excerpt: excerpt(n.Text) })}
                                onDelete={canDelete ? () => setPendingDelete(n.Id) : undefined}
                                disabled={busy}
                            >
                                {showPreferred && preferredIsBiography && n.IsPrimary !== 1 && (
                                    <RowAction
                                        icon={<Bookmark size={13} aria-hidden="true" />}
                                        label={t('use_as_biography')}
                                        ariaLabel={t('use_as_biography_for', { excerpt: excerpt(n.Text) })}
                                        onClick={() => togglePrimary(n.Id, true)}
                                        disabled={busy}
                                    />
                                )}
                                {showPreferred && !preferredIsBiography && (
                                    <RowAction
                                        icon={n.IsPrimary === 1
                                            ? <BookmarkX size={13} aria-hidden="true" />
                                            : <Bookmark size={13} aria-hidden="true" />}
                                        label={n.IsPrimary === 1 ? t('clear_primary') : t('make_primary')}
                                        ariaLabel={t(n.IsPrimary === 1 ? 'clear_primary_for' : 'make_primary_for', { excerpt: excerpt(n.Text) })}
                                        onClick={() => togglePrimary(n.Id, n.IsPrimary !== 1)}
                                        disabled={busy}
                                    />
                                )}
                            </RowActions>
                        )}
                    </>
                )}
            </div>
        );
    }

    return (
        <div className={look === 'plain' ? 'owner-notes--plain' : 'card'} ref={cardRef}>
            {/* The card owns NO title. Every mount already labels this surface —
                a FormSection title, a collapsible toggle, a rail overline, an h3 —
                so a built-in one would read "Notes" twice. Surfaces that want the
                heading INSIDE the card pass it as `header`; the rest label it
                above. Either way the count comes from <NoteCount>, fed by
                `onNotesChange`. */}
            {header && <div className="px-[15px] pt-3.5 pb-1">{header}</div>}

            {visibleLoadError != null && (
                <InlineDataError
                    className="m-3"
                    message={String(tc(errorToastKey(visibleLoadError)))}
                    retryLabel={String(tc('retry'))}
                    onRetry={load}
                />
            )}

            {currentNotes === null && visibleLoadError == null ? (
                <div className="muted px-[15px] py-3.5 text-xs">{tc('loading')}</div>
            ) : currentNotes !== null ? (
                <>
                    {!hasNotes && visibleLoadError == null && look !== 'plain' && (
                        <div className="muted px-[15px] py-3.5 text-sm leading-[1.6]">
                            {shownElsewhereId != null
                                ? (canEdit ? t('empty_others_edit') : t('empty_others'))
                                : (canEdit ? t('empty_edit') : t('empty'))}
                        </div>
                    )}

                    {preferred.length > 0 && sectionLabel(t('preferred_label'), hasHeader && !headerRule)}
                    {preferred.map((n) => renderRow(n, true))}

                    {preferred.length > 0 && others.length > 0 && sectionLabel(t('others_label'), true)}
                    {/* A row draws its own top rule unless something above it already
                        did: a section label, or — for the first row of a card with no
                        header — the card's own top edge. */}
                    {others.map((n, i) => renderRow(n, i === 0 && (preferred.length > 0 || !hasHeader || headerRule)))}
                </>
            ) : null}

            {canEdit && adding && currentNotes !== null && (
                <div className="inline-panel m-3">
                    <textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={handleAddKeyDown}
                        rows={4}
                        aria-label={t('new_note')}
                        placeholder={t('add_placeholder')}
                        className={`${fieldClass()} serif leading-relaxed resize-y`}
                    />
                    {showPreferred && !preferredIsBiography && (
                        <label className="mt-2 flex min-h-9 cursor-pointer items-center gap-2 text-xs text-text-secondary">
                            <input
                                type="checkbox"
                                checked={addPreferred}
                                onChange={(e) => setAddPreferred(e.target.checked)}
                                className="w-4 h-4 m-0 accent-primary"
                            />
                            {t('set_preferred')}
                        </label>
                    )}
                    <div className="mt-1.5">
                        <EditorActions size="sm" onSave={addNote} onCancel={cancelAdd} saving={busy} saveLabel={t('add_button')} saveDisabled={!draft.trim()} />
                    </div>
                </div>
            )}

            {canEdit && !adding && currentNotes !== null && (
                <AddRow data-note-add label={t('add_button')} onClick={startAdd} className="rounded-b-card border-t border-border-light px-[15px]" />
            )}

            <ConfirmDialog
                open={target !== null}
                variant="calm"
                tone="danger"
                elevated
                title={t('delete_title')}
                body={
                    <>
                        {/* The "you are about to empty the preferred slot" warning only
                            makes sense where the slot was on show to begin with. */}
                        <p className="mb-3.5">{showPreferred && target?.IsPrimary === 1 ? t('delete_blurb_preferred') : t('delete_blurb')}</p>
                        <blockquote className="serif rounded-md border border-border-light bg-card-alt p-3 text-left text-meta italic leading-[1.55] text-text-secondary">
                            {target?.Text}
                        </blockquote>
                    </>
                }
                confirmLabel={tc('delete')}
                busy={busy}
                onConfirm={() => { if (target) removeNote(target.Id); }}
                onCancel={() => setPendingDelete(null)}
            />
        </div>
    );
}

/**
 * `(3)` — the note count, rendered inside the heading each surface ALREADY owns
 * (a `FormSection` title, the sidebar's collapsible toggle, a rail overline, an
 * `h3`). The card deliberately draws no title of its own, so this is the one
 * place the count is formatted; feed it from `OwnerNotesCard`'s `onNotesChange`.
 * Renders nothing at zero — an owner with no notes reads "Notes", not "Notes (0)".
 */
export function NoteCount({ count }: { count: number }) {
    const t = useTranslations('notes');
    if (count <= 0) return null;
    return <span className="font-sans muted font-normal text-meta">{t('count', { count })}</span>;
}

/**
 * The note a person page shows as the biography: the preferred one, else the oldest
 * imported or legacy note (the People."Notes" backfill and GEDCOM imports never set
 * a preferred note). A note written in the app never stands in (#902): one added in
 * the Notes rail stays there, and only the biography card or "Use as the biography"
 * makes one. Pass the unscoped slice, already ordered preferred-first then oldest.
 */
export function biographyNote(notes: Note[]): Note | null {
    return notes.find((n) => n.IsPrimary === 1) ?? notes.find((n) => n.AddedInApp !== 1) ?? null;
}

/**
 * The slice of an owner's notes a card with this `factScope` renders.
 *
 * Exported because `OwnerNotesCard.onNotesChange` reports the owner's WHOLE list, so
 * every consumer that shows a count beside a heading has to narrow it the same way the
 * card did — otherwise a person with two birth notes and no others reads "Notes (2)"
 * over an empty rail.
 */
export function visibleNotes(notes: Note[], factScope?: NoteOwnerFact | 'unscoped'): Note[] {
    if (factScope === undefined) return notes;
    if (factScope === 'unscoped') return notes.filter((n) => !n.OwnerFact);
    return notes.filter((n) => n.OwnerFact === factScope);
}

/**
 * The note whose row actions should take focus when `id` is deleted: the row that will
 * slide up into its place, or — when it was the last row — the one above it.
 * Computed in RENDERED order, not list order, so the focus ring lands where the eye
 * would follow. That means the same `factScope` slice the card draws, and the
 * preferred-first split only when the card actually splits. Null when nothing survives.
 */
function successorOf(
    id: number,
    notes: Note[],
    factScope: NoteOwnerFact | 'unscoped' | undefined,
    showPreferred: boolean,
): number | null {
    const list = visibleNotes(notes, factScope);
    const rendered = showPreferred
        ? [...list.filter((n) => n.IsPrimary === 1), ...list.filter((n) => n.IsPrimary !== 1)]
        : list;
    const at = rendered.findIndex((n) => n.Id === id);
    if (at === -1) return null;
    return (rendered[at + 1] ?? rendered[at - 1])?.Id ?? null;
}

/**
 * A short, single-line stand-in for a note, used to tell one row's action buttons
 * apart from the next one's in a screen reader's list of controls. Newlines
 * collapse so the name never spans lines, and a long note is cut at a word
 * boundary rather than mid-word.
 */
function excerpt(text: string, max = 40): string {
    const flat = text.replace(/\s+/g, ' ').trim();
    if (flat.length <= max) return flat;
    const cut = flat.slice(0, max);
    const space = cut.lastIndexOf(' ');
    return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * Translates a note's `OwnerFact` into its overline label. It only renders
 * the note's current scope; this card can't change it.
 */
function scopeLabel(t: ReturnType<typeof useTranslations>, fact: NoteOwnerFact): string {
    switch (fact) {
        case 'Birth': return t('scope_birth');
        case 'Death': return t('scope_death');
        case 'Marriage': return t('scope_marriage');
    }
}

