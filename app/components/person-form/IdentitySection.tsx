'use client';

import { useId, useState, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Badge, fieldClass, SelectField } from '@/app/components/ui';
import { FormSection, FactGroupLabel, FieldLabel, SegmentedControl } from '@/app/components/ui';
import type { UsePersonForm } from '@/app/components/person-form/usePersonForm';
import { useNoAutofill } from '@/app/hooks/useNoAutofill';

/** Star toggle used to mark a name (the default first name or a variant) as primary. */
function PrimaryStar({ active, onClick, mobile, label }: { active: boolean; onClick: () => void; mobile?: boolean; label: string }) {
    return (
        <Button
            variant="ghost"
            onClick={onClick}
            className={`border-transparent text-[15px] leading-[1]${mobile ? ' min-w-11 min-h-11' : ''}`}
            style={{ padding: 2, color: active ? 'var(--color-link)' : 'var(--text-muted)' }}
            title={label}
            aria-label={label}
            aria-pressed={active}
        >
            {active ? '★' : '☆'}
        </Button>
    );
}

/**
 * IdentitySection — first/last name (one cite pin on the Name heading, #548), Sex + Living-status segmented
 * controls, and the other-names / variants editor (rows + primary star + inline add).
 *
 * Structural extraction from PersonForm.tsx (Task 4) — behavior-identical.
 */
export default function IdentitySection({ fm, mobile = false }: { fm: UsePersonForm; mobile?: boolean }) {
    const t = useTranslations('editPerson');
    const tc = useTranslations('common');
    const fieldId = useId();
    const {
        form, setField, fieldErrors, firstNameRef, cite,
        variants, newVariantType, newVariantName, setNewVariantType, setNewVariantName,
        addNameVariant, removeNameVariant, updateNameVariant, setPrimaryVariant, hasPrimaryVariant,
    } = fm;

    // Chrome offers the USER's own saved name over these fields, on top of the
    // app's own suggestions (#442) — they ask about a relative, never the user.
    const noAutofill = useNoAutofill();

    // Inline text-edit of an existing variant's name.
    const [editingId, setEditingId] = useState<number | null>(null);
    const [editingName, setEditingName] = useState('');
    // Enter/Escape resolve the edit synchronously; flipping editingId unmounts the
    // input, which fires a trailing blur. Without this guard that blur would run
    // commitEditVariant against the stale closure — turning Escape into a silent
    // save. The guard makes the unmount-blur a no-op when a key already handled it.
    const resolvedRef = useRef(false);

    const startEditVariant = (id: number, name: string) => { resolvedRef.current = false; setEditingId(id); setEditingName(name); };
    const cancelEditVariant = () => { setEditingId(null); setEditingName(''); };
    const commitEditVariant = () => {
        if (editingId === null) return;
        const trimmed = editingName.trim();
        const current = variants.find((v) => v.Id === editingId);
        if (trimmed && current && trimmed !== current.Name) updateNameVariant(editingId, trimmed);
        cancelEditVariant();
    };
    const commitOnBlur = () => {
        if (resolvedRef.current) { resolvedRef.current = false; return; }
        commitEditVariant();
    };

    // Map a stored name-variant Type to its translated label (falls back to the raw value).
    const variantTypeLabel = (type: string) => {
        switch (type) {
            case 'Nickname': return t('variant_nickname');
            case 'Maiden': return t('variant_maiden');
            case 'Married': return t('variant_married');
            case 'Anglicized': return t('variant_anglicized');
            case 'Alias': return t('variant_alias');
            case 'Given': return t('variant_given');
            default: return type;
        }
    };

    return (
        <FormSection title={t('section_identity')} hint={t('section_identity_hint')} mobile={mobile}>
            <FactGroupLabel label={t('section_name')} cite={cite('Name', t('section_name'))} />
            <div className={`grid ${mobile ? 'gap-[13px]' : 'gap-3.5'}`} style={{ gridTemplateColumns: mobile ? '1fr' : '1fr 1fr' }}>
                <FieldLabel label={t('first_name')} required htmlFor={`${fieldId}-first`}>
                    <input
                        id={`${fieldId}-first`}
                        ref={firstNameRef}
                        type="text"
                        className={fieldClass()}
                        value={form.FirstName}
                        placeholder={t('first_name_placeholder')}
                        onChange={(e) => setField('FirstName', e.target.value)}
                        style={fieldErrors.FirstName ? { borderColor: 'var(--error)' } : undefined}
                        {...noAutofill('first-name')}
                    />
                </FieldLabel>
                <FieldLabel label={t('last_name')} htmlFor={`${fieldId}-last`}>
                    <input
                        id={`${fieldId}-last`}
                        type="text"
                        className={fieldClass()}
                        value={form.LastName}
                        placeholder={t('last_name_placeholder')}
                        onChange={(e) => setField('LastName', e.target.value)}
                        style={fieldErrors.LastName ? { borderColor: 'var(--error)' } : undefined}
                        {...noAutofill('last-name')}
                    />
                </FieldLabel>
            </div>
            <div className={`grid ${mobile ? 'gap-[13px] mt-[13px]' : 'gap-3.5 mt-3.5'}`} style={{ gridTemplateColumns: mobile ? '1fr' : '1fr 1fr' }}>
                <FieldLabel label={t('sex')}>
                    <SegmentedControl
                        value={form.Sex}
                        onChange={(v) => setField('Sex', v)}
                        aria-label={t('sex')}
                        fullWidth={mobile}
                        options={[
                            { v: '', l: tc('unknown') },
                            { v: 'M', l: t('sex_male') },
                            { v: 'F', l: t('sex_female') },
                            { v: 'X', l: t('sex_nonbinary') },
                        ]}
                    />
                </FieldLabel>
                <FieldLabel label={tc('living_status')} hint="" >
                    <SegmentedControl
                        value={form.IsDeceased}
                        onChange={(v) => setField('IsDeceased', v)}
                        aria-label={tc('living_status')}
                        fullWidth={mobile}
                        options={[
                            { v: '', l: tc('unknown') },
                            { v: '0', l: tc('living') },
                            { v: '1', l: tc('deceased') },
                        ]}
                    />
                </FieldLabel>
            </div>

            {/* Other names & variants — mark one Primary to use it as this
                person's first name across the app. With none marked, the
                default first name above is primary. */}
            <div className="mt-[18px] pt-3.5 border-t border-t-[color:var(--border-light)]">
                <div className="row justify-between mb-2">
                    {/* The count no longer needs to opt out of uppercase/tracking —
                        .rel-group-label carries neither. */}
                    <div className="rel-group-label">{t('variants_title')} <span>· {variants.length}</span></div>
                </div>
                <div className="flex flex-col gap-1.5 mb-2.5">
                    {/* Default first name row (implicit primary when no variant is primary) */}
                    <div className="row gap-2.5 py-2 px-3 rounded-[6px] text-sm" style={{ background: 'var(--card-alt)' }}>
                        <PrimaryStar active={!hasPrimaryVariant} onClick={() => setPrimaryVariant(null)} mobile={mobile} label={!hasPrimaryVariant ? t('primary_name') : t('make_primary')} />
                        <Badge className="text-[10px] min-w-20 justify-center">{t('first_name')}</Badge>
                        <span className="flex-1 font-medium">{form.FirstName || <span className="muted">{t('default_first_name')}</span>}</span>
                    </div>
                    {variants.map((v) => (
                        <div key={v.Id} className="row gap-2.5 py-2 px-3 rounded-[6px] text-sm" style={{ background: 'var(--card-alt)' }}>
                            <PrimaryStar active={!!v.IsPrimary} onClick={() => setPrimaryVariant(v.Id)} mobile={mobile} label={v.IsPrimary ? t('primary_name') : t('make_primary')} />
                            <Badge className="text-[10px] min-w-20 justify-center">{variantTypeLabel(v.Type)}</Badge>
                            {editingId === v.Id ? (
                                <input
                                    type="text"
                                    className={`${fieldClass()} flex-1 font-medium`}
                                    value={editingName}
                                    onChange={(e) => setEditingName(e.target.value)}
                                    onBlur={commitOnBlur}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') { e.preventDefault(); resolvedRef.current = true; commitEditVariant(); }
                                        else if (e.key === 'Escape') { e.preventDefault(); resolvedRef.current = true; cancelEditVariant(); }
                                    }}
                                    autoFocus
                                    aria-label={t('variant_edit_name')}
                                />
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => startEditVariant(v.Id, v.Name)}
                                    className="border-transparent flex-1 font-medium text-left"
                                    style={{ background: 'none', cursor: 'text', padding: 0 }}
                                    title={t('variant_edit_name')}
                                >
                                    {v.Name}
                                </button>
                            )}
                            {editingId !== v.Id && (
                                <Button variant="ghost" onClick={() => removeNameVariant(v.Id)} className={`border-transparent text-xs${mobile ? ' min-w-11 min-h-11' : ''}`} style={{ padding: 4 }} aria-label={t('remove')} title={t('remove')}>✕</Button>
                            )}
                        </div>
                    ))}
                </div>
                {/* Inline add */}
                <div className="row gap-2">
                    <SelectField
                        value={newVariantType}
                        onChange={setNewVariantType}
                        width={mobile ? 'w-[118px]' : 'w-[140px]'}
                        className="shrink-0"
                        aria-label={t('variants_title')}
                        options={[
                            { value: 'Nickname', label: t('variant_nickname') },
                            { value: 'Maiden', label: t('variant_maiden') },
                            { value: 'Married', label: t('variant_married') },
                            { value: 'Anglicized', label: t('variant_anglicized') },
                            { value: 'Alias', label: t('variant_alias') },
                            { value: 'Given', label: t('variant_given') },
                        ]}
                    />
                    <input
                        type="text"
                        className={fieldClass()}
                        value={newVariantName}
                        onChange={(e) => setNewVariantName(e.target.value)}
                        placeholder={t('variant_add_placeholder')}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addNameVariant(); } }}
                    />
                    <Button variant="outline" onClick={addNameVariant}>+ {tc('add')}</Button>
                </div>
            </div>
        </FormSection>
    );
}
