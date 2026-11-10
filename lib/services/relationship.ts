import { query } from '@/lib/db/connection';
import { resolveTreeScope } from '@/lib/db/queries/trees';
import { effectiveFirstName, primaryNickname } from '@/lib/db/queries/people';
import type { RelationshipResult } from '@/lib/data/types';
import { displayFullName } from '@/lib/utils/names';

/** Minimal person row for relationship-path name labels. */
interface PersonNameRow {
  Id: number;
  FirstName: string | null;
  LastName: string | null;
  EffectiveFirstName: string | null;
  Nickname: string | null;
}

interface FamilyRow {
  Id: number;
  Partner1Id: number | null;
  Partner2Id: number | null;
  HusbandId: number | null;
  WifeId: number | null;
}

interface FamilyPersonRow {
  FamiliesAsChildId: number;
  ChildrenId: number;
}

export interface GetRelationshipParams {
  person1Id: number;
  person2Id: number;
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

/** GET /api/relationship logic: BFS over the family graph to find shortest path. */
export async function getRelationshipService(
  params: GetRelationshipParams
): Promise<RelationshipResult> {
  const { person1Id, person2Id, requestedTreeId, requestedOwnerId, currentUserId } = params;

  const scope = await resolveTreeScope(
    { treeId: requestedTreeId, ownerId: requestedOwnerId },
    currentUserId
  );
  const treeId = scope.treeId;

  const [peopleRes, familiesRes, fpRes] = await Promise.all([
    query(
      `SELECT p."Id", p."FirstName", p."LastName",
              ${effectiveFirstName('p')} AS "EffectiveFirstName",
              ${primaryNickname('p')} AS "Nickname"
       FROM "People" p WHERE p."TreeId" = $1`,
      [treeId]
    ),
    query('SELECT "Id", "Partner1Id", "Partner2Id", "HusbandId", "WifeId" FROM "Families" WHERE "TreeId" = $1', [treeId]),
    query(
      `SELECT fp."FamiliesAsChildId", fp."ChildrenId" FROM "FamilyPerson" fp
       INNER JOIN "Families" f ON fp."FamiliesAsChildId" = f."Id"
       WHERE f."TreeId" = $1`,
      [treeId]
    ),
  ]);

  const people = peopleRes.rows as PersonNameRow[];
  const peopleMap = new Map(people.map((p) => [p.Id, p]));
  const families = familiesRes.rows as FamilyRow[];
  const familyPersons = fpRes.rows as FamilyPersonRow[];

  const graph = new Map<number, Set<number>>();
  const relationshipType = new Map<string, string>();

  for (const family of families) {
    const fp1 = family.Partner1Id ?? family.HusbandId ?? null;
    const fp2 = family.Partner2Id ?? family.WifeId ?? null;
    if (fp1 && fp2) {
      if (!graph.has(fp1)) graph.set(fp1, new Set());
      if (!graph.has(fp2)) graph.set(fp2, new Set());
      graph.get(fp1)!.add(fp2);
      graph.get(fp2)!.add(fp1);
      relationshipType.set(`${fp1}-${fp2}`, 'spouse');
      relationshipType.set(`${fp2}-${fp1}`, 'spouse');
    }
  }

  for (const fp of familyPersons) {
    const family = families.find((f) => f.Id === fp.FamiliesAsChildId);
    if (!family) continue;
    const childId = fp.ChildrenId;
    if (!graph.has(childId)) graph.set(childId, new Set());
    const fp1 = family.Partner1Id ?? family.HusbandId ?? null;
    const fp2 = family.Partner2Id ?? family.WifeId ?? null;

    if (fp1) {
      if (!graph.has(fp1)) graph.set(fp1, new Set());
      graph.get(fp1)!.add(childId);
      graph.get(childId)!.add(fp1);
      relationshipType.set(`${fp1}-${childId}`, 'parent');
      relationshipType.set(`${childId}-${fp1}`, 'child');
    }
    if (fp2) {
      if (!graph.has(fp2)) graph.set(fp2, new Set());
      graph.get(fp2)!.add(childId);
      graph.get(childId)!.add(fp2);
      relationshipType.set(`${fp2}-${childId}`, 'parent');
      relationshipType.set(`${childId}-${fp2}`, 'child');
    }
  }

  const visited = new Set<number>();
  const queue: Array<{ id: number; path: number[] }> = [{ id: person1Id, path: [person1Id] }];
  visited.add(person1Id);

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.id === person2Id) {
      const path = current.path.map((id, idx) => {
        const person = peopleMap.get(id);
        const name = person ? displayFullName(person) : 'Unknown';
        let rel = 'Start';
        if (idx > 0) {
          const prevId = current.path[idx - 1];
          rel = relationshipType.get(`${prevId}-${id}`) || 'related';
        }
        return { id, name, relationship: rel };
      });
      return {
        path,
        relationship: describeRelationship(path.map((p) => p.relationship)),
        degree: path.length - 1,
      };
    }
    const neighbors = graph.get(current.id) ?? new Set<number>();
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push({ id: neighbor, path: [...current.path, neighbor] });
      }
    }
  }

  return { path: [], relationship: 'No relationship found', degree: -1 };
}

function describeRelationship(steps: string[]): string {
  if (steps.length <= 1) return 'Same person';
  const relations = steps.slice(1);
  const hasSpousePrefix = relations[0] === 'spouse';
  const hasSpouseSuffix = relations[relations.length - 1] === 'spouse';
  const core = relations.filter((r) => r !== 'spouse');
  if (core.length === 0) return 'Spouse';

  let up = 0;
  let down = 0;
  let switchedToDown = false;
  for (const step of core) {
    if (step === 'child') {
      if (switchedToDown) {
        return formatWithInLaw(`${relations.length}-step relationship`, hasSpousePrefix, hasSpouseSuffix);
      }
      up++;
    } else if (step === 'parent') {
      switchedToDown = true;
      down++;
    }
  }
  return formatWithInLaw(getKinshipTerm(up, down), hasSpousePrefix, hasSpouseSuffix);
}

function formatWithInLaw(label: string, prefix: boolean, suffix: boolean): string {
  if (!prefix && !suffix) return label;
  if (prefix && !suffix) {
    if (label === 'Child') return 'Step-child';
    if (label === 'Parent') return 'Step-parent';
    return `${label}-in-law`;
  }
  if (suffix && !prefix) return `${label}-in-law`;
  return `${label} (by marriage)`;
}

function getKinshipTerm(up: number, down: number): string {
  if (down === 0) {
    if (up === 1) return 'Parent';
    if (up === 2) return 'Grandparent';
    if (up === 3) return 'Great-grandparent';
    return 'Great-'.repeat(up - 2) + 'grandparent';
  }
  if (up === 0) {
    if (down === 1) return 'Child';
    if (down === 2) return 'Grandchild';
    if (down === 3) return 'Great-grandchild';
    return 'Great-'.repeat(down - 2) + 'grandchild';
  }
  if (up === 1 && down === 1) return 'Sibling';
  if (up === 1 && down === 2) return 'Niece/Nephew';
  if (up === 2 && down === 1) return 'Uncle/Aunt';
  if (up === 1 && down === 3) return 'Grand-niece/nephew';
  if (up === 3 && down === 1) return 'Grand-uncle/aunt';
  if (up === 1 && down > 3) return 'Great-'.repeat(down - 2) + 'grand-niece/nephew';
  if (up > 3 && down === 1) return 'Great-'.repeat(up - 2) + 'grand-uncle/aunt';

  const cousinDegree = Math.min(up, down) - 1;
  const removed = Math.abs(up - down);
  if (cousinDegree <= 0) {
    if (up > down) return 'Great-'.repeat(Math.max(0, up - 2)) + (up >= 2 ? 'grand-' : '') + 'uncle/aunt';
    return 'Great-'.repeat(Math.max(0, down - 2)) + (down >= 2 ? 'grand-' : '') + 'niece/nephew';
  }
  const ordinal = getOrdinal(cousinDegree);
  if (removed === 0) return `${ordinal} cousin`;
  return `${ordinal} cousin ${removed}x removed`;
}

function getOrdinal(n: number): string {
  if (n === 1) return '1st';
  if (n === 2) return '2nd';
  if (n === 3) return '3rd';
  return `${n}th`;
}
