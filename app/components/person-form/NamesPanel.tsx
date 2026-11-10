'use client';

/**
 * NamesPanel — shared name-variant renderer (read-only + inline editor).
 *
 * Extracted from PersonDetailView.tsx (§ NamesPanel + NameVariant).
 * PersonDetailView consumes this directly; it is the shared seam for the
 * deferred detail-view visual rebuild — when that skin ships, restyle here
 * rather than duplicating across the edit and read surfaces.
 *
 * `renderCitePin` is passed as a prop so the caller controls how citations
 * attach (detail-view attaches via AttachSourceSidebar; future surfaces may
 * differ). The prop signature matches PersonDetailView's `renderCitePin`.
 *
 * Task 7 (people-detail inline edit): when `canEdit` is true, gains full
 * parity with the edit page's `IdentitySection.tsx` variants editor — add /
 * rename / remove / primary-star — but stays presentational: mutations are
 * lifted to the caller via `onAdd`/`onRename`/`onRemove`/`onSetPrimary`.
 * `canEdit === false` renders byte-identical to the pre-Task-7 read-only
 * table (no behavior change for shared 'view' trees).
 *
 * #898: a variant's "dates used" range is edited in the add and edit panels and
 * shown with the app's date formatting; each name's cite pin sits beside it, as
 * the timeline's does beside its title, so there is no Source column.
 */

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { PersonWithRelations } from '@/lib/db/schema';
import type { NameVariantDates } from '@/lib/data/types';
import { FACT_TABLES } from '@/lib/db/fact-tables';
import { formatDateForDisplay } from '@/lib/date-utils';
import { AddRow, Button, EditorActions, Input, RowActions, Select, cx } from '@/app/components/ui';
import { useReturnFocus } from '@/app/hooks/useReturnFocus';
import ConfirmDialog from '@/app/components/ConfirmDialog';
import DateInput from '@/app/components/date-input/DateInput';
import { useDateQualifierWords } from '@/app/components/date-input/aliases';
import { useLanguage } from '@/app/components/LanguageProvider';

export interface NameVariant {
    Id: number;
    PersonId: number;
    Type: 'Given' | 'Nickname' | 'Maiden' | 'Married' | 'Anglicized' | 'Alias';
    Name: string;
    FromDate: string | null;
    ToDate: string | null;
    IsPrimary?: number | boolean;
}

const NO_DATES: NameVariantDates = { FromDate: null, ToDate: null };

/** "Used from" / "Used to" date fields, shared by the add and edit panels (#898). */
function DatesUsedFields({ value, onChange }: { value: NameVariantDates; onChange: (value: NameVariantDates) => void }) {
    const t = useTranslations('personDetail');
    const fromId = useId();
    const toId = useId();
    return (
        <div className="grid gap-3 sm:grid-cols-2">
            <div className="min-w-0">
                <label htmlFor={fromId} className="block text-meta text-text-muted mb-1">{t('variant_used_from')}</label>
                <DateInput id={fromId} value={value.FromDate ?? ''} onChange={(v) => onChange({ ...value, FromDate: v || null })} />
            </div>
            <div className="min-w-0">
                <label htmlFor={toId} className="block text-meta text-text-muted mb-1">{t('variant_used_to')}</label>
                <DateInput id={toId} value={value.ToDate ?? ''} onChange={(v) => onChange({ ...value, ToDate: v || null })} />
            </div>
        </div>
    );
}

/** The add panel's type choices, in the order the old add row offered them. */
const VARIANT_TYPES: NameVariant['Type'][] = ['Nickname', 'Maiden', 'Married', 'Anglicized', 'Alias', 'Given'];

/**
 * Star toggle used to mark a name (the default first name or a variant) as
 * primary. Never relies on color alone — filled/outline glyph + aria-pressed
 * + a text title carry the state (colorblind-safe).
 */
function PrimaryStar({ active, onClick, label, disabled }: { active: boolean; onClick: () => void; label: string; disabled?: boolean }) {
    return (
        <Button
            variant="ghost"
            onClick={onClick}
            disabled={disabled}
            className="relative tap-44 border-transparent text-[15px] leading-[1] p-0.5 [@media(pointer:coarse)]:min-w-11 [@media(pointer:coarse)]:min-h-11"
            style={{ color: active ? 'var(--color-link)' : 'var(--text-muted)' }}
            title={label}
            aria-label={label}
            aria-pressed={active}
        >
            {active ? '★' : '☆'}
        </Button>
    );
}

interface NamesPanelProps {
    person: PersonWithRelations;
    variants: NameVariant[];
    renderCitePin: (factTable: string, factId: number, factLabel: string) => React.ReactNode;
    /** Show the add/rename/remove/primary-star affordances (owner/edit permission). */
    canEdit: boolean;
    /** Show the destructive remove affordance (owner/edit permission). */
    canDelete: boolean;
    onAdd: (type: string, name: string, dates: NameVariantDates) => Promise<void>;
    /** Saves the edit panel: the name and its "dates used" range (#898). */
    onRename: (id: number, name: string, dates: NameVariantDates) => Promise<void>;
    onRemove: (id: number) => Promise<void>;
    onSetPrimary: (id: number | null) => Promise<void>;
    /** Disables the add/star/remove controls while a mutation is in flight. */
    busy?: boolean;
}

export function NamesPanel({ person, variants, renderCitePin, canEdit, canDelete, onAdd, onRename, onRemove, onSetPrimary, busy = false }: NamesPanelProps) {
    const t = useTranslations('personDetail');
    const tc = useTranslations('common');
    const { language } = useLanguage();
    const dateWords = useDateQualifierWords();
    const givenName = `${person.FirstName ?? ''} ${person.LastName ?? ''}`.trim() || t('unnamed');
    const hasPrimaryVariant = variants.some((v) => v.IsPrimary);

    // The collections pattern (#760): a row's Edit opens its inline panel; the
    // trailing "Add name" row opens the add panel. One panel at a time.
    const [editingId, setEditingId] = useState<number | null>(null);
    const [editingName, setEditingName] = useState('');
    const [editingDates, setEditingDates] = useState<NameVariantDates>(NO_DATES);
    const [adding, setAdding] = useState(false);
    const addRef = useReturnFocus(adding);

    const [confirmRemove, setConfirmRemove] = useState<NameVariant | null>(null);
    const [newType, setNewType] = useState<NameVariant['Type']>('Nickname');
    const [newName, setNewName] = useState('');
    const [newDates, setNewDates] = useState<NameVariantDates>(NO_DATES);

    const startEditVariant = (v: NameVariant) => {
        setAdding(false);
        setEditingId(v.Id);
        setEditingName(v.Name);
        setEditingDates({ FromDate: v.FromDate, ToDate: v.ToDate });
    };
    const cancelEditVariant = () => { setEditingId(null); setEditingName(''); setEditingDates(NO_DATES); };
    const commitEditVariant = () => {
        if (editingId === null) return;
        const trimmed = editingName.trim();
        const current = variants.find((v) => v.Id === editingId);
        const changed = current && (trimmed !== current.Name
            || editingDates.FromDate !== current.FromDate || editingDates.ToDate !== current.ToDate);
        if (trimmed && changed) onRename(editingId, trimmed, editingDates);
        cancelEditVariant();
    };

    const cancelAdd = () => { setAdding(false); setNewName(''); setNewDates(NO_DATES); };
    const handleAdd = () => {
        const name = newName.trim();
        if (!name) return;
        onAdd(newType, name, newDates);
        cancelAdd();
    };

    // Stored values may be GEDCOM text ("ABT 1890"): always shown through the app's
    // date formatting, never raw (#898).
    const datesUsed = (v: NameVariant): string => {
        const from = formatDateForDisplay(v.FromDate, language, dateWords);
        const to = formatDateForDisplay(v.ToDate, language, dateWords);
        if (from && to) return `${from} – ${to}`;
        if (from) return t('dates_from', { date: from });
        if (to) return t('dates_until', { date: to });
        return t('throughout_life');
    };

    const handleConfirmRemove = async () => {
        if (!canDelete || !confirmRemove) return;
        await onRemove(confirmRemove.Id);
        setConfirmRemove(null);
    };

    const vtypeLabel = (type: string): string => {
        switch (type) {
            case 'Given': return t('vtype_given');
            case 'Nickname': return t('vtype_nickname');
            case 'Maiden': return t('vtype_maiden');
            case 'Married': return t('vtype_married');
            case 'Anglicized': return t('vtype_anglicized');
            case 'Alias': return t('vtype_alias');
            default: return type;
        }
    };

    const hasActions = canEdit || canDelete;
    const displayName = (v: NameVariant) => (v.Type === 'Nickname' ? `“${v.Name}”` : v.Name);
    const colCount = 3 + (canEdit ? 1 : 0) + (hasActions ? 1 : 0);

    return (
        <div className="card">
            {/* Row hover only where the rows actually do something: with edit rights each
                variant row has a primary star and Edit/Remove. The read-only rendering has
                none of those, so it gets no hover (#430). */}
            {/* The table clips to the card's top corners; the add panel below stays
                unclipped so its type menu can open past the card. */}
            <div className="overflow-hidden rounded-t-card">
            <table className={canEdit ? 't t-rows-interactive' : 't'}>
                <thead>
                    <tr>
                        {canEdit && <th className="w-11" aria-hidden="true" />}
                        <th className="sm:w-[120px]">{t('col_type')}</th>
                        <th>{t('col_name')}</th>
                        {/* Dates used hides on phones (#807). No Source column: each
                            name's cite pin sits beside it (#898). */}
                        <th className="hidden sm:table-cell">{t('col_dates')}</th>
                        {hasActions && <th aria-hidden="true" />}
                    </tr>
                </thead>
                <tbody>
                    <tr className="[&>td]:!align-middle">
                        {canEdit && (
                            <td>
                                <PrimaryStar
                                    active={!hasPrimaryVariant}
                                    onClick={() => onSetPrimary(null)}
                                    label={!hasPrimaryVariant ? t('unset_primary') : t('set_primary')}
                                    disabled={busy}
                                />
                            </td>
                        )}
                        {/* A name's type is a fact about it, so muted text, not a tag (#757). */}
                        <td className="text-meta text-text-muted">{t('vtype_given')}</td>
                        <td>
                            <span className="inline-flex items-center gap-1.5 flex-wrap">
                                {givenName}
                                {renderCitePin(FACT_TABLES.PERSON_NAME, person.Id, t('col_name'))}
                            </span>
                        </td>
                        <td className="muted hidden sm:table-cell">{person.DeathDate ? t('dates_birth_death') : t('dates_birth_present')}</td>
                        {hasActions && <td />}
                    </tr>
                    {variants.map(v => editingId === v.Id ? (
                        <tr key={v.Id}>
                            <td colSpan={colCount} className="!p-2">
                                <div className="inline-panel flex flex-col gap-3" role="group" aria-label={tc('edit_named', { name: v.Name })}>
                                    <div className="row gap-3 items-center flex-wrap">
                                        <span className="text-meta text-text-muted">{vtypeLabel(v.Type)}</span>
                                        <Input
                                            size="sm"
                                            wrapClassName="flex-1 min-w-[160px]"
                                            value={editingName}
                                            onChange={(e) => setEditingName(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') { e.preventDefault(); commitEditVariant(); }
                                                else if (e.key === 'Escape') { e.preventDefault(); cancelEditVariant(); }
                                            }}
                                            autoFocus
                                            aria-label={t('variant_edit_name')}
                                        />
                                    </div>
                                    <DatesUsedFields value={editingDates} onChange={setEditingDates} />
                                    <EditorActions size="sm" onSave={commitEditVariant} onCancel={cancelEditVariant} saving={busy} saveDisabled={!editingName.trim()} />
                                </div>
                            </td>
                        </tr>
                    ) : (
                        <tr key={v.Id} className={cx('[&>td]:!align-middle', hasActions && 'row-host')}>
                            {canEdit && (
                                <td>
                                    <PrimaryStar
                                        active={!!v.IsPrimary}
                                        onClick={() => onSetPrimary(v.Id)}
                                        label={v.IsPrimary ? t('unset_primary') : t('set_primary')}
                                        disabled={busy}
                                    />
                                </td>
                            )}
                            <td className="text-meta text-text-muted">{vtypeLabel(v.Type)}</td>
                            <td>
                                <span className="inline-flex items-center gap-1.5 flex-wrap">
                                    <span className="font-medium">{displayName(v)}</span>
                                    {renderCitePin(FACT_TABLES.NAME_VARIANT, v.Id, vtypeLabel(v.Type))}
                                </span>
                            </td>
                            <td className="muted hidden sm:table-cell">{datesUsed(v)}</td>
                            {hasActions && (
                                <td style={{ textAlign: 'right' }}>
                                    <RowActions
                                        editLabel={tc('edit_named', { name: v.Name })}
                                        onEdit={canEdit ? () => startEditVariant(v) : undefined}
                                        deleteText={tc('remove')}
                                        deleteLabel={tc('remove_named', { name: v.Name })}
                                        onDelete={canDelete ? () => setConfirmRemove(v) : undefined}
                                        disabled={busy}
                                    />
                                </td>
                            )}
                        </tr>
                    ))}
                </tbody>
            </table>
            </div>
            {canEdit && (adding ? (
                <div className="inline-panel m-3 flex flex-col gap-3" role="group" aria-label={t('add_name')}>
                    <div className="row gap-2 flex-wrap items-center">
                        <Select
                            label={t('col_type')}
                            valueLabel={vtypeLabel(newType)}
                            options={VARIANT_TYPES.map((vt) => ({ key: vt, value: vt, label: vtypeLabel(vt) }))}
                            isSelected={(vt) => vt === newType}
                            onSelect={setNewType}
                        />
                        <Input
                            size="sm"
                            wrapClassName="flex-1 min-w-[160px]"
                            name="name-variant-value"
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            placeholder={t('variant_add_placeholder')}
                            aria-label={t('variant_add_name')}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') { e.preventDefault(); handleAdd(); }
                                else if (e.key === 'Escape') { e.preventDefault(); cancelAdd(); }
                            }}
                            disabled={busy}
                            autoFocus
                        />
                    </div>
                    <DatesUsedFields value={newDates} onChange={setNewDates} />
                    <EditorActions size="sm" onSave={handleAdd} onCancel={cancelAdd} saving={busy} saveLabel={t('add_name')} saveDisabled={!newName.trim()} />
                </div>
            ) : (
                <AddRow ref={addRef} label={t('add_name')} onClick={() => { cancelEditVariant(); setAdding(true); }} disabled={busy} className="border-t border-border-light rounded-b-card" />
            ))}
            {confirmRemove && (
                <ConfirmDialog
                    open
                    variant="calm"
                    tone="danger"
                    title={t('variant_remove_title')}
                    body={t('variant_remove_body', { name: confirmRemove.Name })}
                    confirmLabel={tc('remove')}
                    cancelLabel={tc('cancel')}
                    busy={busy}
                    onConfirm={handleConfirmRemove}
                    onCancel={() => setConfirmRemove(null)}
                />
            )}
        </div>
    );
}
