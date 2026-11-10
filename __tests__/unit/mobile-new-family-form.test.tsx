/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

vi.mock('next-intl', () => ({
  useTranslations: () => Object.assign((key: string) => key, {
    has: () => false,
    rich: (key: string) => key,
  }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ back: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));
vi.mock('@/app/components/GuardedLink', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock('@/app/components/date-input/aliases', () => ({ useDateQualifierWords: () => ({}) }));
vi.mock('@/app/components/PersonAvatar', () => ({ default: () => <span /> }));
vi.mock('@/app/contexts/TreeContext', () => ({ useTree: () => ({ activeTreeId: 1 }) }));
vi.mock('@/app/components/UnsavedChangesProvider', () => ({ useUnsavedChangesGuard: () => ({ onNavigate: vi.fn(), guardNavigation: () => true }) }));
const flushPlace = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('@/app/components/usePlaceResolutionFlush', () => ({ usePlaceResolutionFlush: () => flushPlace }));
const reportError = vi.hoisted(() => vi.fn());
vi.mock('@/app/components/useErrorToast', () => ({ useErrorToast: () => ({ reportError, redirectIfUnauthorized: () => false }) }));

const pool = vi.hoisted(() => ({ people: [] as unknown[] }));
vi.mock('@/app/components/useCachedResource', () => ({ useCachedResource: () => ({ data: pool }) }));

// The picker: one button per person to pick, plus "make-new" for the short New person form.
const pickable = vi.hoisted(() => ({ people: [] as { Id: number; FirstName: string; LastName: string; Sex: string; BirthDate: string | null; DeathDate: string | null }[] }));
vi.mock('@/app/components/PersonPickerSheet', () => ({
  PersonPickerSheet: ({ open, title, onPick, suggested }: { open: boolean; title: string; onPick: (p: unknown[]) => void; suggested?: { label: string; people: { Id: number }[] } }) =>
    open ? (
      <div role="dialog" aria-label={title}>
        {suggested && <p data-testid="suggested">{suggested.people.map((p) => p.Id).join(',')}</p>}
        {pickable.people.map((p) => (
          <button key={p.Id} type="button" onClick={() => onPick([{ kind: 'existing', person: p }])}>{`pick-${p.FirstName}`}</button>
        ))}
        <button type="button" onClick={() => onPick([{ kind: 'new', draft: { firstName: 'Nils', lastName: 'Moe', sex: 'M', birthDate: '1915' } }])}>make-new</button>
      </div>
    ) : null,
}));
vi.mock('@/app/components/ui/Sheet', () => ({
  Sheet: ({ open, title, children, onSave, dirty, saveWhenClean, saveDisabled }: {
    open: boolean; title: string; children: React.ReactNode; onSave?: () => void; dirty?: boolean; saveWhenClean?: boolean; saveDisabled?: boolean;
  }) =>
    open ? (
      <div role="dialog" aria-label={title}>
        {onSave && <button type="button" onClick={onSave} disabled={saveDisabled || !(dirty || saveWhenClean)}>sheet-save</button>}
        {children}
      </div>
    ) : null,
  ConfirmSheet: ({ open, title, confirmLabel, onConfirm, onClose }: { open: boolean; title: string; confirmLabel: string; onConfirm: () => void; onClose: () => void }) =>
    open ? (
      <div role="alertdialog" aria-label={title}>
        <button type="button" onClick={onConfirm}>{confirmLabel}</button>
        <button type="button" onClick={onClose}>keep</button>
      </div>
    ) : null,
}));
vi.mock('@/app/components/citations/CiteSheets', () => ({
  CiteSheets: ({ target, onPending, onClose }: { target: { fact: { factTable: string; label: string } } | null; onPending: (p: unknown) => void; onClose: () => void }) =>
    target ? (
      <button type="button" onClick={() => { onPending({ factTable: target.fact.factTable, factLabel: target.fact.label, page: 'p. 4', sourceId: 70 }); onClose(); }}>
        cite-attach
      </button>
    ) : null,
}));
vi.mock('@/app/components/DateInput', () => ({
  default: ({ id, value, onChange }: { id?: string; value: string; onChange: (v: string) => void }) =>
    <input id={id} value={value} onChange={(e) => onChange(e.target.value)} />,
}));
vi.mock('@/app/components/LocationField', () => ({
  default: ({ id, value, onChange }: { id?: string; value: string; onChange: (v: string) => void }) =>
    <input id={id} value={value} onChange={(e) => onChange(e.target.value)} />,
}));

const client = vi.hoisted(() => ({
  people: {
    create: vi.fn(async () => ({ Id: 90, auditIds: [21] })),
    get: vi.fn(async () => ({ familiesAsSpouse: [] as unknown[] })),
  },
  families: {
    create: vi.fn(async () => ({ Id: 31, auditIds: [3] })),
    addChild: vi.fn(async () => ({ auditIds: [4] })),
  },
  events: { create: vi.fn(async () => ({ Id: 99, auditIds: [8] })) },
  sources: { create: vi.fn(async () => ({ Id: 71 })) },
  citations: { create: vi.fn(async () => ({ Id: 5, auditIds: [9] })) },
  audit: { revert: vi.fn(async () => ({ success: true, revertedCount: 1 })) },
}));
vi.mock('@/lib/data', async (orig) => ({ ...(await orig<typeof import('@/lib/data')>()), getDataClient: async () => client }));
const toast = vi.hoisted(() => ({ showChangeToast: vi.fn(), showErrorToast: vi.fn() }));
vi.mock('@/app/components/ui/Toast', () => ({ ...toast, showSuccessToast: vi.fn(), showInfoToast: vi.fn(), AppToaster: () => null }));

import { NewFamilySheet } from '@/app/families/new/mobile/NewFamilySheet';
import { childWindow, likelyChildren, partnerSuggestions, sharedFamily, slotLinks, stage } from '@/app/families/new/mobile/model';

const olav = { Id: 3, FirstName: 'Olav', LastName: 'Halvorsen', Sex: 'M', BirthDate: '1890', DeathDate: null };
const sigrid = { Id: 4, FirstName: 'Sigrid', LastName: 'Moe', Sex: 'F', BirthDate: '1892', DeathDate: '1961' };
const karl = { Id: 20, FirstName: 'Karl', LastName: 'Halvorsen', Sex: 'M', BirthDate: '1913', DeathDate: null, ParentFamilyId: null };

const face = (BirthDate: string | null, LastName = 'Halvorsen') => ({ Id: 1, FirstName: 'A', LastName, Sex: 'M', BirthDate, DeathDate: null });

describe('phone New family model (#1066)', () => {
  it('puts likely children 16 to 50 years after the partners, by a shared surname and with no parents yet', () => {
    expect(childWindow([face('1890'), face('1892')])).toEqual({ from: 1908, to: 1940 });
    expect(childWindow([face(null)])).toBeNull();
    const people = [
      karl,
      { ...karl, Id: 21, BirthDate: '1950' },
      { ...karl, Id: 22, BirthDate: '1915', ParentFamilyId: 8 },
      { ...karl, Id: 23, LastName: 'Berg' },
      { ...karl, Id: 24, BirthDate: '1910' },
    ];
    expect(likelyChildren([face('1890'), face('1892', 'Moe')], people, [24]).map((p) => p.Id)).toEqual([20]);
  });

  it('suggests partners with no partnership yet, born within 12 years, closest first', () => {
    const people = [
      { ...olav, Id: 5, BirthDate: '1900', PartnershipCount: 0 },
      { ...olav, Id: 6, BirthDate: '1893', PartnershipCount: 0 },
      { ...olav, Id: 7, BirthDate: '1891', PartnershipCount: 1 },
      { ...olav, Id: 8, BirthDate: '1870', PartnershipCount: 0 },
    ];
    expect(partnerSuggestions(face('1890'), people, []).map((p) => p.Id)).toEqual([6, 5]);
  });

  it('finds the family two partners already share, either way round', () => {
    const fams = [{ Id: 1, Partner1Id: 3, Partner2Id: 9 }, { Id: 2, Partner1Id: 4, Partner2Id: 3 }];
    expect(sharedFamily(fams, 3, 4)?.Id).toBe(2);
    expect(sharedFamily(fams, 3, 5)).toBeNull();
  });

  it('saves one partner’s relationship to both slots', () => {
    const a = stage({ kind: 'existing', person: olav });
    const child = { ...stage({ kind: 'existing', person: karl }), links: { [a.key]: 'Adoption' as const } };
    expect(slotLinks(child, [a])).toEqual({ partner1: 'Adoption', partner2: 'Adoption' });
  });
});

describe('phone New family form (#1066)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pool.people = [];
    pickable.people = [olav, sigrid, karl];
  });

  const sheet = () => screen.getByRole('dialog', { name: 'title' });
  const saveButton = () => within(sheet()).getAllByText('sheet-save')[0];

  it('keeps Save dim until there is a partner, then creates the family and opens it', async () => {
    const onCreated = vi.fn();
    render(<NewFamilySheet open onClose={vi.fn()} onCreated={onCreated} />);
    expect(saveButton()).toBeDisabled();
    fireEvent.click(screen.getByText('ftype_civil_union'));
    expect(saveButton()).toBeDisabled();

    fireEvent.click(screen.getByText('add_partner_row'));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'add_partner' })).getByText('pick-Olav'));
    expect(screen.getByText('Olav Halvorsen')).toBeInTheDocument();
    expect(screen.getByText('add_other_partner')).toBeInTheDocument();
    expect(saveButton()).toBeEnabled();

    await act(async () => { fireEvent.click(saveButton()); });
    expect(client.families.create).toHaveBeenCalledWith({ Partner1Id: 3, Partner2Id: null, Type: 'Civil union', MarriageDate: null, MarriagePlace: null, MarriagePlaceId: null }, 1);
    expect(onCreated).toHaveBeenCalledWith(31);
    expect(toast.showChangeToast).toHaveBeenCalledWith({ message: 'added' });
  });

  it('creates a staged new child on Save and links them to each partner as chosen', async () => {
    render(<NewFamilySheet open onClose={vi.fn()} onCreated={vi.fn()} />);
    fireEvent.click(screen.getByText('add_partner_row'));
    fireEvent.click(screen.getByText('pick-Olav'));
    fireEvent.click(screen.getByText('add_other_partner'));
    fireEvent.click(screen.getByText('pick-Sigrid'));

    fireEvent.click(screen.getByText('add_children'));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'add_children' })).getByText('make-new'));
    expect(client.people.create).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Nils Moe'));
    const childSheet = screen.getByRole('dialog', { name: 'Nils Moe' });
    // Two partners: a choice for each (relationship_to … twice); Step for the second.
    const groups = within(childSheet).getAllByRole('group', { name: 'relationship_to' });
    expect(groups).toHaveLength(2);
    fireEvent.click(within(groups[1]).getByText('link_Step'));
    fireEvent.click(within(childSheet).getByText('sheet-save'));

    await act(async () => { fireEvent.click(saveButton()); });
    expect(client.people.create).toHaveBeenCalledWith({ FirstName: 'Nils', LastName: 'Moe', Sex: 'M', BirthDate: '1915' }, { treeId: 1 });
    expect(client.families.create).toHaveBeenCalledWith(expect.objectContaining({ Partner1Id: 3, Partner2Id: 4 }), 1);
    expect(client.families.addChild).toHaveBeenCalledWith(31, 90, { partner1: 'Birth', partner2: 'Step' }, 1);
  });

  it('takes back people it created when the family can’t be saved', async () => {
    client.families.create.mockRejectedValueOnce(new Error('boom'));
    const onCreated = vi.fn();
    render(<NewFamilySheet open onClose={vi.fn()} onCreated={onCreated} />);
    fireEvent.click(screen.getByText('add_partner_row'));
    fireEvent.click(screen.getByText('make-new'));
    await act(async () => { fireEvent.click(saveButton()); });
    expect(client.audit.revert).toHaveBeenCalledWith([21], 1);
    expect(reportError).toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('adds a likely child with one tap', () => {
    pool.people = [karl];
    render(<NewFamilySheet open onClose={vi.fn()} onCreated={vi.fn()} />);
    fireEvent.click(screen.getByText('add_partner_row'));
    fireEvent.click(screen.getByText('pick-Olav'));
    fireEvent.click(screen.getByRole('button', { name: 'add_as_child' }));
    expect(screen.getByText('Karl Halvorsen')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'add_as_child' })).toBeNull();
  });

  it('saves a divorce as a family event, with its citation, and the start’s citation on the family', async () => {
    render(<NewFamilySheet open onClose={vi.fn()} onCreated={vi.fn()} />);
    fireEvent.click(screen.getByText('add_partner_row'));
    fireEvent.click(screen.getByText('pick-Olav'));
    fireEvent.click(screen.getByRole('button', { name: 'cite_label' }));
    fireEvent.click(screen.getByText('cite-attach'));

    fireEvent.click(screen.getByRole('radio', { name: 'ended' }));
    fireEvent.click(screen.getByText('reason_Divorce'));
    expect(screen.getByText('saved_as')).toBeInTheDocument();
    const dates = within(sheet()).getAllByRole('textbox');
    // Start date, start place, end date, end place.
    fireEvent.change(dates[2], { target: { value: '1931' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'cite_label' })[1]);
    fireEvent.click(screen.getByText('cite-attach'));

    await act(async () => { fireEvent.click(saveButton()); });
    expect(client.events.create).toHaveBeenCalledWith({ Type: 'DIV', Date: '1931', Place: null, PlaceId: null, FamilyId: 31 }, 1);
    expect(client.citations.create).toHaveBeenCalledWith(expect.objectContaining({ FactTable: 'Families', FactId: 31, SourceId: 70, Page: 'p. 4' }), 1);
    expect(client.citations.create).toHaveBeenCalledWith(expect.objectContaining({ FactTable: 'Events', FactId: 99, SourceId: 70 }), 1);
  });

  it('asks before clearing a divorce when switching back to Active', () => {
    render(<NewFamilySheet open onClose={vi.fn()} onCreated={vi.fn()} />);
    fireEvent.click(screen.getByRole('radio', { name: 'ended' }));
    fireEvent.click(screen.getByText('reason_Divorce'));
    fireEvent.change(within(sheet()).getAllByRole('textbox')[2], { target: { value: '1931' } });
    fireEvent.click(screen.getByRole('radio', { name: 'active' }));
    const confirm = screen.getByRole('alertdialog', { name: 'clear_end_title' });
    fireEvent.click(within(confirm).getByText('clear_end_pill'));
    expect(screen.getByRole('radio', { name: 'active' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByText('reason_Divorce')).toBeNull();
  });

  it('ends the family when a partner has a recorded death, and turns Active off', () => {
    render(<NewFamilySheet open onClose={vi.fn()} onCreated={vi.fn()} />);
    fireEvent.click(screen.getByText('add_partner_row'));
    fireEvent.click(screen.getByText('pick-Sigrid'));
    expect(screen.getByRole('radio', { name: 'ended' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'active' })).toBeDisabled();
    expect(screen.getByText('death_forces')).toBeInTheDocument();
    expect(screen.getByText('death_from_page')).toBeInTheDocument();
  });

  it('warns when the two partners already share a family', async () => {
    client.people.get.mockResolvedValueOnce({ familiesAsSpouse: [{ Id: 12, Partner1Id: 4, Partner2Id: 3, MarriageDate: '1912' }] });
    render(<NewFamilySheet open onClose={vi.fn()} onCreated={vi.fn()} />);
    fireEvent.click(screen.getByText('add_partner_row'));
    fireEvent.click(screen.getByText('pick-Olav'));
    fireEvent.click(screen.getByText('add_other_partner'));
    fireEvent.click(screen.getByText('pick-Sigrid'));
    await waitFor(() => expect(screen.getByText('shared_title')).toBeInTheDocument());
    expect(screen.getByRole('link')).toHaveAttribute('href', '/families/view?id=12');
  });
});
