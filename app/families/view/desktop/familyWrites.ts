'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { getDataClient } from '@/lib/data';
import type { ChildRelationshipInput } from '@/lib/data/types';
import type { FamilyType } from '@/lib/db/schema';
import type { PickedPerson } from '@/app/components/PersonPickerSheet';
import { showChangeToast } from '@/app/components/ui';
import { useErrorToast } from '@/app/components/useErrorToast';
import type { RunChange } from '@/app/people/view/mobile/useChange';
import { partnerShortName } from '../derive';
import { SLOT_COLUMN, type Slot } from '../mobile/model';
import { idOf, pickedName } from '../pickedPeople';
import type { PartnerPerson } from '../useFamilyDetail';

/** A name typed into a finder, as a person to create: "Anna Maria Lind" → Anna / Maria Lind. */
export function draftFrom(typed: string, lastName: string): PickedPerson {
    const words = typed.trim().split(/\s+/).filter(Boolean);
    return { kind: 'new', draft: { firstName: words[0] ?? '', lastName: words.length > 1 ? words.slice(1).join(' ') : lastName, sex: null, birthDate: null } };
}

/**
 * The desktop family page's people writes (#119, interactions G4, G5, G6, G8): the
 * phone's writes, reported the same way (reload, then a toast with Undo for those
 * who may revert). A person created in the finder is taken back if the link fails.
 */
export function useFamilyWrites({ familyId, partner1, partner2, name, treeId, role, run }: {
    familyId: number;
    partner1: PartnerPerson | null;
    partner2: PartnerPerson | null;
    /** The couple's name, for the delete toast. */
    name: string;
    treeId: number | null;
    role: 'viewer' | 'contributor' | 'editor';
    run: RunChange;
}) {
    const t = useTranslations('familyPhone');
    const tc = useTranslations('common');
    const tf = useTranslations('families');
    const router = useRouter();
    const { reportError } = useErrorToast();
    const editor = role === 'editor';
    const unknown = tc('unknown');
    const first = (p: PartnerPerson | null) => (p ? partnerShortName(p) || unknown : unknown);

    /** Take back what a failed write created, then rethrow its error. */
    async function rollback(e: unknown, auditIds: number[]): Promise<never> {
        if (editor && auditIds.length > 0) {
            try { const client = await getDataClient(); await client.audit.revert(auditIds, treeId); } catch { /* report the first error */ }
        }
        throw e;
    }

    async function setPartner(slot: Slot, picked: PickedPerson): Promise<boolean> {
        return run(async () => {
            const auditIds: number[] = [];
            try {
                const id = await idOf(picked, treeId, auditIds);
                const client = await getDataClient();
                auditIds.push(...(await client.families.update(familyId, { [SLOT_COLUMN[slot]]: id }, treeId)).auditIds);
            } catch (e) {
                await rollback(e, auditIds);
            }
            return { auditIds };
        }, { message: t('partner_added', { name: pickedName(picked, unknown) }) });
    }

    async function removePartner(slot: Slot): Promise<boolean> {
        const person = slot === 'partner1' ? partner1 : partner2;
        if (!person) return false;
        return run(async () => {
            const client = await getDataClient();
            return client.families.update(familyId, { [SLOT_COLUMN[slot]]: null }, treeId);
        }, { message: t('partner_removed', { name: first(person) }), detail: t('stays_in_tree') });
    }

    async function addChildren(picked: PickedPerson[], relationship: ChildRelationshipInput): Promise<boolean> {
        if (picked.length === 0) return false;
        return run(async () => {
            const auditIds: number[] = [];
            try {
                const client = await getDataClient();
                for (const p of picked) {
                    const id = await idOf(p, treeId, auditIds);
                    auditIds.push(...(await client.families.addChild(familyId, id, relationship, treeId)).auditIds);
                }
            } catch (e) {
                await rollback(e, auditIds);
            }
            return { auditIds };
        }, {
            message: picked.length === 1 ? t('child_added', { name: pickedName(picked[0], unknown) }) : t('children_added', { count: picked.length }),
        });
    }

    async function setType(type: FamilyType): Promise<boolean> {
        return run(async () => {
            const client = await getDataClient();
            return client.families.update(familyId, { Type: type }, treeId);
        }, { message: tf('type_saved') });
    }

    /** Delete at once (nobody is deleted), back to Families, with Undo that reopens it. */
    async function deleteFamily(): Promise<boolean> {
        let auditId: number | null = null;
        try {
            const client = await getDataClient();
            ({ auditId } = await client.families.remove(familyId, treeId));
        } catch (e) {
            reportError(e);
            return false;
        }
        router.push('/families');
        showChangeToast({
            message: t('family_deleted', { name }),
            detail: t('family_deleted_detail'),
            onUndo: editor && auditId != null ? async () => {
                try {
                    const client = await getDataClient();
                    await client.audit.revert([auditId as number], treeId);
                    router.push(`/families/view?id=${familyId}`);
                } catch (e) {
                    reportError(e);
                }
            } : undefined,
        });
        return true;
    }

    return { setPartner, removePartner, addChildren, setType, deleteFamily };
}

export type FamilyWrites = ReturnType<typeof useFamilyWrites>;
