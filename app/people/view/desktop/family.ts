import type { FamilyType, LinkedChild, Person, PersonWithRelations } from '@/lib/db/schema';
import { sortableYear } from '@/lib/date-utils';
import { familyOf, type FamilyCard, type PortraitPerson } from '../mobile/model';

/**
 * The desktop person rail's family blocks (#49): one block per parent family, with
 * this person's siblings inside it, and one per partnership, with its children.
 * The phone tab lists siblings flat; the desktop rail keeps them by family (#481).
 */

/** The stored child-link vocabulary (ADR 0027): Birth, Adoption, Step, Foster, Guardian, Unknown. */
type Link = 'Birth' | 'Adoption' | 'Step' | 'Foster' | 'Guardian' | 'Unknown';

const LINKS: readonly Link[] = ['Birth', 'Adoption', 'Step', 'Foster', 'Guardian', 'Unknown'];
const linkOf = (raw: string | null | undefined): Link => (LINKS.includes(raw as Link) ? raw as Link : 'Unknown');

/** A parent's role on its row when the heading doesn't already say it ("Stepfather"). */
type ParentRole = 'father' | 'mother' | 'parent';
/** How a parent is linked, when it isn't by birth. */
type NonBirthLink = 'adoption' | 'foster' | 'step' | 'guardian';

const NON_BIRTH: Readonly<Partial<Record<Link, NonBirthLink>>> = { Adoption: 'adoption', Foster: 'foster', Step: 'step', Guardian: 'guardian' };

interface ParentEntry {
  person: PortraitPerson;
  role: ParentRole;
  /** Shown on the row only when the block's heading doesn't name a type. */
  link: NonBirthLink | null;
}

type SiblingKind = 'full' | 'half' | 'step';

export interface SiblingEntry {
  person: PortraitPerson;
  kind: SiblingKind;
}

export interface ParentBlock {
  familyId: number;
  card: FamilyCard;
  /** "Adoptive parents" when both parents share one non-birth link; else plain "Parents". */
  headingLink: NonBirthLink | null;
  parents: ParentEntry[];
  siblings: SiblingEntry[];
}

type ChildRoleKind = 'adopted' | 'step' | 'foster' | 'ward';

export interface ChildEntry {
  person: PortraitPerson;
  /** Set when this person's link to the child isn't Birth or Unknown. */
  role: ChildRoleKind | null;
}

export interface PartnerBlock {
  familyId: number;
  card: FamilyCard;
  type: FamilyType | null;
  startDate: string | null;
  partner: PortraitPerson | null;
  children: ChildEntry[];
}

export interface DesktopFamily {
  parentBlocks: ParentBlock[];
  partnerBlocks: PartnerBlock[];
}

const roleOf = (p: Pick<Person, 'Sex'>): ParentRole => (p.Sex === 'M' ? 'father' : p.Sex === 'F' ? 'mother' : 'parent');

/** A link through which two children of one family share that parent. */
const shares = (l: Link) => l === 'Birth' || l === 'Adoption' || l === 'Unknown';

/**
 * Full, half or step, from each child's link to each parent (#49): never chosen
 * by hand. Sharing every recorded parent is full; sharing some is half; sharing
 * none (each is a stepchild of the other's parent) is step.
 */
export function siblingKind(
  self: { Partner1Relationship?: string | null; Partner2Relationship?: string | null },
  sib: { Partner1Relationship?: string | null; Partner2Relationship?: string | null },
  present: { partner1: boolean; partner2: boolean },
): SiblingKind {
  const slots: Array<'Partner1Relationship' | 'Partner2Relationship'> = [];
  if (present.partner1) slots.push('Partner1Relationship');
  if (present.partner2) slots.push('Partner2Relationship');
  if (slots.length === 0) return 'full';
  const shared = slots.filter((k) => shares(linkOf(self[k])) && shares(linkOf(sib[k]))).length;
  return shared === slots.length ? 'full' : shared > 0 ? 'half' : 'step';
}

const CHILD_ROLE: Readonly<Partial<Record<Link, ChildRoleKind>>> = { Adoption: 'adopted', Step: 'step', Foster: 'foster', Guardian: 'ward' };

const byBirth = (a: Person, b: Person) => (sortableYear(a.BirthDate) ?? Infinity) - (sortableYear(b.BirthDate) ?? Infinity);

export function desktopFamily(person: PersonWithRelations, portrait?: Parameters<typeof familyOf>[1]): DesktopFamily {
  const mobile = familyOf(person, portrait);
  const seen = new Set<number>([person.Id]);
  const once = (q: Person | null | undefined): q is PortraitPerson => {
    if (!q || seen.has(q.Id)) return false;
    seen.add(q.Id);
    return true;
  };

  const parentBlocks: ParentBlock[] = (person.parents ?? []).map((rel, i) => {
    const l1 = linkOf(rel.partner1Relationship);
    const l2 = linkOf(rel.partner2Relationship);
    const both = rel.father != null && rel.mother != null;
    // The heading names a type only when both parents share the link (ADR 0027).
    const headingLink = both && l1 === l2 ? NON_BIRTH[l1] ?? null : null;
    const parents: ParentEntry[] = [];
    for (const [q, l] of [[rel.father, l1], [rel.mother, l2]] as const) {
      if (!q) continue;
      // A parent shown in an earlier block still gets a row here: each block is that family.
      parents.push({ person: q as PortraitPerson, role: roleOf(q), link: headingLink ? null : NON_BIRTH[l] ?? null });
    }
    const self = { Partner1Relationship: rel.partner1Relationship, Partner2Relationship: rel.partner2Relationship };
    const present = { partner1: rel.father != null, partner2: rel.mother != null };
    const siblings = [...(rel.siblings ?? [])].sort(byBirth).filter(once)
      .map((s: LinkedChild) => ({ person: s as PortraitPerson, kind: siblingKind(self, s, present) }));
    return { familyId: rel.family.Id, card: mobile.parentFamilies[i], headingLink, parents, siblings };
  });

  const partnerBlocks: PartnerBlock[] = (person.spouses ?? []).map((s, i) => {
    // This person's slot in the family decides which of the child's links is theirs.
    const slot = s.family.Partner1Id === person.Id ? 'Partner1Relationship' : 'Partner2Relationship';
    const g = mobile.partners[i];
    return {
      familyId: s.family.Id,
      card: g.card,
      type: s.family.Type ?? null,
      startDate: s.family.MarriageDate ?? null,
      partner: g.partner as PortraitPerson | null,
      children: (s.children ?? []).filter((c) => c.Id !== person.Id)
        .map((c) => ({ person: c as PortraitPerson, role: CHILD_ROLE[linkOf(c[slot])] ?? null })),
    };
  });

  return { parentBlocks, partnerBlocks };
}
