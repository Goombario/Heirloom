import { query } from '@/lib/db/connection';
import { resolveTreeScope } from '@/lib/db/queries/trees';
import { NotFoundError } from '@/lib/data/errors';
import { formatYearForDisplay, parseDateComponents } from '@/lib/date-utils';
import { displayFullName } from '@/lib/utils/names';
import type { Person, Family } from '@/lib/db/schema';
import type { TreeData, TreeNode, FocusTrees, TreeLifespan } from '@/app/components/tree/types';
import { primaryPhotoJoin } from '@/lib/db/queries/media-tags';
import { pickDefaultRoot } from '@/lib/tree/defaultRoot';

/**
 * The columns the tree is built from. The whole tree is read on every load, so
 * the reads name them instead of taking `p.*` / `f.*`: notes, raw GEDCOM and the
 * place texts never reach a tree node (#1270).
 */
type TreePerson = Pick<Person, 'Id' | 'FirstName' | 'LastName' | 'Sex' | 'BirthDate' | 'DeathDate' | 'IsDeceased'> & {
  EffectiveFirstName: string | null;
  Nickname: string | null;
  AllNames: string | null;
};
type TreeFamily = Pick<Family, 'Id' | 'Partner1Id' | 'Partner2Id'>;

/** Normalised helper — Partner1Id is canonical; HusbandId/WifeId are legacy aliases. */
function p1(fam: TreeFamily): number | null { return fam.Partner1Id; }
function p2(fam: TreeFamily): number | null { return fam.Partner2Id; }

interface PersonWithFamilies extends TreePerson {
  familiesAsHusband: (TreeFamily & { wife?: TreePerson; children?: TreePerson[] })[];
  familiesAsWife: (TreeFamily & { husband?: TreePerson; children?: TreePerson[] })[];
}

export interface GetTreeServiceParams {
  id?: number | null;
  /** 'descendants' | 'ancestors' | 'focus'; anything else collapses to 'descendants'. */
  mode: string;
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

/** GET /api/tree logic: load all people/families for the tree owner, build the TreeData payload. */
export async function getTreeService(params: GetTreeServiceParams): Promise<TreeData> {
  const { id, requestedTreeId, requestedOwnerId, currentUserId } = params;
  const mode = (['descendants', 'ancestors', 'focus'].includes(params.mode)
    ? params.mode
    : 'descendants') as 'descendants' | 'ancestors' | 'focus';

  const scope = await resolveTreeScope(
    { treeId: requestedTreeId, ownerId: requestedOwnerId },
    currentUserId
  );
  const treeId = scope.treeId;

  const [peopleRes, familiesRes, fpRes, photosRes] = await Promise.all([
    query(
      // One grouped pass over the tree's name variants, joined once, instead of
      // three lookups per person (#1270). A person has at most one primary name
      // (idx_namevariant_one_primary), so MAX picks it.
      `SELECT p."Id", p."FirstName", p."LastName", p."Sex", p."BirthDate", p."DeathDate", p."IsDeceased",
              COALESCE(n."PrimaryName", p."FirstName") AS "EffectiveFirstName",
              n."Nickname", n."AllNames"
       FROM "People" p
       LEFT JOIN (
         SELECT nv."PersonId",
                MAX(nv."Name") FILTER (WHERE nv."IsPrimary" = 1) AS "PrimaryName",
                MAX(nv."Name") FILTER (WHERE nv."IsPrimary" = 1 AND nv."Type" = 'Nickname') AS "Nickname",
                string_agg(nv."Name", ' ') AS "AllNames"
           FROM "NameVariant" nv
          WHERE nv."PersonId" IN (SELECT "Id" FROM "People" WHERE "TreeId" = $1)
          GROUP BY nv."PersonId"
       ) n ON n."PersonId" = p."Id"
       WHERE p."TreeId" = $1`,
      [treeId]
    ),
    query(`SELECT f."Id", f."Partner1Id", f."Partner2Id" FROM "Families" f WHERE f."TreeId" = $1`, [treeId]),
    query(
      `SELECT fp."FamiliesAsChildId", fp."ChildrenId" FROM "FamilyPerson" fp
       INNER JOIN "Families" f ON fp."FamiliesAsChildId" = f."Id"
       WHERE f."TreeId" = $1`,
      [treeId]
    ),
    query(
      `SELECT p."Id" AS "PersonId", m."Id", m."FocalX", m."FocalY", m."FocalRadius"
       FROM "People" p
       ${primaryPhotoJoin('p', 'p."TreeId"', 'm')}
       WHERE p."TreeId" = $1 AND m."Id" IS NOT NULL
       ORDER BY p."Id"`,
      [treeId]
    ),
  ]);

  const allPeople = peopleRes.rows as TreePerson[];
  const allFamilies = familiesRes.rows as TreeFamily[];
  const familyPersons = fpRes.rows as { FamiliesAsChildId: number; ChildrenId: number }[];
  const primaryPhotos = photosRes.rows as {
    Id: number; PersonId: number; FocalX?: number; FocalY?: number; FocalRadius?: number;
  }[];

  // Index FamilyPerson once so relationship lookups are O(1) instead of scanning
  // all FamilyPerson rows per family (the ancestor/focus builders previously did
  // `familyPersons.filter(...)` inside loops over `allFamilies` — O(families ×
  // familyPersons) per node — audit #8). childrenByFamilyId preserves
  // familyPersons order; familiesByChildId is built by iterating allFamilies so
  // its lists keep allFamilies order (what the old `allFamilies.filter` returned).
  const childrenByFamilyId = new Map<number, number[]>();
  for (const fp of familyPersons) {
    let kids = childrenByFamilyId.get(fp.FamiliesAsChildId);
    if (!kids) childrenByFamilyId.set(fp.FamiliesAsChildId, kids = []);
    kids.push(fp.ChildrenId);
  }
  const familiesByChildId = new Map<number, TreeFamily[]>();
  for (const fam of allFamilies) {
    for (const childId of childrenByFamilyId.get(fam.Id) ?? []) {
      let fams = familiesByChildId.get(childId);
      if (!fams) familiesByChildId.set(childId, fams = []);
      fams.push(fam);
    }
  }

  const photoMap = new Map<number, number>();
  const focalMap = new Map<number, { x: number; y: number; r: number | null }>();
  for (const photo of primaryPhotos) {
    if (photo.PersonId) {
      photoMap.set(photo.PersonId, photo.Id);
      focalMap.set(photo.PersonId, {
        x: photo.FocalX ?? 50,
        y: photo.FocalY ?? 50,
        r: photo.FocalRadius ?? null,
      });
    }
  }

  const personMap = new Map<number, PersonWithFamilies>();
  for (const p of allPeople) {
    personMap.set(p.Id, { ...p, familiesAsHusband: [], familiesAsWife: [] });
  }

  for (const fam of allFamilies) {
    const children = (childrenByFamilyId.get(fam.Id) ?? [])
      .map(cid => personMap.get(cid))
      .filter(Boolean) as TreePerson[];

    const famP1 = p1(fam); const famP2 = p2(fam);
    if (famP1 && personMap.has(famP1)) {
      personMap.get(famP1)!.familiesAsHusband.push({
        ...fam, wife: famP2 ? personMap.get(famP2) : undefined, children,
      });
    }
    if (famP2 && personMap.has(famP2)) {
      personMap.get(famP2)!.familiesAsWife.push({
        ...fam, husband: famP1 ? personMap.get(famP1) : undefined, children,
      });
    }
  }

  let root: PersonWithFamilies | undefined;
  if (id) root = personMap.get(id);
  if (!root) {
    // No root asked for, or one not in this tree (#1055): the ancestor with the
    // most generations of descendants.
    const fallback = pickDefaultRoot(personMap.keys(), allFamilies, childrenByFamilyId);
    if (fallback !== undefined) root = personMap.get(fallback);
  }
  if (!root) throw new NotFoundError('No root person found');

  const childIds = new Set(familyPersons.map(fp => fp.ChildrenId));
  const parentIds = new Set<number>();
  const spouseIds = new Set<number>();
  for (const fam of allFamilies) {
    const famP1 = p1(fam); const famP2 = p2(fam);
    if (famP1) spouseIds.add(famP1);
    if (famP2) spouseIds.add(famP2);
    const famChildren = childrenByFamilyId.get(fam.Id) ?? [];
    if (famChildren.length > 0) {
      if (famP1) parentIds.add(famP1);
      if (famP2) parentIds.add(famP2);
    }
  }

  const roots = Array.from(personMap.values())
    .filter(p => !childIds.has(p.Id))
    .sort((a, b) => displayFullName(a).localeCompare(displayFullName(b)))
    .map(p => ({ id: p.Id, name: displayFullName(p) }));

  // Mutable visited-ID set reset between the left/right/center subtrees in focus mode.
  const visitedIds = new Set<number>();

  function lifespanOf(p: TreePerson): TreeLifespan {
    const year = (d: string | null | undefined) => {
      const y = d ? formatYearForDisplay(d) : '?';
      return y === '?' ? null : y;
    };
    return { birth: year(p.BirthDate), death: year(p.DeathDate), deceased: p.IsDeceased === 1 };
  }

  function computeAge(p: TreePerson): number | string | undefined {
    const birth = parseDateComponents(p.BirthDate);
    if (!birth) return undefined;

    let endYear: number, endMonth: number | undefined, endDay: number | undefined;
    if (p.DeathDate) {
      const death = parseDateComponents(p.DeathDate);
      if (!death) return undefined;
      endYear = death.year; endMonth = death.month; endDay = death.day;
    } else if (p.IsDeceased !== 1) {
      const now = new Date();
      endYear = now.getFullYear(); endMonth = now.getMonth() + 1; endDay = now.getDate();
    } else {
      return undefined;
    }

    let age = endYear - birth.year;
    if (birth.month !== undefined && endMonth !== undefined) {
      if (endMonth < birth.month || (endMonth === birth.month && (endDay ?? 31) < (birth.day ?? 1))) {
        age--;
      }
    }
    if (age < 0) return undefined;

    if (age < 2 && birth.month !== undefined && endMonth !== undefined) {
      const months =
        (endYear - birth.year) * 12 +
        (endMonth - birth.month) -
        ((endDay ?? 31) < (birth.day ?? 1) ? 1 : 0);
      return months >= 0 ? `${months}mo` : undefined;
    }
    return age;
  }

  function getFocal(personId: number) {
    const f = focalMap.get(personId);
    return f ? { focalX: f.x, focalY: f.y, focalRadius: f.r } : {};
  }

  function deceased(v: number | null | undefined): boolean | null {
    return v === 1 ? true : v === 0 ? false : null;
  }

  function birthYearOf(p: TreePerson): number | undefined {
    return parseDateComponents(p.BirthDate)?.year;
  }

  function buildNode(
    p: PersonWithFamilies,
    otherParentId?: number,
    stopAtId?: number,
    excludeAsSpouse: Set<number> = new Set(),
    excludeChildIds: Set<number> = new Set(),
  ): TreeNode {
    if (visitedIds.has(p.Id)) {
      return {
        id: p.Id, name: displayFullName(p), photoMediaId: photoMap.get(p.Id) ?? null,
        ...getFocal(p.Id), sex: p.Sex, lifespan: lifespanOf(p), age: computeAge(p),
        birthYear: birthYearOf(p), spouses: [], otherParentId,
      };
    }
    visitedIds.add(p.Id);

    const children: TreeNode[] = [];
    if (stopAtId === undefined || p.Id !== stopAtId) {
      const allFams = [...p.familiesAsHusband, ...p.familiesAsWife];
      for (const fam of allFams) {
        const nextOtherParentId = p1(fam) === p.Id ? p2(fam) : p1(fam);
        for (const child of fam.children || []) {
          if (excludeChildIds.has(child.Id) && child.Id !== stopAtId) continue;
          const childPerson = personMap.get(child.Id);
          if (childPerson) {
            children.push(buildNode(childPerson, nextOtherParentId ?? undefined, stopAtId, excludeAsSpouse, excludeChildIds));
          }
        }
      }
    }

    const spouses: TreeNode['spouses'] = [];
    const processedSpouseIds = new Set<number>();
    for (const fam of p.familiesAsHusband) {
      if (fam.wife && !processedSpouseIds.has(fam.wife.Id) && !excludeAsSpouse.has(fam.wife.Id)) {
        processedSpouseIds.add(fam.wife.Id);
        spouses.push({
          id: fam.wife.Id, name: displayFullName(fam.wife), photoMediaId: photoMap.get(fam.wife.Id) ?? null,
          ...getFocal(fam.wife.Id), sex: fam.wife.Sex, lifespan: lifespanOf(fam.wife),
          age: computeAge(fam.wife), birthYear: birthYearOf(fam.wife),
          isDeceased: deceased(fam.wife.IsDeceased), hasChildren: (fam.children?.length || 0) > 0,
        });
      }
    }
    for (const fam of p.familiesAsWife) {
      if (fam.husband && !processedSpouseIds.has(fam.husband.Id) && !excludeAsSpouse.has(fam.husband.Id)) {
        processedSpouseIds.add(fam.husband.Id);
        spouses.push({
          id: fam.husband.Id, name: displayFullName(fam.husband), photoMediaId: photoMap.get(fam.husband.Id) ?? null,
          ...getFocal(fam.husband.Id), sex: fam.husband.Sex, lifespan: lifespanOf(fam.husband),
          age: computeAge(fam.husband), birthYear: birthYearOf(fam.husband),
          isDeceased: deceased(fam.husband.IsDeceased), hasChildren: (fam.children?.length || 0) > 0,
        });
      }
    }

    return {
      id: p.Id, name: displayFullName(p), photoMediaId: photoMap.get(p.Id) ?? null,
      ...getFocal(p.Id), sex: p.Sex, lifespan: lifespanOf(p), age: computeAge(p),
      birthYear: birthYearOf(p), isDeceased: deceased(p.IsDeceased),
      spouses, otherParentId, children: children.length > 0 ? children : undefined,
    };
  }

  function buildAncestorNode(p: PersonWithFamilies, isRoot = false): TreeNode {
    if (visitedIds.has(p.Id)) {
      return {
        id: p.Id, name: displayFullName(p), photoMediaId: photoMap.get(p.Id) ?? null,
        ...getFocal(p.Id), sex: p.Sex, lifespan: lifespanOf(p), age: computeAge(p),
        birthYear: birthYearOf(p), isDeceased: deceased(p.IsDeceased), spouses: [],
      };
    }
    visitedIds.add(p.Id);

    const parentFamilies = familiesByChildId.get(p.Id) ?? [];

    const ancestors: TreeNode[] = [];
    const spouses: TreeNode['spouses'] = [];
    const processedSpouseIds = new Set<number>();

    for (const fam of parentFamilies) {
      const famP1 = p1(fam); const famP2 = p2(fam);
      if (famP1 && personMap.has(famP1)) ancestors.push(buildAncestorNode(personMap.get(famP1)!, false));
      if (famP2 && personMap.has(famP2)) ancestors.push(buildAncestorNode(personMap.get(famP2)!, false));
    }

    if (isRoot) {
      for (const fam of p.familiesAsHusband) {
        if (fam.wife && !processedSpouseIds.has(fam.wife.Id)) {
          processedSpouseIds.add(fam.wife.Id);
          spouses.push({
            id: fam.wife.Id, name: displayFullName(fam.wife), photoMediaId: photoMap.get(fam.wife.Id) ?? null,
            ...getFocal(fam.wife.Id), sex: fam.wife.Sex, lifespan: lifespanOf(fam.wife),
            age: computeAge(fam.wife), birthYear: birthYearOf(fam.wife),
            isDeceased: deceased(fam.wife.IsDeceased), hasChildren: (fam.children?.length || 0) > 0,
          });
        }
      }
      for (const fam of p.familiesAsWife) {
        if (fam.husband && !processedSpouseIds.has(fam.husband.Id)) {
          processedSpouseIds.add(fam.husband.Id);
          spouses.push({
            id: fam.husband.Id, name: displayFullName(fam.husband), photoMediaId: photoMap.get(fam.husband.Id) ?? null,
            ...getFocal(fam.husband.Id), sex: fam.husband.Sex, lifespan: lifespanOf(fam.husband),
            age: computeAge(fam.husband), birthYear: birthYearOf(fam.husband),
            isDeceased: deceased(fam.husband.IsDeceased), hasChildren: (fam.children?.length || 0) > 0,
          });
        }
      }
    }

    let siblings: NonNullable<TreeNode['siblings']> | undefined;
    if (isRoot) {
      const siblingList: NonNullable<TreeNode['siblings']> = [];
      const processedSiblingIds = new Set<number>([p.Id]);
      for (const fam of parentFamilies) {
        const famP2 = p2(fam); const famP1 = p1(fam);
        const connectingParentId = (famP2 && personMap.has(famP2))
          ? famP2
          : (famP1 && personMap.has(famP1) ? famP1 : null);
        if (!connectingParentId) continue;
        const famChildIds = childrenByFamilyId.get(fam.Id) ?? [];
        for (const childId of famChildIds) {
          if (!processedSiblingIds.has(childId) && personMap.has(childId)) {
            processedSiblingIds.add(childId);
            const sib = personMap.get(childId)!;
            siblingList.push({
              id: sib.Id, name: displayFullName(sib), photoMediaId: photoMap.get(sib.Id) ?? null,
              ...getFocal(sib.Id), sex: sib.Sex, lifespan: lifespanOf(sib),
              age: computeAge(sib), birthYear: birthYearOf(sib),
              isDeceased: deceased(sib.IsDeceased), connectingParentId,
            });
          }
        }
      }
      if (siblingList.length > 0) siblings = siblingList;
    }

    return {
      id: p.Id, name: displayFullName(p), photoMediaId: photoMap.get(p.Id) ?? null,
      ...getFocal(p.Id), sex: p.Sex, lifespan: lifespanOf(p), age: computeAge(p),
      birthYear: birthYearOf(p), isDeceased: deceased(p.IsDeceased),
      spouses, children: ancestors.length > 0 ? ancestors : undefined,
      ...(siblings ? { siblings } : {}),
    };
  }

  // Root each focus side-cluster ONE generation above the focus person's parent —
  // i.e. at the grandparent — so that `buildNode` from there yields the grandparent's
  // full DESCENDANT subtree: the parent's siblings (aunts/uncles) and their children
  // (cousins). That collateral breadth is the point of focus view; a pure direct-line
  // chain (see #219 / #347) renders as a bare one-node-per-generation string and was
  // reverted. Depth stays capped at 2 ancestor generations by construction; the depth
  // slider (pruneFocusDepth / focusMaxDepth) trims this shape client-side and needs no
  // changes — focusMaxDepth simply reports the real 2-generation extent.
  // If the person has no parents recorded, fall back to the person themselves.
  function findAncestorSubtreeRoot(person: PersonWithFamilies): PersonWithFamilies {
    const gpFamilies = [...(familiesByChildId.get(person.Id) ?? [])]
      .sort((a, b) => a.Id - b.Id);
    const gf = gpFamilies[0];
    if (gf) {
      const gfP1 = p1(gf); const gfP2 = p2(gf);
      const gp =
        (gfP1 && personMap.has(gfP1))
          ? personMap.get(gfP1)!
          : (gfP2 && personMap.has(gfP2))
            ? personMap.get(gfP2)!
            : null;
      if (gp) return gp;
    }
    return person;
  }

  let leftTree: TreeNode | null = null;
  let rightTree: TreeNode | null = null;
  let centerTree: TreeNode | null = null;
  let focusLeftParentId: number | null = null;
  let focusRightParentId: number | null = null;

  if (mode === 'focus') {
    const focusParentFamilies = [...(familiesByChildId.get(root!.Id) ?? [])]
      .sort((a, b) => a.Id - b.Id);

    const parentPersons: PersonWithFamilies[] = [];
    for (const fam of focusParentFamilies) {
      const famP1 = p1(fam); const famP2 = p2(fam);
      if (famP1 && personMap.has(famP1)) {
        const pp = personMap.get(famP1)!;
        if (!parentPersons.find(x => x.Id === pp.Id)) parentPersons.push(pp);
      }
      if (famP2 && personMap.has(famP2)) {
        const pp = personMap.get(famP2)!;
        if (!parentPersons.find(x => x.Id === pp.Id)) parentPersons.push(pp);
      }
      if (parentPersons.length >= 2) break;
    }

    const leftExclude = parentPersons.length > 1 ? new Set([parentPersons[1].Id]) : new Set<number>();
    const rightExclude = parentPersons.length > 1 ? new Set([parentPersons[0].Id]) : new Set<number>();

    if (parentPersons.length > 0) {
      focusLeftParentId = parentPersons[0].Id;
      visitedIds.clear();
      leftTree = buildNode(findAncestorSubtreeRoot(parentPersons[0]), undefined, parentPersons[0].Id, leftExclude);
    }
    if (parentPersons.length > 1) {
      focusRightParentId = parentPersons[1].Id;
      visitedIds.clear();
      rightTree = buildNode(findAncestorSubtreeRoot(parentPersons[1]), undefined, parentPersons[1].Id, rightExclude);
    }

    visitedIds.clear();
    const centerRoot = parentPersons.length > 0 ? parentPersons[0] : root;
    centerTree = buildNode(centerRoot);
  }

  const treeData =
    mode === 'focus'
      ? (leftTree ?? rightTree ?? centerTree ?? buildNode(root))
      : mode === 'ancestors'
        ? buildAncestorNode(root, true)
        : buildNode(root);

  const parentFamilies = familiesByChildId.get(root!.Id) ?? [];

  const parents: { id: number; name: string }[] = [];
  for (const fam of parentFamilies) {
    const famP1 = p1(fam); const famP2 = p2(fam);
    if (famP1 && personMap.has(famP1)) {
      parents.push({ id: famP1, name: displayFullName(personMap.get(famP1)!) });
    }
    if (famP2 && personMap.has(famP2)) {
      parents.push({ id: famP2, name: displayFullName(personMap.get(famP2)!) });
    }
  }

  const allPeopleList = Array.from(personMap.values())
    .sort((a, b) => displayFullName(a).localeCompare(displayFullName(b)))
    .map(p => ({
      id: p.Id,
      name: displayFullName(p),
      allNames: p.AllNames ?? null,
      isRoot: !childIds.has(p.Id),
      isLeaf: !parentIds.has(p.Id),
      hasAncestors: childIds.has(p.Id),
      hasDescendants: parentIds.has(p.Id),
      isIsolated: !childIds.has(p.Id) && !parentIds.has(p.Id) && !spouseIds.has(p.Id),
    }));

  const currentPersonIsRoot = !childIds.has(root.Id);
  const currentPersonIsLeaf = !parentIds.has(root.Id);
  const currentPersonHasSpouses =
    root.familiesAsHusband.length > 0 || root.familiesAsWife.length > 0;

  let suggestedMode: 'descendants' | 'ancestors' | 'focus' = mode === 'focus' ? 'focus' : mode;
  // An EXPLICIT ?mode=focus is never second-guessed. Without this, the heuristics
  // below rewrite suggestedMode to 'ancestors' for a leaf (no descendants), and the
  // client's suggested-mode reload path then kicks the user straight back out of
  // focus view on every restore — making focus unusable for childless people.
  const explicitFocus = params.mode === 'focus';
  if (!explicitFocus && (!id || ['descendants', 'ancestors', 'focus'].includes(params.mode))) {
    if (!currentPersonIsRoot && !currentPersonIsLeaf) {
      suggestedMode = 'focus';
    } else if (currentPersonIsRoot && currentPersonIsLeaf) {
      if (currentPersonHasSpouses) {
        const spouseWithTree = [...root.familiesAsHusband, ...root.familiesAsWife].find(fam => {
          const spouseId = p1(fam) === root!.Id ? p2(fam) : p1(fam);
          if (!spouseId) return false;
          return childIds.has(spouseId) || parentIds.has(spouseId);
        });
        if (spouseWithTree) {
          const spouseId = p1(spouseWithTree) === root.Id ? p2(spouseWithTree) : p1(spouseWithTree);
          if (spouseId && childIds.has(spouseId)) suggestedMode = 'ancestors';
          else if (spouseId && parentIds.has(spouseId)) suggestedMode = 'descendants';
        }
      }
    } else if (currentPersonIsLeaf && !currentPersonIsRoot) {
      // A leaf (no descendants) still gets focus by default: its side clusters are
      // rooted at the grandparents, so the view shows the parents' generation and
      // their collateral lines rather than the bare upward chain 'ancestors' gives.
      suggestedMode = 'focus';
    } else if (currentPersonIsRoot && !currentPersonIsLeaf) {
      suggestedMode = 'descendants';
    }
  }

  const focusTrees: FocusTrees | undefined =
    mode === 'focus' && centerTree
      ? (focusLeftParentId !== null || focusRightParentId !== null
          ? {
              stage: 'D' as const,
              left: leftTree,
              right: rightTree,
              center: centerTree,
              focusPersonId: root.Id,
              leftParentId: focusLeftParentId,
              rightParentId: focusRightParentId,
            }
          : {
              stage: 'A' as const,
              center: centerTree,
              focusPersonId: root.Id,
            })
      : undefined;

  return {
    tree: treeData,
    roots,
    currentRootId: root.Id,
    currentMode: mode,
    suggestedMode,
    parents,
    allPeople: allPeopleList,
    ...(focusTrees ? { focusTrees } : {}),
  };
}
