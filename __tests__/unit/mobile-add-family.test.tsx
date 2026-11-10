/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

vi.mock('next-intl', () => ({
  useTranslations: () => Object.assign((key: string) => key, {
    has: () => false,
    rich: (key: string) => key,
  }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ back: vi.fn(), push: vi.fn() }) }));
vi.mock('@/app/components/GuardedLink', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock('@/app/components/date-input/aliases', () => ({ useDateQualifierWords: () => ({}) }));
vi.mock('@/app/components/ProfileImage', () => ({ default: () => <img alt="" /> }));
vi.mock('@/app/components/media/MediaGallery', () => ({ default: () => <div data-testid="gallery" /> }));
vi.mock('@/app/components/ui/Sheet', () => ({
  Sheet: ({ open, title, children, onSave, onBack, dirty, saveWhenClean, saveDisabled }: {
    open: boolean; title: string; children: React.ReactNode; onSave?: () => void; onBack?: () => void;
    dirty?: boolean; saveWhenClean?: boolean; saveDisabled?: boolean;
  }) =>
    open ? (
      <div role="dialog" aria-label={title}>
        {onBack && <button type="button" onClick={onBack}>sheet-back</button>}
        {onSave && <button type="button" onClick={onSave} disabled={saveDisabled || !(dirty || saveWhenClean)}>sheet-save</button>}
        {children}
      </div>
    ) : null,
  ConfirmSheet: () => null,
}));
vi.mock('@/app/components/DateInput', () => ({
  default: ({ id, value, onChange }: { id?: string; value: string; onChange: (v: string) => void }) =>
    <input id={id} aria-label="date" value={value} onChange={(e) => onChange(e.target.value)} />,
}));
vi.mock('@/app/components/LocationField', () => ({ default: () => null }));
vi.mock('@/app/components/media/OwnerMediaCard', () => ({ OwnerMediaCard: () => null }));
vi.mock('@/app/components/media/EventMediaDraftPanel', () => ({ default: () => null }));
vi.mock('@/app/components/media/useEventMediaDraft', () => ({ useEventMediaDraft: () => ({ items: [], failures: [], process: vi.fn() }) }));

// The shared picker has its own suite; here it only hands back a pick.
const picker = vi.hoisted(() => ({ last: null as null | Record<string, unknown> }));
vi.mock('@/app/components/PersonPickerSheet', () => ({
  PersonPickerSheet: (p: { open: boolean; title: string; onPick: (x: unknown[]) => void; onBack?: () => void; suggested?: { label: string; people: { Id: number }[] } }) => {
    picker.last = p as unknown as Record<string, unknown>;
    return p.open ? (
      <div role="dialog" aria-label={p.title}>
        {p.onBack && <button type="button" onClick={p.onBack}>sheet-back</button>}
        {p.suggested && <p>{p.suggested.label}: {p.suggested.people.map((x) => x.Id).join(',')}</p>}
        <button type="button" onClick={() => p.onPick([{ kind: 'existing', person: { Id: 7, FirstName: 'Karl', LastName: 'Vale', Sex: 'M', BirthDate: '1896', DeathDate: null } }])}>pick-karl</button>
        <button type="button" onClick={() => p.onPick([{ kind: 'new', draft: { firstName: 'Nils', lastName: 'Berg', sex: 'M', birthDate: '1870' } }])}>pick-new</button>
      </div>
    ) : null;
  },
}));

const client = vi.hoisted(() => ({
  people: {
    update: vi.fn(),
    create: vi.fn(async () => ({ Id: 50, auditIds: [101] })),
    list: vi.fn(async () => ({ people: [], count: 0 })),
  },
  families: {
    create: vi.fn(async () => ({ Id: 60, auditIds: [102] })),
    update: vi.fn(async () => ({ Id: 20, auditIds: [103] })),
    addChild: vi.fn(async () => ({ auditIds: [104] })),
  },
  audit: { revert: vi.fn(async () => ({ success: true, revertedCount: 1 })) },
}));
vi.mock('@/lib/data', async (orig) => ({ ...(await orig<typeof import('@/lib/data')>()), getDataClient: async () => client }));
const toast = vi.hoisted(() => ({ showChangeToast: vi.fn(), showErrorToast: vi.fn() }));
vi.mock('@/app/components/ui/Toast', () => ({ ...toast, showSuccessToast: vi.fn(), showInfoToast: vi.fn(), AppToaster: () => null, dismissChangeToast: vi.fn() }));

import type { PersonWithRelations, Person } from '@/lib/db/schema';
import { MobilePersonPage, type MobilePersonPageProps } from '@/app/people/view/mobile/MobilePersonPage';
import { birthWindow, linkPlan, parentFamilyOptions, suggestRelatives } from '@/app/people/view/mobile/familyLinks';
import type { DataCheckMarks } from '@/app/components/data-checks/marks';
import { dataCache } from '@/lib/data/cache';

const kin = (Id: number, FirstName: string, Sex: string, BirthDate: string | null = null, LastName = 'Vale'): Person =>
  ({ Id, FirstName, LastName, Sex, BirthDate, DeathDate: null, IsDeceased: null } as unknown as Person);

function person(over: Partial<PersonWithRelations> = {}): PersonWithRelations {
  return {
    Id: 1, FirstName: 'Greta', LastName: 'Vale', EffectiveFirstName: null, Nickname: null, Sex: 'F',
    BirthDate: '1871', BirthPlace: null, DeathDate: null, DeathPlace: null, IsDeceased: 1, events: [],
    // Olav's family has a free slot for a mother.
    parents: [{ father: kin(2, 'Olav', 'M', '1840'), mother: null, family: { Id: 20, Partner1Id: 2, Partner2Id: null } as never, siblings: [kin(4, 'Anna', 'F', '1875')] }],
    siblings: [],
    spouses: [{ person: kin(5, 'Anders', 'M', '1868', 'Berg'), family: { Id: 21, MarriageDate: '1893' } as never, children: [kin(6, 'Ingrid', 'F', '1894', 'Berg')] }],
    ...over,
  } as PersonWithRelations;
}

const noMarks: DataCheckMarks = { open: [], byFact: new Map(), text: { sentence: () => '', ruleName: () => '' } as never };

function props(over: Partial<MobilePersonPageProps> = {}): MobilePersonPageProps {
  return {
    person: person(), media: [], variants: [], notes: [], biography: null, facts: [], sourceNumbers: new Map(),
    marks: noMarks, treeId: 1, role: 'editor', language: 'en', placeCoords: {}, descendants: 0,
    citePins: () => null, onShowDescendants: vi.fn(), onCite: vi.fn(), citeSheets: () => null, onAddMedia: vi.fn(),
    onMediaChanged: vi.fn(), onChanged: vi.fn(),
    ...over,
  };
}

const undoOf = () => (toast.showChangeToast.mock.calls.at(-1)![0] as { onUndo?: () => Promise<void> }).onUndo;

describe('Add family planning (#1050)', () => {
  it('suggests by plausible dates, and by surname for children and siblings, never someone already linked', () => {
    const pool = [
      kin(2, 'Olav', 'M', '1840'), // already the father
      kin(30, 'Per', 'M', '1845'), kin(31, 'Lisa', 'F', '1845', 'Holm'), kin(32, 'Old', 'M', '1780'),
      kin(33, 'Sven', 'M', '1898', 'Berg'), kin(34, 'Eva', 'F', '1900', 'Holm'), kin(35, 'Tor', 'M', null),
      kin(36, 'Elsa', 'F', '1873'),
    ];
    expect(birthWindow('parent', '1871')).toEqual({ from: 1801, to: 1857 });
    const parents = suggestRelatives('parent', person(), pool);
    expect(parents.people.map((p) => p.Id)).toEqual([31, 30]);
    expect(parents.surname).toBeNull();
    // A child carries this person's surname or a partner's.
    expect(suggestRelatives('child', person(), pool).people.map((p) => p.Id)).toEqual([33]);
    expect(suggestRelatives('sibling', person(), pool)).toMatchObject({ surname: 'Vale' });
    expect(suggestRelatives('sibling', person(), pool).people.map((p) => p.Id)).toEqual([36]);
    // No birth year: only a surname narrows, so a partner gets nothing.
    expect(suggestRelatives('partner', person({ BirthDate: null }), pool).people).toEqual([]);
    expect(suggestRelatives('parent', person({ BirthDate: null }), pool).people.map((p) => p.Id)).toEqual([36, 32, 30, 35]);
  });

  it('plans the writes for each role', () => {
    expect(linkPlan('partner', 1, { familyId: null, familyType: 'Common-law', startDate: '1890' }))
      .toEqual([{ kind: 'create-family', partners: [1, 'picked'], type: 'Common-law', startDate: '1890' }]);
    expect(parentFamilyOptions(person())).toEqual([{ familyId: 20, slot: 'Partner2Id', parent: expect.objectContaining({ Id: 2 }), relationshipType: null }]);
    expect(linkPlan('parent', 1, { familyId: 20, slot: 'Partner2Id' })).toEqual([{ kind: 'set-partner', familyId: 20, slot: 'Partner2Id' }]);
    expect(linkPlan('parent', 1, { familyId: null })).toEqual([
      { kind: 'create-family', partners: ['picked', null] }, { kind: 'add-child', familyId: 'new', child: 1, type: 'Birth' },
    ]);
    expect(linkPlan('child', 1, { familyId: null, childType: 'Foster' })).toEqual([
      { kind: 'create-family', partners: [1, null] }, { kind: 'add-child', familyId: 'new', child: 'picked', type: 'Foster' },
    ]);
    expect(linkPlan('sibling', 1, { familyId: null })).toHaveLength(3);
  });
});

describe('Add family sheet (#1050)', () => {
  beforeEach(() => { vi.clearAllMocks(); dataCache.clear(); });

  const openFamilyTab = (over: Partial<MobilePersonPageProps> = {}) => {
    render(<MobilePersonPage {...props(over)} />);
    fireEvent.click(screen.getByRole('tab', { name: /tab_family/ }));
  };

  it('adds an existing child to the chosen family as adopted, with Undo', async () => {
    openFamilyTab();
    fireEvent.click(screen.getByText('add_family', { selector: 'span' }));
    const chooser = screen.getByRole('dialog', { name: 'add_family' });
    fireEvent.click(within(chooser).getByText('role_child'));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'title_child' })).getByText('pick-karl'));
    const confirm = screen.getByRole('dialog', { name: 'title_child' });
    expect(within(confirm).getByRole('radio', { name: /with_partner/ })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(within(confirm).getByRole('radio', { name: 'child_type_Adoption' }));
    await act(async () => { fireEvent.click(within(confirm).getByText('sheet-save')); });
    expect(client.families.addChild).toHaveBeenCalledWith(21, 7, 'Adoption', 1);
    expect(client.people.create).not.toHaveBeenCalled();
    await act(async () => { await undoOf()!(); });
    expect(client.audit.revert).toHaveBeenCalledWith([104], 1);
  });

  it('creates a new partner and their family, and Undo takes back both', async () => {
    openFamilyTab();
    fireEvent.click(screen.getByText('add_family', { selector: 'span' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'add_family' })).getByText('role_partner'));
    fireEvent.click(screen.getByText('pick-new'));
    const confirm = screen.getByRole('dialog', { name: 'title_partner' });
    fireEvent.click(within(confirm).getByText('ftype_civil_union'));
    fireEvent.click(within(confirm).getByText('add_start'));
    fireEvent.change(within(confirm).getByLabelText('date'), { target: { value: '1899' } });
    await act(async () => { fireEvent.click(within(confirm).getByText('sheet-save')); });
    expect(client.people.create).toHaveBeenCalledWith({ FirstName: 'Nils', LastName: 'Berg', Sex: 'M', BirthDate: '1870' }, { treeId: 1 });
    expect(client.families.create).toHaveBeenCalledWith({ Partner1Id: 1, Partner2Id: 50, Type: 'Civil union', MarriageDate: '1899' }, 1);
    await act(async () => { await undoOf()!(); });
    expect(client.audit.revert).toHaveBeenCalledWith([101, 102], 1);
  });

  it('opens the parent picker from the Add parents row, without the chooser', () => {
    // With no parents, the section's own row opens the parent picker straight away.
    openFamilyTab({ person: person({ parents: [] }) });
    fireEvent.click(screen.getByText('add_parents_row'));
    expect(screen.getByRole('dialog', { name: 'title_parent' })).toBeInTheDocument();
    expect(screen.queryByText('sheet-back')).toBeNull();
  });

  it('joins an open parent slot, and takes back a new person when the link fails', async () => {
    openFamilyTab();
    fireEvent.click(screen.getByText('add_family', { selector: 'span' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'add_family' })).getByText('role_parent'));
    client.families.update.mockRejectedValueOnce(new Error('boom'));
    fireEvent.click(screen.getByText('pick-new'));
    const confirm = screen.getByRole('dialog', { name: 'title_parent' });
    expect(within(confirm).getByRole('radio', { name: /parent_family/ })).toHaveAttribute('aria-checked', 'true');
    await act(async () => { fireEvent.click(within(confirm).getByText('sheet-save')); });
    expect(client.families.update).toHaveBeenCalledWith(20, { Partner2Id: 50 }, 1);
    expect(client.audit.revert).toHaveBeenCalledWith([101], 1);
    expect(toast.showChangeToast).not.toHaveBeenCalled();
  });

  it('opens a sibling on the parent family, with suggestions from the people list', async () => {
    client.people.list.mockResolvedValueOnce({ people: [kin(40, 'Johan', 'M', '1869')], count: 1 } as never);
    openFamilyTab();
    fireEvent.click(screen.getByText('add_family', { selector: 'span' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'add_family' })).getByText('role_sibling'));
    expect(await screen.findByText('suggested_surname_window: 40')).toBeInTheDocument();
    fireEvent.click(screen.getByText('pick-karl'));
    await act(async () => { fireEvent.click(within(screen.getByRole('dialog', { name: 'title_sibling' })).getByText('sheet-save')); });
    expect(client.families.addChild).toHaveBeenCalledWith(20, 7, 'Birth', 1);
  });
});
