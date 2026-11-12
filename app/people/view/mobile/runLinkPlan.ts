import type { DataClient } from '@/lib/data/types';
import type { PickedPerson } from '@/app/components/PersonPickerSheet';
import type { LinkStep, Who } from './familyLinks';

/**
 * Runs an Add family plan (`linkPlan`): creates the picked person when they are new,
 * then each write in order, and returns every audit id for Undo. Shared by the phone
 * sheet and the desktop rail (#49). When a write fails, whatever went through is
 * taken back first (editors only; contributors can't revert), so nothing is left
 * half-linked, and the error is rethrown for the caller to report.
 */
export async function runLinkPlan({ client, plan, picked, treeId, canUndo }: {
    client: DataClient;
    plan: LinkStep[];
    picked: PickedPerson;
    treeId: number | null;
    canUndo: boolean;
}): Promise<{ auditIds: number[] }> {
    const auditIds: number[] = [];
    try {
        let pickedId: number;
        if (picked.kind === 'existing') {
            pickedId = picked.person.Id;
        } else {
            const d = picked.draft;
            const created = await client.people.create({
                FirstName: d.firstName || null, LastName: d.lastName || null, Sex: d.sex, BirthDate: d.birthDate,
            }, { treeId });
            auditIds.push(...created.auditIds);
            pickedId = created.Id;
        }
        const who = (w: Who | null) => (w === 'picked' ? pickedId : w);
        let newFamily: number | null = null;
        for (const s of plan) {
            if (s.kind === 'create-family') {
                const f = await client.families.create({
                    Partner1Id: who(s.partners[0]), Partner2Id: who(s.partners[1]),
                    ...(s.type ? { Type: s.type } : {}),
                    ...(s.startDate ? { MarriageDate: s.startDate } : {}),
                }, treeId);
                auditIds.push(...f.auditIds);
                newFamily = f.Id;
            } else if (s.kind === 'set-partner') {
                const f = await client.families.update(s.familyId, { [s.slot]: pickedId }, treeId);
                auditIds.push(...f.auditIds);
            } else {
                const familyId = s.familyId === 'new' ? newFamily : s.familyId;
                if (familyId == null) throw new Error('No family to join');
                const r = await client.families.addChild(familyId, who(s.child) as number, s.type, treeId);
                auditIds.push(...r.auditIds);
            }
        }
    } catch (e) {
        if (canUndo && auditIds.length > 0) {
            try { await client.audit.revert(auditIds, treeId); } catch { /* the error below is the one to show */ }
        }
        throw e;
    }
    return { auditIds };
}
