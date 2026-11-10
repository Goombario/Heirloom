'use client';

/**
 * RelationshipList — shared read-only relationship renderer.
 *
 * Extracted from PersonDetailView.tsx (§ RelationshipsPanel + PersonRow).
 * PersonDetailView consumes this directly; it is the shared seam for the
 * deferred detail-view visual rebuild — when that skin ships, restyle here
 * rather than duplicating across the edit and read surfaces.
 *
 * Inline remove (Task 4): when `canDelete` is true, each relationship row shows
 * a hover-reveal ghost ✕ (always visible on touch/`hover:none`) that opens a
 * ConfirmDialog and, on confirm, calls the same family-mutation client calls
 * as RelationshipsSection.tsx (edit-page), then `onChanged()`.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { livingStatus } from '@/lib/living';
import type { PersonWithRelations, Person } from '@/lib/db/schema';
import PersonAvatar from '@/app/components/PersonAvatar';
import ConfirmDialog from '@/app/components/ConfirmDialog';
import { Button, Lifespan, SectionHeader } from '@/app/components/ui';
import { Plus } from '@/lib/icons';
import { getDataClient } from '@/lib/data';
import { sharedChildRelationship } from '@/lib/child-relationship';
import { useUndoRemoval } from '@/app/hooks/useUndoRemoval';
import { prefetchPerson } from '@/app/people/view/personCache';
import { prefetchFamily } from '@/app/families/view/familyCache';
import { RelationshipAddPanel } from '@/app/people/view/RelationshipAddPanel';
import { formatYearForDisplay } from '@/lib/date-utils';
import { getInitials } from '@/lib/utils/initials';
import { displayFullName } from '@/lib/utils/names';

function fullName(p: Person | null, unknown = 'Unknown'): string {
    if (!p) return unknown;
    return displayFullName(p) || unknown;
}

// Inline remove (✕) — hidden until the row is hovered/focused, always visible on
// touch. Positioned absolutely over the right edge of the person row (see
// PersonRow) so it sits WITHIN the hover target instead of pushing the row
// narrower. The glyph stays compact; `.tap-44` carries the hit area to 44px on
// every pointer (#431) — no `relative` needed, the button is already positioned.
// Its halo overlaps the row's Link, which is deliberate: within 11px of a visible
// ✕ the intent is the ✕, and the removal is confirmed in a dialog either way.
const removeBtnCls = 'tap-44 absolute right-0 top-1/2 -translate-y-1/2 z-10 border-transparent !p-1 text-xs [@media(pointer:coarse)]:min-w-11 [@media(pointer:coarse)]:min-h-11 invisible group-hover:visible group-focus-within:visible [@media(hover:none)]:visible';

// "View family" — a real navigation control that used to read as static text: no
// hover, no focus ring, no cursor (#432). The inverse of the names/aliases problem
// in #430. Same interactive vocabulary as the app's other navigation links
// (hover:bg-hover-surface + a focus ring), kept at the rail's small type.
const viewFamilyCls = 'inline-flex items-center gap-1 -mx-1.5 px-1.5 py-0.5 rounded-md text-xs no-underline text-[color:var(--link)] cursor-pointer transition-colors hover:bg-hover-surface hover:underline focus-ring';

// The block heading row: group label on the left, "View family →" on the right.
// The link used to trail the LAST person in the block, where it read as one more
// list entry; on the heading line it reads as the block's own action, and every
// block anchors it in the same place regardless of how many people it holds.
const groupHeaderCls = 'flex items-baseline justify-between gap-2 mb-2';

interface PersonRowProps {
    person: Person & { PrimaryMediaId?: number; FocalX?: number; FocalY?: number; FocalRadius?: number | null };
    treeId: number | null;
    role?: string;
    /** A role or marriage phrase, or a compact `<Lifespan />`. */
    sub?: ReactNode;
    onRemove?: () => void;
    removeTitle?: string;
}

function PersonRow({ person, treeId, role, sub, onRemove, removeTitle }: PersonRowProps) {
    const t = useTranslations('personDetail');
    // One avatar size for every row in the panel — siblings and children used to
    // render at 28px against the parents' and partners' 36px.
    const size = 36;
    return (
        <div className="group row items-center relative">
            <Link
                href={`/people/view?id=${person.Id}`}
                className="row row-lift gap-2.5 py-1.5 px-2 my-0 -mx-2 no-underline flex-1 min-w-0"
                style={{ color: 'inherit' }}
                onMouseEnter={() => prefetchPerson(person.Id, treeId)}
                onFocus={() => prefetchPerson(person.Id, treeId)}
            >
                <PersonAvatar
                    mediaId={person.PrimaryMediaId}
                    treeId={treeId}
                    name={fullName(person, t('unknown'))}
                    initials={getInitials(person.FirstName, person.LastName)}
                    sex={person.Sex}
                    size={size}
                    focalX={person.FocalX}
                    focalY={person.FocalY}
                    focalRadius={person.FocalRadius}
                />
                <div className="flex-1 min-w-0 text-sm">
                    <div className="font-medium">{fullName(person, t('unknown'))}</div>
                    {(role || sub) && (
                        <div className="muted text-meta">
                            {role ?? sub}
                        </div>
                    )}
                </div>
            </Link>
            {onRemove && (
                <Button variant="ghost" onClick={onRemove} className={removeBtnCls} style={{ background: 'var(--card)' }} title={removeTitle} aria-label={removeTitle}>
                    ✕
                </Button>
            )}
        </div>
    );
}

type ConfirmRemove =
    | { kind: 'parent'; name: string; familyId: number }
    | { kind: 'partner'; name: string; familyId: number }
    | { kind: 'child'; name: string; familyId: number; childId: number };

export interface RelationshipListProps {
    person: PersonWithRelations;
    treeId: number | null;
    /** Rail-card title; rendered as `SectionHeader level="rail"` with "Add" as its action (#694). */
    title?: ReactNode;
    /** Show "+ Add" (every rung but 'view'). Defaults to false — read-only surfaces never pass it. */
    canEdit?: boolean;
    /** Show the per-row remove (✕): the delete rung (owner/edit), which the
     *  services require to unlink a child or delete a partnership (#848). Defaults to false. */
    canDelete?: boolean;
    /** Refresh the person after an add or remove (parent re-fetches). Required when canEdit is true. */
    onChanged?: () => void;
}

export function RelationshipList({ person, treeId, title, canEdit = false, canDelete = false, onChanged }: RelationshipListProps) {
    const t = useTranslations('personDetail');
    const tc = useTranslations('common');
    const parents = person.parents ?? [];
    const partnerships = person.spouses ?? [];
    const siblings = person.siblings ?? [];

    const [confirmRemove, setConfirmRemove] = useState<ConfirmRemove | null>(null);
    const [busy, setBusy] = useState(false);
    const offerUndo = useUndoRemoval(treeId);

    // Add panel — the toggle lives in the card header (top-right, consistent with
    // the Life events / Gallery "+ Add" actions); the panel drops in below it.
    const [addOpen, setAddOpen] = useState(false);
    // "Add parents" opens the same panel on its "To family" tab (#768, DV-3).
    const [addTab, setAddTab] = useState<'partner' | 'family'>('partner');
    const addRef = useRef<HTMLDivElement>(null);
    const addTriggerRef = useRef<HTMLButtonElement>(null);
    // Keyboard and completion closes hand focus back to "+ Add" (#690); an
    // outside click leaves it where the pointer went.
    const closeAdd = useCallback(() => {
        setAddOpen(false);
        addTriggerRef.current?.focus();
    }, []);
    useEffect(() => {
        if (!addOpen) return;
        // Capture phase: a result click detaches its node during React's same-tick
        // commit; capture fires top-down before that removal, so `.contains` reads
        // the still-attached target correctly (mirrors RelationshipAddPanel's note).
        function onDown(e: MouseEvent) {
            if (addRef.current && !addRef.current.contains(e.target as Node)) setAddOpen(false);
        }
        function onKey(e: KeyboardEvent) { if (e.key === 'Escape') closeAdd(); }
        document.addEventListener('mousedown', onDown, true);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown, true);
            document.removeEventListener('keydown', onKey);
        };
    }, [addOpen, closeAdd]);

    // Compact and evidence amber, like every list lifespan (#766; supersedes #742).
    function shortLifespan(p: Person) {
        const status = livingStatus(p);
        return <Lifespan birth={p.BirthDate} death={p.DeathDate} status={status} />;
    }

    async function handleConfirmRemove() {
        if (!confirmRemove) return;
        setBusy(true);
        try {
            const client = await getDataClient();
            const reload = () => onChanged?.();
            // Each removal is audited; the toast's Undo reverts that entry (#788).
            if (confirmRemove.kind === 'parent') {
                const change = await client.families.removeChild(confirmRemove.familyId, person.Id, treeId);
                offerUndo(change, t('toast_parent_link_removed'), reload);
            } else if (confirmRemove.kind === 'partner') {
                const change = await client.families.remove(confirmRemove.familyId, treeId);
                offerUndo(change, t('toast_partnership_removed', { name: confirmRemove.name }), reload);
            } else {
                const change = await client.families.removeChild(confirmRemove.familyId, confirmRemove.childId, treeId);
                offerUndo(change, tc('toast_child_removed', { name: confirmRemove.name }), reload);
            }
            reload();
        } catch {
            // Mirrors RelationshipsSection's silent-fail contract — the data
            // layer's global handler surfaces unexpected errors elsewhere.
        } finally {
            setBusy(false);
            setConfirmRemove(null);
        }
    }

    const confirmDialogProps = confirmRemove && (() => {
        switch (confirmRemove.kind) {
            case 'parent':
                return { title: t('remove_parent_q'), body: t('remove_parent_q_body', { name: confirmRemove.name }) };
            case 'partner':
                return { title: t('remove_partner_q'), body: t('remove_partner_q_body', { name: confirmRemove.name }) };
            case 'child':
                return { title: t('remove_child_q'), body: t('remove_child_q_body', { name: confirmRemove.name }) };
        }
    })();

    // Nothing to show in ANY group — parents, siblings and partnerships are all
    // empty. Drives the single centred empty state at the foot of the card (#439).
    const isEmpty = parents.length === 0 && siblings.length === 0 && partnerships.length === 0;

    // Every block owns its heading (#481). Previously ONE "Partners (2)" label was
    // emitted above the whole partnership loop, so the second partnership rendered
    // with no heading of its own and inherited whatever came last — which, for a
    // person whose first union has children, put a PARTNER under "Children (2)".
    const multiParentFamilies = parents.length > 1;
    const multiPartnerships = partnerships.length > 1;

    /** The link both recorded parents share, or null when they differ (#982). */
    function sharedLink(rel: (typeof parents)[number]): string | null {
        return sharedChildRelationship(rel.partner1Relationship, rel.partner2Relationship, { partner1: rel.father != null, partner2: rel.mother != null });
    }

    /** Heading for one parent family. Adoptive, foster or step is READ from the
     *  FamilyPerson relationship columns, never inferred from who else is in the family. */
    function parentsHeading(rel: (typeof parents)[number], idx: number): string {
        const shared = sharedLink(rel);
        if (shared === 'Adoption') return t('parents_adoptive');
        if (shared === 'Foster') return t('parents_foster');
        if (shared === 'Step') return t('parents_step');
        if (shared === 'Guardian') return t('parents_guardian');
        return multiParentFamilies
            ? t('parents_n_of_m', { n: idx + 1, m: parents.length })
            : t('parents');
    }

    /** "Stepfather", "Adoptive mother": named per parent only when the two differ,
     *  since a shared link is already the block's heading (#982). The word follows
     *  the parent's own sex, not the family slot: an unknown sex reads "Parent" (#1232). */
    function parentRole(rel: (typeof parents)[number], slot: 'partner1' | 'partner2'): string {
        const link = slot === 'partner1' ? rel.partner1Relationship : rel.partner2Relationship;
        const sex = (slot === 'partner1' ? rel.father : rel.mother)?.Sex;
        const role = sex === 'M' ? 'father' : sex === 'F' ? 'mother' : 'parent';
        if (sharedLink(rel) === null && link && ['Adoption', 'Foster', 'Step', 'Guardian'].includes(link)) {
            return t(`${role}_${link.toLowerCase()}` as 'father_step');
        }
        return t(role);
    }

    // A full-width rule between blocks. Headings alone were what failed here, so the
    // boundary has to be visible — but the indent + left rule this replaced was too
    // faint to read as one at a glance, which is the whole job. Applied above every
    // block except the first, so it reads as a separator rather than decoration on
    // any one block. Two weights: a 2px rule under the title and between family
    // blocks (a parent family, each partnership), and the 1px hairline inside one
    // (parents → siblings, partner → children).
    const blockRuleCls = 'mt-3.5 pt-3.5 border-t-2 border-[color:var(--border)]';
    const subRuleCls = 'mt-3 pt-3 border-t border-[color:var(--border)]';

    // IDs already related to this person — excluded from the add-partner picker.
    const relatedIds = new Set<number>([person.Id]);
    partnerships.forEach((p) => p.person && relatedIds.add(p.person.Id));

    return (
        <div className="card card-pad">
            {(title || canEdit) && (
                <div ref={addRef}>
                    <SectionHeader
                        level="rail"
                        className="mb-3.5"
                        title={title ?? null}
                        action={canEdit && (
                            <Button
                                ref={addTriggerRef}
                                variant="ghost"
                                icon={<Plus className="w-4 h-4" aria-hidden="true" />}
                                onClick={() => { setAddTab('partner'); setAddOpen((o) => !o); }}
                                className="text-meta shrink-0 [@media(pointer:coarse)]:min-h-11"
                                aria-expanded={addOpen}
                            >
                                {t('add')}
                            </Button>
                        )}
                    />
                    {canEdit && addOpen && (
                        <RelationshipAddPanel
                            personId={person.Id}
                            treeId={treeId}
                            excludeIds={Array.from(relatedIds)}
                            onAdded={() => onChanged?.()}
                            onClose={closeAdd}
                            initialTab={addTab}
                            key={addTab}
                        />
                    )}
                </div>
            )}
            {/* Parents lead the pane, but only when the pane has ANYTHING to show.
                With no relationships at all this used to render "Parents / Unknown."
                and then a second line saying there were none — naming parents
                specifically, though the pane covers every relationship type (#439).
                The centred empty state below replaces both. */}
            {!isEmpty && parents.length === 0 && <div className="rel-group-label mb-2">{t('parents')}</div>}
            {isEmpty ? null : parents.length === 0 ? (
                <div className="row gap-2 flex-wrap items-baseline text-sm py-1 px-0">
                    <span className="muted">{t('no_parents_linked')}</span>
                    {canEdit && (
                        <button
                            type="button"
                            onClick={() => { setAddTab('family'); setAddOpen(true); }}
                            className="text-link hover:underline cursor-pointer focus-ring rounded-sm"
                        >
                            {t('add_parents')}
                        </button>
                    )}
                </div>
            ) : (
                parents.map((rel, idx) => {
                    // removeChild detaches this person's child-link to the WHOLE family
                    // (both partners at once). Each parent row carries the same hover-
                    // reveal ghost ✕, and the confirm names EVERY parent in the couple —
                    // so the action can never claim to remove just one parent while
                    // silently removing both (see RelationshipsSection, edit page).
                    const parentNames = [rel.father, rel.mother]
                        .filter((p): p is Person => Boolean(p))
                        .map((p) => fullName(p, t('unknown')))
                        .join(' & ');
                    const onRemoveParents = canDelete && rel.family?.Id
                        ? () => setConfirmRemove({ kind: 'parent', name: parentNames, familyId: rel.family!.Id })
                        : undefined;
                    return (
                    <div key={`parents-${idx}`} className={idx > 0 ? blockRuleCls : undefined}>
                        <div className={groupHeaderCls}>
                            <div className="rel-group-label">{parentsHeading(rel, idx)}</div>
                            {rel.family?.Id && (
                                <Link
                                    href={`/families/view?id=${rel.family.Id}`}
                                    className={viewFamilyCls}
                                    onMouseEnter={() => prefetchFamily(rel.family?.Id, treeId)}
                                    onFocus={() => prefetchFamily(rel.family?.Id, treeId)}
                                >
                                    {t('view_family')}
                                </Link>
                            )}
                        </div>
                        {rel.father && (
                            <PersonRow person={rel.father} treeId={treeId} role={parentRole(rel, 'partner1')} onRemove={onRemoveParents} removeTitle={t('remove_parent_link')} />
                        )}
                        {rel.mother && (
                            <PersonRow person={rel.mother} treeId={treeId} role={parentRole(rel, 'partner2')} onRemove={onRemoveParents} removeTitle={t('remove_parent_link')} />
                        )}
                        {/* Siblings sit INSIDE the parent family they come through.
                            Flattened into one list they mixed half-siblings from two
                            families under a single "Siblings" heading (#481). */}
                        {rel.siblings.length > 0 && (
                            <>
                                <div className={`rel-group-label ${subRuleCls} mx-0 mb-2`}>
                                    {rel.siblings.length === 1 ? t('sibling_one') : t('siblings', { count: rel.siblings.length })}
                                </div>
                                {rel.siblings.map(sib => (
                                    <PersonRow key={sib.Id} person={sib} treeId={treeId} sub={shortLifespan(sib)} />
                                ))}
                            </>
                        )}
                    </div>
                    );
                })
            )}

            {partnerships.length > 0 && (
                <>
                    {partnerships.map((p, idx) => (
                        // Always ruled: the parents block above always renders something,
                        // even when it is only "Parents / Unknown."
                        <div key={`partner-${idx}`} className={`${blockRuleCls} mb-2.5`}>
                            <div className={groupHeaderCls}>
                                <div className="rel-group-label">
                                    {multiPartnerships
                                        ? t('partner_n_of_m', { n: idx + 1, m: partnerships.length })
                                        : t('partner_one')}
                                </div>
                                <Link
                                    href={`/families/view?id=${p.family.Id}`}
                                    className={viewFamilyCls}
                                    onMouseEnter={() => prefetchFamily(p.family.Id, treeId)}
                                    onFocus={() => prefetchFamily(p.family.Id, treeId)}
                                >
                                    {t('view_family')}
                                </Link>
                            </div>
                            {p.person ? (
                                <PersonRow
                                    person={p.person}
                                    treeId={treeId}
                                    sub={
                                        p.family.MarriageDate
                                            ? `${t('married_short', { year: formatYearForDisplay(p.family.MarriageDate) })}${p.family.MarriagePlace ? ` ${p.family.MarriagePlace.split(',')[0]}` : ''}`
                                            : t('partnership_unknown_date')
                                    }
                                    onRemove={canDelete ? () => setConfirmRemove({ kind: 'partner', name: fullName(p.person, t('unknown')), familyId: p.family.Id }) : undefined}
                                    removeTitle={t('remove_partner_q')}
                                />
                            ) : (
                                <div className="muted text-sm py-1 px-0">{t('unknown_partner')}</div>
                            )}
                            {/* The heading NAMES the partner when there is more than one
                                union, so "Children" can never be read against the wrong
                                one (#481). */}
                            {p.children && p.children.length > 0 && (
                                <div className={`rel-group-label ${subRuleCls} mx-0 mb-1.5`}>
                                    {multiPartnerships && p.person
                                        ? t('children_with', { count: p.children.length, name: fullName(p.person, t('unknown')) })
                                        : t('children_count', { count: p.children.length })}
                                </div>
                            )}
                            {p.children?.map(child => (
                                <PersonRow
                                    key={child.Id}
                                    person={child}
                                    treeId={treeId}
                                    sub={shortLifespan(child)}
                                    onRemove={canDelete ? () => setConfirmRemove({ kind: 'child', name: fullName(child, t('unknown')), familyId: p.family.Id, childId: child.Id }) : undefined}
                                    removeTitle={t('remove_child_q')}
                                />
                            ))}
                        </div>
                    ))}
                </>
            )}

            {isEmpty && (
                <div className="py-8 px-4 text-center">
                    <div className="serif text-md font-semibold mb-1">{t('no_relationships')}</div>
                    <p className="muted text-sm m-0">{t('no_relationships_hint')}</p>
                </div>
            )}

            {confirmRemove && confirmDialogProps && (
                <ConfirmDialog
                    open
                    variant="calm"
                    tone="danger"
                    title={confirmDialogProps.title}
                    body={confirmDialogProps.body}
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
