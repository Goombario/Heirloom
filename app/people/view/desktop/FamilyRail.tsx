'use client';

import { useMemo, useState } from 'react';
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
import { useReturnFocus } from '@/app/hooks/useReturnFocus';
import { kindKey } from '@/app/families/view/mobile/model';
import { ActionLink, AddRow, DetailRail, FamilyRecordRow, Lifespan, OpenInTreeRow, PersonRow, SectionHeader } from '@/app/components/ui';
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
  // The button unmounts while the panel is open; closing hands focus back (#690).
  const addRef = useReturnFocus(adding);

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

  const parentSets = family.parentBlocks.length;
  const partners = family.partnerBlocks;
  const withChildren = partners.some((b) => b.children.length > 0);
  const partnerHeading = withChildren
    ? t('partners_children_heading', { count: partners.length })
    : t('partners_heading', { count: Math.max(partners.length, 1) });

  return (
    // The locked board's rail: Open in tree, then PARENTS and PARTNER AND CHILDREN as
    // two sections behind hairline bars, each family's people under its record row,
    // siblings and children nested on a guide line.
    <DetailRail look="open" className="rail-bars">
      <OpenInTreeRow personId={person.Id} firstName={given} />

      <section id="parents" aria-labelledby="rail-parents" className="rail-anchor">
        <SectionHeader level="label" as="h3" headingId="rail-parents" title={t('parents')} />
        {parentSets === 0 && <p className="m-0 text-sm text-text-muted">{t('no_parents')}</p>}
        {family.parentBlocks.map((b, i) => (
          <ParentBlockView
            key={b.familyId}
            block={b}
            index={i}
            total={parentSets}
            treeId={treeId}
            unlink={canDelete ? () => removeAsChild(b.familyId, person, given, b.card) : undefined}
            unlinkLabel={t('remove_from_family', { name: given })}
          />
        ))}
      </section>

      {(partners.length > 0 || canEdit) && (
        <section aria-labelledby="rail-partners">
          <SectionHeader level="label" as="h3" headingId="rail-partners" title={partnerHeading} />
          {partners.map((b, i) => (
            <PartnerBlockView
              key={b.familyId}
              block={b}
              index={i}
              total={partners.length}
              treeId={treeId}
              given={given}
              unlinkSelf={canDelete ? () => removePartnerSlot(b) : undefined}
              unlinkChild={canDelete ? (c) => removeAsChild(b.familyId, c.person, displayFullName(c.person) || t('this_person'), b.card) : undefined}
            />
          ))}
          {canEdit && (
            <div className={partners.length > 0 ? 'rail-addrow' : undefined}>
              {/* A plain "+ Add family" button, not an expander: the panel takes
                  its place while open, as on the locked person page. */}
              {!adding && <div className="ledger-foot ledger-foot--plain"><AddRow ref={addRef} label={t('add_family')} onClick={() => setAdding(true)} /></div>}
              {adding && (
                // Escape closes it; the button comes back with focus (#690).
                <div onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setAdding(false); } }}>
                  <AddFamilyPanel
                    person={person}
                    treeId={treeId}
                    canUndo={canDelete}
                    run={run}
                    onClose={() => setAdding(false)}
                  />
                </div>
              )}
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


/** With more than one set: "Adoptive parents · 2 of 2" over the set. */
function SetHead({ title, index, total }: { title: string; index: number; total: number }) {
  const t = useTranslations('personDesktop');
  if (total < 2) return null;
  return (
    <p className="rail-subhead">
      <b>{title}</b>
      <span>{t('n_of_total', { n: index + 1, m: total })}</span>
    </p>
  );
}

function ParentBlockView({ block, index, total, treeId, unlink, unlinkLabel }: {
  block: ParentBlock; index: number; total: number; treeId: number | null;
  unlink?: () => void; unlinkLabel: string;
}) {
  const t = useTranslations('personDesktop');
  const rowText = useFamilyRowText();
  const { title, sub } = rowText(block.card);
  const heading = block.headingLink ? t(`parents_${block.headingLink}`) : t('parents');
  const sibRole = (s: SiblingEntry) => (s.kind === 'half' ? t('half_sibling') : s.kind === 'step' ? t('step_sibling') : null);
  return (
    <div className="rail-block">
      <SetHead title={heading} index={index} total={total} />
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
      {/* A parent's role shows only when the link isn't by birth ("Stepfather"). */}
      {block.parents.map((p) => (
        <Row key={p.person.Id} person={p.person} treeId={treeId} role={p.link ? t(`role_${p.role}_${p.link}`) : null} />
      ))}
      {block.siblings.length > 0 && (
        <div className="rail-kids">
          <span className="rail-kids__label">{t('siblings', { count: block.siblings.length })}</span>
          {block.siblings.map((s) => <Row key={s.person.Id} person={s.person} treeId={treeId} role={sibRole(s)} />)}
        </div>
      )}
    </div>
  );
}

function PartnerBlockView({ block, index, total, treeId, given, unlinkSelf, unlinkChild }: {
  block: PartnerBlock; index: number; total: number; treeId: number | null; given: string;
  unlinkSelf?: () => void; unlinkChild?: (c: ChildEntry) => void;
}) {
  const t = useTranslations('personDesktop');
  const rowText = useFamilyRowText();
  const { title, sub } = rowText(block.card);
  const childRole = (c: ChildEntry) => {
    if (!c.role) return null;
    if (c.role === 'step') return t(c.person.Sex === 'M' ? 'stepson' : c.person.Sex === 'F' ? 'stepdaughter' : 'stepchild');
    return t(`child_${c.role}`);
  };
  // "m. 1919" on a marriage with a year; otherwise the partner's word.
  const married = block.type === 'Marriage' || block.type == null;
  const year = formatYearOrEmpty(block.startDate);
  const partnerRole = married && year ? t('married_year', { year }) : married ? null : t('role_partner');
  return (
    <div className="rail-block">
      <SetHead title={t('partner')} index={index} total={total} />
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
        ? <Row person={block.partner} treeId={treeId} role={partnerRole} />
        : <p className="m-0 px-1 text-sm text-text-muted">{t('partner_unknown')}</p>}
      {block.children.length > 0 && (
        <div className="rail-kids">
          <span className="sr-only">{t('children', { count: block.children.length })}</span>
          {block.children.map((c) => (
            <Row
              key={c.person.Id}
              person={c.person}
              treeId={treeId}
              role={childRole(c)}
              unlink={unlinkChild ? { label: t('remove_child', { name: displayFullName(c.person) || t('unknown') }), onClick: () => unlinkChild(c) } : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}
