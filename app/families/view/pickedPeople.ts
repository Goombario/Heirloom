import { getDataClient } from '@/lib/data';
import { displayFullName } from '@/lib/utils/names';
import type { PickedPerson } from '@/app/components/PersonPickerSheet';

/*
 * A person picked in a family finder or sheet (#1062, #119): someone in the tree,
 * or a new person typed in, created only when the link is written.
 */

/** The name a picked person goes by in the confirm step. */
export function pickedName(p: PickedPerson, unknown: string): string {
    return p.kind === 'existing'
        ? displayFullName(p.person) || unknown
        : [p.draft.firstName, p.draft.lastName].filter(Boolean).join(' ') || unknown;
}

/** Create a picked new person, or return the existing one's id. */
export async function idOf(p: PickedPerson, treeId: number | null, auditIds: number[]): Promise<number> {
    if (p.kind === 'existing') return p.person.Id;
    const client = await getDataClient();
    const d = p.draft;
    const created = await client.people.create({ FirstName: d.firstName || null, LastName: d.lastName || null, Sex: d.sex, BirthDate: d.birthDate }, { treeId });
    auditIds.push(...created.auditIds);
    return created.Id;
}

