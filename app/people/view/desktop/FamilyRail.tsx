'use client';

import { useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { PersonGalleryMedia, PersonWithRelations } from '@/lib/db/schema';
import type { AuditedChange } from '@/lib/data/types';
import { getDataClient } from '@/lib/data';
import { formatYearOrEmpty } from '@/lib/date-utils';
import { livingStatus } from '@/lib/living';
import { displayFullName } from '@/lib/utils/names';
import { getInitials } from '@/lib/utils/initials';
import { useErrorToast } from '@/app/components/useErrorToast';
import { useUndoRemoval } from '@/app/hooks/useUndoRemoval';
import { kindKey } from '@/app/families/view/mobile/model';
import { ActionLink, DetailRail, FamilyRecordRow, Lifespan, OpenInTreeRow, PersonRow, SectionHeader } from '@/app/components/ui';
import { AddFamilyPanel } from './AddFamilyPanel';
import type { RunChange } from '../mobile/useChange';
import { nameBarParts, type FamilyCard, type PortraitPerson } from '../mobile/model';
import { desktopFamily, type ChildEntry, type ParentBlock, type PartnerBlock, type SiblingEntry } from './family';

/**
 * The desktop person page's right rail (#49): Open in tree, then a block per parent
 * family (its record row, the parents, this person's siblings through it), a block
 * per partnership (its record row, the partner, their children), Add family and the
 * journey. Unlinks act at once and offer Undo (editors only).
 */
export function FamilyRail({ person, portrait, treeId, canEdit, canDelete, journeyCount, onShowJourney, onChanged, run }: {
  person: PersonWithRelations;
  portrait?: PersonGalleryMedia;
  treeId: number | null;
  /** Add family: every rung but viewer. */
  canEdit: boolean;
  /** Unlinks: editors only (the services refuse contributors, #848). */
  canDelete: boolean;
  /** Places on the journey map; the section shows only when there is one. */
  journeyCount: number;
  onShowJourney: () => void;
  onChanged: () => void;
  /** Add family's writes: reload, then the Undo toast. */
  run: RunChange;
}) {
  const t = useTranslations('personDesktop');
  const family = useMemo(() => desktopFamily(person, portrait), [person, portrait]);
  const given = nameBarParts(person).given || t('this_person');
  const { reportError } = useErrorToast();
  const offerUndo = useUndoRemoval(treeId);
  const [adding, setAdding] = useState(false);
  const addRef = useRef<HTMLButtonElement>(null);

  const unlink = async (write: () => Promise<AuditedChange[]>, message: string) => {
    try {
      const changes = await write();
      onChanged();
      offerUndo(changes, message, onChanged);
    } catch (e) {
      reportError(e);
    }
  };

  const removeAsChild = (familyId: number, child: { Id: number }, childName: string, card: FamilyCard) => unlink(
    async () => {
      const client = await getDataClient();
      return [await client.families.removeChild(familyId, child.Id, treeId)];
    },
    unlinkedMessage(t, childName, card),
  );

  const removePartnerSlot = (b: PartnerBlock) => unlink(
    async () => {
      const client = await getDataClient();
      // Mobile style (#49): only this person's slot empties; the family stays with the
      // other partner and the children. A family that would be left with nobody at all
      // goes, so no empty record lingers in the Families list (Undo brings it back).
      if (!b.partner && b.children.length === 0) return [await client.families.remove(b.familyId, treeId)];
      const slot = person.spouses?.find((s) => s.family.Id === b.familyId)?.family.Partner1Id === person.Id ? 'Partner1Id' : 'Partner2Id';
      const saved = await client.families.update(b.familyId, { [slot]: null }, treeId);
      return saved.auditIds.map((auditId) => ({ auditId }));
    },
    b.partner
      ? t('partner_unlinked', { name: given, other: nameBarParts({ ...b.partner, EffectiveFirstName: b.partner.EffectiveFirstName ?? null, Nickname: b.partner.Nickname ?? null }).given || t('this_person') })
      : t('partner_unlinked_alone', { name: given }),
  );

  return (
    <DetailRail look="open">
      <OpenInTreeRow personId={person.Id} firstName={given} />

      {family.parentBlocks.length === 0 ? (
        <section id="parents" aria-labelledby="rail-parents" className="rail-anchor">
          <SectionHeader level="label" as="h3" headingId="rail-parents" title={t('parents')} />
          <p className="m-0 text-sm text-text-muted">{t('no_parents')}</p>
        </section>
      ) : family.parentBlocks.map((b, i) => (
        <ParentSection
          key={b.familyId}
          block={b}
          index={i}
          total={family.parentBlocks.length}
          treeId={treeId}
          unlink={canDelete ? () => removeAsChild(b.familyId, person, given, b.card) : undefined}
          unlinkLabel={t('remove_from_family', { name: given })}
        />
      ))}

      {family.partnerBlocks.map((b, i) => (
        <PartnerSection
          key={b.familyId}
          block={b}
          index={i}
          total={family.partnerBlocks.length}
          treeId={treeId}
          given={given}
          unlinkSelf={canDelete ? () => removePartnerSlot(b) : undefined}
          unlinkChild={canDelete ? (c) => removeAsChild(b.familyId, c.person, displayFullName(c.person) || t('this_person'), b.card) : undefined}
        />
      ))}

      {canEdit && (
        <section aria-labelledby="rail-add">
          <h3 id="rail-add" className="sr-only">{t('add_family')}</h3>
          <ActionLink ref={addRef} kind="expand" expanded={adding} onClick={() => setAdding((v) => !v)}>{t('add_family')}</ActionLink>
          {adding && (
            // Escape closes it and hands focus back to "Add family" (#690).
            <div className="mt-2" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setAdding(false); addRef.current?.focus(); } }}>
              <AddFamilyPanel
                person={person}
                treeId={treeId}
                canUndo={canDelete}
                run={run}
                onClose={() => { setAdding(false); addRef.current?.focus(); }}
              />
            </div>
          )}
        </section>
      )}

      {journeyCount > 0 && (
        <section aria-labelledby="rail-journey">
          <SectionHeader level="label" as="h3" headingId="rail-journey" title={t('journey')} />
          <p className="m-0 mb-1.5 text-sm text-text-secondary">{t('journey_places', { count: journeyCount })}</p>
          <ActionLink kind="leave" onClick={onShowJourney}>{t('journey_open')}</ActionLink>
        </section>
      )}
    </DetailRail>
  );
}

type Translate = ReturnType<typeof useTranslations<'personDesktop'>>;

/** "Anna is no longer a child of Johan and Kristina." Names come in whole, never joined. */
function unlinkedMessage(t: Translate, name: string, card: FamilyCard): string {
  const [first, second] = card.names;
  if (first && second) return t('unlinked_two', { name, first, second });
  if (first) return t('unlinked_one', { name, first });
  return t('unlinked_family', { name });
}

function useFamilyRowText() {
  const t = useTranslations('personDesktop');
  const tk = useTranslations('familyPhone');
  return (card: FamilyCard) => {
    const [a, b] = card.names;
    const title = b ? t('family_of_two', { first: a, second: b }) : a ? t('family_of_one', { name: a }) : t('family_unnamed');
    const sub = [
      tk(`kind_${kindKey(card.type)}`),
      formatYearOrEmpty(card.startDate),
      card.childCount > 0 ? t('children_count', { count: card.childCount }) : '',
    ].filter(Boolean).join(' · ');
    return { title, sub };
  };
}

function Row({ person, treeId, role, unlink }: { person: PortraitPerson; treeId: number | null; role?: string | null; unlink?: { label: string; onClick: () => void } }) {
  const t = useTranslations('personDesktop');
  return (
    <PersonRow
      href={`/people/view?id=${person.Id}`}
      name={displayFullName(person) || t('unknown')}
      initials={getInitials(person.FirstName, person.LastName)}
      sex={person.Sex}
      mediaId={person.PrimaryMediaId ?? null}
      focalX={person.FocalX}
      focalY={person.FocalY}
      focalRadius={person.FocalRadius}
      treeId={treeId}
      nameStyle="serif"
      lifespan={person.BirthDate || person.DeathDate ? <Lifespan birth={person.BirthDate} death={person.DeathDate} status={livingStatus(person)} /> : null}
      role={role}
      unlink={unlink}
    />
  );
}

function ofTotal(t: Translate, title: string, index: number, total: number) {
  return total > 1 ? t('n_of_m', { title, n: index + 1, m: total }) : title;
}

function ParentSection({ block, index, total, treeId, unlink, unlinkLabel }: {
  block: ParentBlock; index: number; total: number; treeId: number | null;
  unlink?: () => void; unlinkLabel: string;
}) {
  const t = useTranslations('personDesktop');
  const rowText = useFamilyRowText();
  const { title, sub } = rowText(block.card);
  const headingId = `rail-parents-${block.familyId}`;
  const heading = block.headingLink ? t(`parents_${block.headingLink}`) : t('parents');
  const sibRole = (s: SiblingEntry) => (s.kind === 'half' ? t('half_sibling') : s.kind === 'step' ? t('step_sibling') : null);
  return (
    <section id={index === 0 ? 'parents' : undefined} aria-labelledby={headingId} className="rail-anchor">
      <SectionHeader level="label" as="h3" headingId={headingId} title={ofTotal(t, heading, index, total)} />
      <div className="grid gap-1">
        <FamilyRecordRow
          density="desktop"
          arrow={false}
          href={`/families/view?id=${block.familyId}`}
          title={title}
          sub={sub}
          stack={block.card.stack}
          treeId={treeId}
          unlink={unlink ? { label: unlinkLabel, onClick: unlink } : undefined}
        />
        {block.parents.length === 0 && <p className="m-0 px-1 text-sm text-text-muted">{t('parents_unknown')}</p>}
        {block.parents.map((p) => (
          <Row key={p.person.Id} person={p.person} treeId={treeId} role={t(p.link ? `role_${p.role}_${p.link}` : `role_${p.role}`)} />
        ))}
        {block.siblings.length > 0 && (
          <>
            <p className="m-0 mt-2 px-1 text-meta font-semibold text-text-secondary">{t('siblings', { count: block.siblings.length })}</p>
            {block.siblings.map((s) => <Row key={s.person.Id} person={s.person} treeId={treeId} role={sibRole(s)} />)}
          </>
        )}
      </div>
    </section>
  );
}

function PartnerSection({ block, index, total, treeId, given, unlinkSelf, unlinkChild }: {
  block: PartnerBlock; index: number; total: number; treeId: number | null; given: string;
  unlinkSelf?: () => void; unlinkChild?: (c: ChildEntry) => void;
}) {
  const t = useTranslations('personDesktop');
  const rowText = useFamilyRowText();
  const { title, sub } = rowText(block.card);
  const headingId = `rail-partner-${block.familyId}`;
  const childRole = (c: ChildEntry) => {
    if (!c.role) return null;
    if (c.role === 'step') return t(c.person.Sex === 'M' ? 'stepson' : c.person.Sex === 'F' ? 'stepdaughter' : 'stepchild');
    return t(`child_${c.role}`);
  };
  const partnerRole = block.partner
    ? t(block.partner.Sex === 'M' ? 'role_husband' : block.partner.Sex === 'F' ? 'role_wife' : 'role_partner')
    : null;
  return (
    <section aria-labelledby={headingId}>
      <SectionHeader level="label" as="h3" headingId={headingId} title={ofTotal(t, t('partner'), index, total)} />
      <div className="grid gap-1">
        <FamilyRecordRow
          density="desktop"
          arrow={false}
          href={`/families/view?id=${block.familyId}`}
          title={title}
          sub={sub}
          stack={block.card.stack}
          treeId={treeId}
          unlink={unlinkSelf ? { label: t('remove_as_partner', { name: given }), onClick: unlinkSelf } : undefined}
        />
        {block.partner
          ? <Row person={block.partner} treeId={treeId} role={block.type === 'Marriage' || block.type == null ? partnerRole : t('role_partner')} />
          : <p className="m-0 px-1 text-sm text-text-muted">{t('partner_unknown')}</p>}
        {block.children.length > 0 && (
          <>
            <p className="m-0 mt-2 px-1 text-meta font-semibold text-text-secondary">{t('children', { count: block.children.length })}</p>
            {block.children.map((c) => (
              <Row
                key={c.person.Id}
                person={c.person}
                treeId={treeId}
                role={childRole(c)}
                unlink={unlinkChild ? { label: t('remove_child', { name: displayFullName(c.person) || t('unknown') }), onClick: () => unlinkChild(c) } : undefined}
              />
            ))}
          </>
        )}
      </div>
    </section>
  );
}
