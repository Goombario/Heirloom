/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

vi.mock('next-intl', () => ({
  useTranslations: () => Object.assign((key: string) => key, {
    has: () => false,
    rich: (key: string) => key,
  }),
}));
const router = vi.hoisted(() => ({ back: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/app/components/GuardedLink', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock('@/app/components/date-input/aliases', () => ({ useDateQualifierWords: () => ({}) }));
vi.mock('@/app/components/ProfileImage', () => ({ default: () => <img alt="" /> }));
vi.mock('@/app/components/media/MediaGallery', () => ({ default: () => <div data-testid="gallery" /> }));
vi.mock('@/app/components/ui/Sheet', () => ({
  Sheet: ({ open, title, children, onSave, onBack, dirty }: { open: boolean; title: string; children: React.ReactNode; onSave?: () => void; onBack?: () => void; dirty?: boolean }) =>
    open ? (
      <div role="dialog" aria-label={title}>
        {onBack && <button type="button" onClick={onBack}>sheet-back</button>}
        {onSave && <button type="button" onClick={onSave} disabled={!dirty}>sheet-save</button>}
        {children}
      </div>
    ) : null,
  ConfirmSheet: ({ open, title, body, confirmLabel, onConfirm, onClose }: { open: boolean; title: string; body: React.ReactNode; confirmLabel: string; onConfirm: () => void; onClose: () => void }) =>
    open ? (
      <div role="alertdialog" aria-label={title}>
        <p>{body}</p>
        <button type="button" onClick={onConfirm}>{confirmLabel}</button>
        <button type="button" onClick={onClose}>keep</button>
      </div>
    ) : null,
}));
vi.mock('@/app/components/DateInput', () => ({
  default: ({ id, value, onChange }: { id?: string; value: string; onChange: (v: string) => void }) =>
    <input id={id} aria-label="date" value={value} onChange={(e) => onChange(e.target.value)} />,
}));
vi.mock('@/app/components/LocationField', () => ({
  default: ({ id, value, onChange, onResolve }: { id?: string; value: string; onChange: (v: string) => void; onResolve?: (levels: unknown[]) => void }) => (
    <>
      <input id={id} aria-label="place" value={value} onChange={(e) => onChange(e.target.value)} />
      <button type="button" onClick={() => onResolve?.([{ name: value, lat: 57.65, lng: 12.01 }])}>set-pin</button>
    </>
  ),
}));
vi.mock('@/app/components/media/OwnerMediaCard', () => ({ OwnerMediaCard: () => null }));
vi.mock('@/app/components/media/EventMediaDraftPanel', () => ({ default: () => null }));
vi.mock('@/app/components/lightbox/MediaLightbox', () => ({ default: () => <div role="dialog" aria-label="lightbox" /> }));
vi.mock('@/app/components/MediaImg', () => ({ default: () => <img alt="" /> }));
vi.mock('@/lib/media/useMediaUrl', () => ({ useMediaUrl: () => ({ src: '/api/media/1/file' }) }));
vi.mock('@/app/components/useJourneyMap', () => ({ useJourneyMap: () => ({ elRef: { current: null }, failed: false, focusStop: vi.fn() }) }));
vi.mock('@/app/components/media/useEventMediaDraft', () => ({ useEventMediaDraft: () => ({ items: [], failures: [], process: vi.fn() }) }));

const client = vi.hoisted(() => ({
  people: {
    update: vi.fn(async () => ({ auditIds: [7] })),
    remove: vi.fn(async () => undefined),
    createNameVariant: vi.fn(async () => ({ Id: 31, IsPrimary: 1, auditIds: [21] })),
    updateNameVariant: vi.fn(async () => ({ Id: 30, auditIds: [22] })),
    setPrimaryNameVariant: vi.fn(async () => ({ Id: 30, auditIds: [23] })),
    removeNameVariant: vi.fn(async () => ({ auditIds: [24] })),
  },
  notes: {
    create: vi.fn(async () => ({ Id: 41, auditIds: [25] })),
    update: vi.fn(async () => ({ Id: 40, auditIds: [26] })),
    setPrimary: vi.fn(async () => ({ auditIds: [27] })),
    remove: vi.fn(async () => ({ auditIds: [28] })),
  },
  media: {
    clearPrimary: vi.fn(async () => ({ auditIds: [29] })),
    listTags: vi.fn(async () => []),
    createTag: vi.fn(async () => ({ auditIds: [32] })),
    updateTag: vi.fn(async () => ({ auditIds: [33] })),
    setPrimary: vi.fn(async () => ({ auditIds: [34] })),
  },
  events: { create: vi.fn(async () => ({ Id: 99, auditIds: [8] })), update: vi.fn(async () => ({ Id: 10, auditIds: [9] })), remove: vi.fn(async () => ({ auditIds: [11] })) },
  places: { geocodeUpsert: vi.fn(), geocodeUpsertHierarchy: vi.fn() },
  audit: { revert: vi.fn(async () => ({ success: true, revertedCount: 1 })) },
}));
vi.mock('@/lib/data', async (orig) => ({ ...(await orig<typeof import('@/lib/data')>()), getDataClient: async () => client }));
const toast = vi.hoisted(() => ({ showChangeToast: vi.fn(), showErrorToast: vi.fn() }));
vi.mock('@/app/components/ui/Toast', () => ({ ...toast, showSuccessToast: vi.fn(), showInfoToast: vi.fn(), AppToaster: () => null }));

import type { PersonWithRelations, Person } from '@/lib/db/schema';
import { MobilePersonPage, type MobilePersonPageProps } from '@/app/people/view/mobile/MobilePersonPage';
import { commonEventTypes, familyOf, journeyOf, miniMapPoints, nameBarParts, resolveEventType, timelineFacts } from '@/app/people/view/mobile/model';
import type { DataCheckMarks } from '@/app/components/data-checks/marks';

const kin = (Id: number, FirstName: string, Sex: string, BirthDate: string | null = null): Person =>
  ({ Id, FirstName, LastName: 'Vale', Sex, BirthDate, DeathDate: null, IsDeceased: null } as unknown as Person);

function person(over: Partial<PersonWithRelations> = {}): PersonWithRelations {
  const father = kin(2, 'Olav', 'M', '1840');
  const mother = kin(3, 'Kari', 'F', '1843');
  const sister = kin(4, 'Anna', 'F', '1875');
  return {
    Id: 1, FirstName: 'Greta Elin', LastName: 'Vale', EffectiveFirstName: null, Nickname: null, Sex: 'F',
    BirthDate: '1871', BirthPlace: 'Göteborg, Sweden', DeathDate: '1948', DeathPlace: 'Duluth, Minnesota', IsDeceased: 1,
    events: [{ Id: 10, Type: 'IMMI', Date: '1888', Place: 'New York', Description: null } as never],
    parents: [{ father, mother, family: { Id: 20 } as never, siblings: [sister, kin(1, 'Greta Elin', 'F')] }],
    siblings: [sister],
    spouses: [{ person: kin(5, 'Anders', 'M'), family: { Id: 21, MarriageDate: '1893' } as never, children: [kin(6, 'Ingrid', 'F', '1894')] }],
    ...over,
  } as PersonWithRelations;
}

const noMarks: DataCheckMarks = { open: [], byFact: new Map(), text: { sentence: () => '', ruleName: () => '' } as never };

function props(over: Partial<MobilePersonPageProps> = {}): MobilePersonPageProps {
  return {
    person: person(), media: [], variants: [], notes: [], biography: null, facts: [], sourceNumbers: new Map(),
    marks: noMarks, treeId: 1, role: 'editor', language: 'en', placeCoords: {}, descendants: 1,
    citePins: () => null, onShowDescendants: vi.fn(), onCite: vi.fn(), citeSheets: () => null, onAddMedia: vi.fn(),
    onMediaChanged: vi.fn(), onChanged: vi.fn(),
    ...over,
  };
}

describe('phone person page model (#1046)', () => {
  it('orders birth, events and death the way the timeline does', () => {
    expect(timelineFacts(person()).map((f) => f.type)).toEqual(['BIRT', 'IMMI', 'DEAT']);
  });

  it('lists each relative once and never the person', () => {
    const f = familyOf(person());
    expect(f.parents.map((m) => m.relation)).toEqual(['father', 'mother']);
    expect(f.siblings.map((m) => m.person.Id)).toEqual([4]);
    expect(f.partners[0].children.map((c) => c.Id)).toEqual([6]);
  });

  it('cards each family for its record row, partners then children with a photo first (#1098)', () => {
    const withPhoto = { ...kin(7, 'Erik', 'M', '1897'), PrimaryMediaId: 70 } as Person;
    const f = familyOf(person({
      spouses: [{ person: kin(5, 'Anders', 'M'), family: { Id: 21, MarriageDate: '1893', Type: 'Marriage' } as never, children: [kin(6, 'Ingrid', 'F', '1894'), withPhoto] }],
    }));
    // First given names only: "Greta & Anders", not "Greta Elin & Anders".
    expect(f.partners[0].card).toMatchObject({ familyId: 21, type: 'Marriage', startDate: '1893', names: ['Greta', 'Anders'], childCount: 2 });
    expect(f.partners[0].card.stack.map((q) => q.Id)).toEqual([1, 5, 7]);
    // The person counts among their parents' children, in birth order.
    expect(f.parentFamilies).toHaveLength(1);
    expect(f.parentFamilies[0]).toMatchObject({ familyId: 20, names: ['Olav', 'Kari'], childCount: 2 });
    expect(f.parentFamilies[0].stack.map((q) => q.Id)).toEqual([2, 3, 1]);
  });

  it('names the bar by the nickname when it is the preferred name', () => {
    expect(nameBarParts({ FirstName: 'William Henry', LastName: 'Hart', EffectiveFirstName: 'Bill', Nickname: 'Bill' })).toEqual({ given: 'Bill', surname: 'Hart' });
    expect(nameBarParts({ FirstName: 'William Henry', LastName: 'Hart', EffectiveFirstName: null, Nickname: null })).toEqual({ given: 'William Henry', surname: 'Hart' });
  });
});

describe('phone person page roles (#1046)', () => {
  it('hides the app top bar while mounted and opens the app menu from the hero (#1099)', () => {
    const menu = vi.fn();
    document.addEventListener('open-app-menu', menu);
    const { unmount } = render(<MobilePersonPage {...props()} />);
    expect(document.documentElement).toHaveAttribute('data-own-header', 'hero');
    fireEvent.click(screen.getAllByRole('button', { name: 'menu' })[0]);
    expect(menu).toHaveBeenCalledOnce();
    document.removeEventListener('open-app-menu', menu);
    unmount();
    expect(document.documentElement).not.toHaveAttribute('data-own-header');
  });

  it('gives a viewer no edit affordances and drops empty sections', () => {
    render(<MobilePersonPage {...props({ role: 'viewer' })} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Greta Elin Vale' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'edit' })).toBeNull();
    expect(screen.queryByText('write_bio')).toBeNull();
    expect(screen.queryByText('add_name')).toBeNull();
    expect(screen.queryByText('notes')).toBeNull();
  });

  it.each(['editor', 'contributor'] as const)('shows an %s the edit controls, and the pencil edits the birth name and sex', async (role) => {
    client.people.update.mockClear();
    render(<MobilePersonPage {...props({ role })} />);
    expect(screen.getByText('add_name')).toBeInTheDocument();
    expect(screen.getByText('add_note')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'edit' }).find((b) => b.getAttribute('title') === 'edit')!);
    const sheet = screen.getByRole('dialog', { name: 'edit_person' });
    fireEvent.change(within(sheet).getByLabelText('first_name'), { target: { value: 'Greta' } });
    fireEvent.click(within(sheet).getByRole('radio', { name: 'sex_unknown' }));
    fireEvent.click(within(sheet).getByText('sheet-save'));
    await waitFor(() => expect(client.people.update).toHaveBeenCalledWith(1, { FirstName: 'Greta', LastName: 'Vale', Sex: null }, 1));
    // Contributors can't delete (#1054 decision "Roles").
    if (role === 'contributor') expect(within(sheet).queryByText('delete_person')).toBeNull();
  });

  it('deletes the person after one confirm and leaves for the people list', async () => {
    router.push.mockClear();
    render(<MobilePersonPage {...props()} />);
    fireEvent.click(screen.getByRole('button', { name: 'edit_birth_name' }));
    const sheet = screen.getByRole('dialog', { name: 'edit_person' });
    fireEvent.click(within(sheet).getByText('delete_person'));
    fireEvent.click(within(screen.getByRole('alertdialog', { name: 'delete_person_title' })).getByText('delete_person'));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/people'));
    expect(client.people.remove).toHaveBeenCalledWith(1, 1);
    expect(toast.showChangeToast).toHaveBeenCalledWith({ message: 'person_deleted' });
  });

  it('counts each tab and opens the Family tab with links to each relative', () => {
    render(<MobilePersonPage {...props()} />);
    const family = screen.getByRole('tab', { name: /tab_family/ });
    expect(family).toHaveTextContent('5');
    expect(screen.getByRole('tab', { name: /tab_events/ })).toHaveTextContent('3');
    fireEvent.click(family);
    expect(family).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('link', { name: /Olav Vale/ })).toHaveAttribute('href', '/people/view?id=2');
    expect(screen.getByText('descendants')).toBeInTheDocument();
  });

  it('opens each family record from the Family tab and drops an empty Partner section (#1098)', () => {
    const { unmount } = render(<MobilePersonPage {...props()} />);
    fireEvent.click(screen.getByRole('tab', { name: /tab_family/ }));
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/families/view?id=20');
    expect(hrefs).toContain('/families/view?id=21');
    unmount();
    render(<MobilePersonPage {...props({ role: 'viewer', person: person({ spouses: [] }) })} />);
    fireEvent.click(screen.getByRole('tab', { name: /tab_family/ }));
    expect(screen.queryByRole('heading', { name: 'partner' })).toBeNull();
    expect(screen.getByRole('link', { name: /family_of_two/ })).toHaveAttribute('href', '/families/view?id=20');
  });

  it('opens a vitals cell into its read-only panel', () => {
    render(<MobilePersonPage {...props({ role: 'viewer' })} />);
    const born = screen.getByRole('button', { name: /born/ });
    expect(born).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(born);
    expect(born).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('row_place')).toBeInTheDocument();
    expect(screen.getByText('Göteborg, Sweden')).toBeInTheDocument();
  });

  it('reads Status, not Died, for a living person', () => {
    render(<MobilePersonPage {...props({ person: person({ DeathDate: null, DeathPlace: null, IsDeceased: 0, BirthDate: '1972' }) })} />);
    expect(screen.getByRole('button', { name: /status/ })).toHaveTextContent('living');
  });
});

describe('phone vitals and events editing (#1047, #1048)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('offers the common types without a birth or death already recorded, and resolves typed names', () => {
    expect(commonEventTypes(person())).toEqual(['BURI', 'BAPM', 'CENS', 'EMIG', 'IMMI', 'NATU', 'OCCU', 'RESI']);
    expect(commonEventTypes(person({ BirthDate: null, BirthPlace: null }))[0]).toBe('BIRT');
    const label = (type: string) => ({ EMIG: 'Emigration' } as Record<string, string>)[type] ?? type;
    expect(resolveEventType('  emigration ', label)).toEqual({ type: 'EMIG', custom: false });
    expect(resolveEventType('Military  service', label)).toEqual({ type: 'Military service', custom: true });
    expect(resolveEventType('   ', label)).toBeNull();
  });

  it('opens the birth sheet on the tapped field and saves the columns with Undo', async () => {
    const onChanged = vi.fn();
    render(<MobilePersonPage {...props({ onChanged })} />);
    fireEvent.click(screen.getByRole('button', { name: /born/ }));
    fireEvent.click(screen.getByRole('button', { name: /row_place/ }));
    const sheet = screen.getByRole('dialog', { name: 'edit_title' });
    fireEvent.change(within(sheet).getByLabelText('place'), { target: { value: 'Mölndal, Sweden' } });
    await act(async () => { fireEvent.click(within(sheet).getByText('sheet-save')); });
    expect(client.people.update).toHaveBeenCalledWith(1, { BirthDate: '1871', BirthPlace: 'Mölndal, Sweden', BirthPlaceId: null }, 1);
    expect(client.events.create).not.toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalled();
    const { onUndo } = toast.showChangeToast.mock.calls[0][0] as { onUndo?: () => Promise<void> };
    await act(async () => { await onUndo!(); });
    expect(client.audit.revert).toHaveBeenCalledWith([7], 1);
  });

  it('lets a map pin alone be saved', async () => {
    render(<MobilePersonPage {...props()} />);
    fireEvent.click(screen.getByRole('button', { name: /born/ }));
    fireEvent.click(screen.getByRole('button', { name: /row_place/ }));
    const sheet = screen.getByRole('dialog', { name: 'edit_title' });
    expect(within(sheet).getByText('sheet-save')).toBeDisabled();
    fireEvent.click(within(sheet).getByText('set-pin'));
    expect(within(sheet).getByText('sheet-save')).toBeEnabled();
    await act(async () => { fireEvent.click(within(sheet).getByText('sheet-save')); });
    expect(client.places.geocodeUpsertHierarchy).toHaveBeenCalledWith([{ name: 'Göteborg, Sweden', lat: 57.65, lng: 12.01 }], 1);
  });

  it('adds an event of a type chosen under More types, or one of your own', async () => {
    render(<MobilePersonPage {...props()} />);
    fireEvent.click(screen.getByRole('tab', { name: /tab_events/ }));
    fireEvent.click(screen.getByText('add_event', { selector: 'button' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'add_event' })).getByText('more_types'));
    const more = screen.getByRole('dialog', { name: 'all_types' });
    expect(within(more).getByRole('button', { name: /BIRT/ })).toBeDisabled();
    fireEvent.change(within(more).getByRole('searchbox'), { target: { value: 'Land lease' } });
    fireEvent.click(within(more).getByText('add_custom'));
    const sheet = screen.getByRole('dialog', { name: 'add_title' });
    fireEvent.change(within(sheet).getByLabelText('date'), { target: { value: '1902' } });
    await act(async () => { fireEvent.click(within(sheet).getByText('sheet-save')); });
    expect(client.events.create).toHaveBeenCalledWith(
      { Type: 'Land lease', Date: '1902', Place: null, PlaceId: null, Description: null, PersonId: 1, FamilyId: null }, 1,
    );
  });

  it('deletes an event after one confirm, and keeps a death deleted from its sheet deceased', async () => {
    render(<MobilePersonPage {...props()} />);
    fireEvent.click(screen.getByRole('tab', { name: /tab_events/ }));
    fireEvent.click(screen.getAllByRole('button', { name: 'edit_fact' })[2]);
    const sheet = screen.getByRole('dialog', { name: 'edit_title' });
    fireEvent.click(within(sheet).getByText('delete_row'));
    await act(async () => { fireEvent.click(within(screen.getByRole('alertdialog')).getByText('delete_pill')); });
    expect(client.people.update).toHaveBeenCalledWith(1, { DeathDate: null, DeathPlace: null, DeathCause: null, IsDeceased: 1 }, 1);
  });

  it('asks before marking a person with a death living, then clears the death', async () => {
    render(<MobilePersonPage {...props()} />);
    fireEvent.click(screen.getByRole('button', { name: /died/ }));
    fireEvent.click(screen.getByRole('radio', { name: 'living' }));
    expect(client.people.update).not.toHaveBeenCalled();
    const ask = screen.getByRole('alertdialog', { name: 'status_confirm_title' });
    await act(async () => { fireEvent.click(within(ask).getByText('status_confirm_pill_living')); });
    expect(client.people.update).toHaveBeenCalledWith(1, { DeathDate: null, DeathPlace: null, DeathCause: null, IsDeceased: 0 }, 1);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('gives a contributor no Delete row and no Undo', async () => {
    render(<MobilePersonPage {...props({ role: 'contributor', person: person({ DeathDate: null, DeathPlace: null, IsDeceased: null, BirthDate: '1990' }) })} />);
    fireEvent.click(screen.getByRole('button', { name: /status/ }));
    await act(async () => { fireEvent.click(screen.getByRole('radio', { name: 'deceased' })); });
    expect(client.people.update).toHaveBeenCalledWith(1, { IsDeceased: 1 }, 1);
    expect((toast.showChangeToast.mock.calls[0][0] as { onUndo?: unknown }).onUndo).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: /born/ }));
    fireEvent.click(screen.getByText('edit_birth'));
    expect(screen.queryByText('delete_row')).toBeNull();
  });
});

describe('phone portrait, biography, names, notes and journey (#1051, #1052)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  const photo = {
    Id: 50, Title: 'Portrait c. 1890', ContentType: 'image/jpeg', IsPersonPrimary: true, IsOwned: true, IsTaggedHere: false,
    TagRegionX: null, TagRegionY: null, TagRegionW: null, TagRegionH: null, FocalX: 50, FocalY: 40,
  } as never;
  const doc = { ...(photo as object), Id: 51, Title: 'Passenger list', ContentType: 'application/pdf', IsPersonPrimary: false } as never;

  it('opens portrait actions from the photo and removes the portrait with Undo, keeping the photo', async () => {
    render(<MobilePersonPage {...props({ media: [photo, doc] })} />);
    fireEvent.click(screen.getByRole('button', { name: 'portrait_actions' }));
    const sheet = screen.getByRole('dialog', { name: 'portrait' });
    expect(within(sheet).getByText('choose_from_media')).toBeInTheDocument();
    await act(async () => { fireEvent.click(within(sheet).getByText('remove_portrait')); });
    expect(client.media.clearPrimary).toHaveBeenCalledWith(50, 1, 1);
    const { onUndo } = toast.showChangeToast.mock.calls[0][0] as { onUndo?: () => Promise<void> };
    await act(async () => { await onUndo!(); });
    expect(client.audit.revert).toHaveBeenCalledWith([29], 1);
  });

  it('dims documents in Choose a portrait and offers no Remove to a contributor', () => {
    render(<MobilePersonPage {...props({ role: 'contributor', media: [photo, doc] })} />);
    fireEvent.click(screen.getByRole('button', { name: 'portrait_actions' }));
    expect(screen.queryByText('remove_portrait')).toBeNull();
    fireEvent.click(screen.getByText('choose_from_media'));
    const grid = screen.getByRole('dialog', { name: 'choose_portrait' });
    expect(within(grid).getByRole('button', { name: 'document_not_portrait' })).toBeDisabled();
    expect(within(grid).getByRole('button', { name: 'current_portrait' })).toBeEnabled();
  });

  it('shows a viewer the photo full screen instead of portrait actions', () => {
    render(<MobilePersonPage {...props({ role: 'viewer', media: [photo] })} />);
    fireEvent.click(screen.getByRole('button', { name: 'view_photo' }));
    expect(screen.getByRole('dialog', { name: 'lightbox' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'portrait' })).toBeNull();
  });

  it('writes a first biography with Save and makes it the chosen one', async () => {
    render(<MobilePersonPage {...props()} />);
    fireEvent.click(screen.getByText('write_bio'));
    const sheet = screen.getByRole('dialog', { name: 'biography' });
    expect(within(sheet).getByText('sheet-save')).toBeDisabled();
    fireEvent.change(within(sheet).getByLabelText('biography'), { target: { value: 'Kept the boarding house.' } });
    await act(async () => { fireEvent.click(within(sheet).getByText('sheet-save')); });
    expect(client.notes.create).toHaveBeenCalledWith('People', 1, 'Kept the boarding house.', 1);
    expect(client.notes.setPrimary).toHaveBeenCalledWith(41, 'People', 1, true, 1);
    const { onUndo } = toast.showChangeToast.mock.calls[0][0] as { onUndo?: () => Promise<void> };
    await act(async () => { await onUndo!(); });
    expect(client.audit.revert).toHaveBeenCalledWith([25, 27], 1);
  });

  it('edits the chosen biography in place without choosing it again', async () => {
    const bio = { Id: 40, Text: 'Old text', IsPrimary: 1, CreatedAt: '2026-09-12T00:00:00Z' } as never;
    render(<MobilePersonPage {...props({ biography: bio, notes: [bio] })} />);
    fireEvent.click(screen.getByText('edit_bio'));
    const sheet = screen.getByRole('dialog', { name: 'biography' });
    fireEvent.change(within(sheet).getByLabelText('biography'), { target: { value: 'New text' } });
    await act(async () => { fireEvent.click(within(sheet).getByText('sheet-save')); });
    expect(client.notes.update).toHaveBeenCalledWith(40, 'People', 1, 'New text', 1);
    expect(client.notes.setPrimary).not.toHaveBeenCalled();
  });

  it('adds a first nickname as the shown first name, as the desktop does', async () => {
    render(<MobilePersonPage {...props()} />);
    fireEvent.click(screen.getByText('add_name'));
    const sheet = screen.getByRole('dialog', { name: 'add_name' });
    expect(within(sheet).getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    fireEvent.change(within(sheet).getByLabelText('field_name'), { target: { value: 'Greta' } });
    await act(async () => { fireEvent.click(within(sheet).getByText('sheet-save')); });
    expect(client.people.createNameVariant).toHaveBeenCalledWith(1, { Type: 'Nickname', Name: 'Greta', FromDate: null }, 1);
    expect(client.people.setPrimaryNameVariant).not.toHaveBeenCalled();
  });

  it('changes a name\'s type and deletes a name after one confirm', async () => {
    const variant = { Id: 30, PersonId: 1, Type: 'Alias', Name: 'Margaret Halverson', FromDate: '1900', ToDate: null, IsPrimary: 0 };
    render(<MobilePersonPage {...props({ variants: [variant as never] })} />);
    fireEvent.click(screen.getByRole('button', { name: 'edit_name_named' }));
    let sheet = screen.getByRole('dialog', { name: 'edit_name' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Anglicized' }));
    await act(async () => { fireEvent.click(within(sheet).getByText('sheet-save')); });
    expect(client.people.updateNameVariant).toHaveBeenCalledWith(1, 30, 'Margaret Halverson', 1, { FromDate: '1900', ToDate: null, Type: 'Anglicized' });

    fireEvent.click(screen.getByRole('button', { name: 'edit_name_named' }));
    sheet = screen.getByRole('dialog', { name: 'edit_name' });
    fireEvent.click(within(sheet).getByText('delete_name'));
    await act(async () => { fireEvent.click(within(screen.getByRole('alertdialog')).getByText('delete_name')); });
    expect(client.people.removeNameVariant).toHaveBeenCalledWith(1, 30, 1);
  });

  it('cites a name from on top of its sheet, keeping what was typed', () => {
    const variant = { Id: 30, PersonId: 1, Type: 'Alias', Name: 'Margaret Halverson', FromDate: null, ToDate: null, IsPrimary: 0 };
    const fact = { factTable: 'NameVariant', factId: 30, citations: [] };
    const citeSheets = vi.fn((target: unknown) => (target ? <div>cite-open</div> : null));
    render(<MobilePersonPage {...props({ variants: [variant as never], facts: [fact as never], citeSheets })} />);
    fireEvent.click(screen.getByRole('button', { name: 'edit_name_named' }));
    const sheet = screen.getByRole('dialog', { name: 'edit_name' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Anglicized' }));
    fireEvent.click(within(sheet).getByText('cite_source'));
    expect(screen.getByText('cite-open')).toBeInTheDocument();
    expect(citeSheets).toHaveBeenLastCalledWith({ fact, start: 'pick' }, expect.any(Function));
    expect(within(sheet).getByRole('button', { name: 'Anglicized' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('adds a note about the birth, which can\'t be the biography', async () => {
    render(<MobilePersonPage {...props()} />);
    fireEvent.click(screen.getByText('add_note'));
    const sheet = screen.getByRole('dialog', { name: 'new_note' });
    expect(within(sheet).getByRole('switch')).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: 'about_birth' }));
    expect(within(sheet).queryByRole('switch')).toBeNull();
    fireEvent.change(within(sheet).getByLabelText('note'), { target: { value: 'Baptised the same week.' } });
    await act(async () => { fireEvent.click(within(sheet).getByText('sheet-save')); });
    expect(client.notes.create).toHaveBeenCalledWith('People', 1, 'Baptised the same week.', 1, 'Birth');
    expect(client.notes.setPrimary).not.toHaveBeenCalled();
  });

  it('turns a note into the biography only when asked', async () => {
    const note = { Id: 42, Text: 'Sang in Swedish on Sundays.', OwnerFact: null, CreatedAt: '2026-06-21T00:00:00Z' } as never;
    render(<MobilePersonPage {...props({ notes: [note] })} />);
    fireEvent.click(screen.getByText('Sang in Swedish on Sundays.'));
    const sheet = screen.getByRole('dialog', { name: 'note' });
    fireEvent.click(within(sheet).getByRole('switch'));
    await act(async () => { fireEvent.click(within(sheet).getByText('sheet-save')); });
    expect(client.notes.update).not.toHaveBeenCalled();
    expect(client.notes.setPrimary).toHaveBeenCalledWith(42, 'People', 1, true, 1);
  });

  it('folds back-to-back places into journey stops and lists the unmapped ones under the map', () => {
    const p = person({ events: [
      { Id: 10, Type: 'EMIG', Date: '1888', Place: 'Göteborg, Sweden', Description: null } as never,
      { Id: 11, Type: 'IMMI', Date: '1888', Place: 'New York', Description: null } as never,
      { Id: 12, Type: 'CENS', Date: '1900', Place: 'Duluth, Minnesota', Description: null } as never,
    ] });
    const coords = { 'Göteborg, Sweden': { lat: 57.7, lng: 11.97 }, 'Duluth, Minnesota': { lat: 46.79, lng: -92.1 } };
    const stops = journeyOf(p, coords);
    expect(stops.map((s) => [s.place, s.from, s.to, s.types, s.at != null])).toEqual([
      ['Göteborg, Sweden', 1871, 1888, ['BIRT', 'EMIG'], true],
      ['New York', 1888, 1888, ['IMMI'], false],
      ['Duluth, Minnesota', 1900, 1948, ['CENS', 'DEAT'], true],
    ]);
    const pts = miniMapPoints(stops.filter((s) => s.at).map((s) => s.at!));
    expect(pts[0].x).toBeGreaterThan(pts[1].x);
    for (const v of pts.flatMap((pt) => [pt.x, pt.y])) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }

    render(<MobilePersonPage {...props({ person: p, placeCoords: coords })} />);
    fireEvent.click(screen.getByRole('tab', { name: /tab_events/ }));
    fireEvent.click(screen.getByText('journey'));
    const page = screen.getByRole('dialog', { name: 'journey' });
    expect(within(page).getByText('not_on_map')).toBeInTheDocument();
    expect(within(page).getAllByText('New York')).toHaveLength(1);
  });
});

describe('phone tab swipe (#1053)', () => {
  const fire = (el: Element, type: string, x: number, y = 300) => {
    const e = new Event(type, { bubbles: true, cancelable: true });
    const point = { identifier: 1, clientX: x, clientY: y, target: el };
    Object.defineProperty(e, 'touches', { value: type === 'touchend' ? [] : [point] });
    Object.defineProperty(e, 'changedTouches', { value: [point] });
    act(() => { el.dispatchEvent(e); });
  };
  const drag = (el: Element, from: number, to: number, dy = 0) => {
    fire(el, 'touchstart', from);
    for (let i = 1; i <= 4; i++) fire(el, 'touchmove', from + ((to - from) * i) / 4, 300 + (dy * i) / 4);
    fire(el, 'touchend', to, 300 + dy);
    act(() => { vi.advanceTimersByTime(300); });
  };
  const selected = () => screen.getAllByRole('tab').find((tab) => tab.getAttribute('aria-selected') === 'true')?.getAttribute('data-tab');

  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('slides to the next tab and back, and says where it landed', () => {
    const { container } = render(<MobilePersonPage {...props()} />);
    const root = container.querySelector('.mp-root')!;
    Object.defineProperty(root, 'clientWidth', { value: 390 });
    const panel = screen.getByRole('tabpanel');
    drag(panel, 320, 90);
    expect(selected()).toBe('events');
    expect(screen.getByText('tab_shown')).toHaveAttribute('aria-live', 'polite');
    drag(panel, 90, 320);
    expect(selected()).toBe('overview');
    drag(panel, 90, 320);
    expect(selected()).toBe('overview');
  });

  it('opens each tab where it was left once the photo has scrolled away', () => {
    render(<MobilePersonPage {...props()} />);
    // The tabs stick once the page has scrolled 400px; the anchor sits just above them.
    const anchor = screen.getByRole('tablist').previousElementSibling as HTMLElement;
    anchor.getBoundingClientRect = () => ({ top: 400 - window.scrollY } as DOMRect);
    const scrollTo = vi.fn((o: ScrollToOptions) => { window.scrollY = o.top ?? 0; });
    vi.stubGlobal('scrollTo', scrollTo);
    const tabTo = (name: RegExp) => fireEvent.click(screen.getByRole('tab', { name }));
    try {
      window.scrollY = 1000;
      tabTo(/tab_events/);
      expect(scrollTo).toHaveBeenLastCalledWith({ top: 400 });
      window.scrollY = 650;
      tabTo(/tab_overview/);
      expect(scrollTo).toHaveBeenLastCalledWith({ top: 1000 });
      tabTo(/tab_events/);
      expect(scrollTo).toHaveBeenLastCalledWith({ top: 650 });
      // With the photo in view, the page stays put.
      scrollTo.mockClear();
      window.scrollY = 100;
      tabTo(/tab_family/);
      expect(scrollTo).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      window.scrollY = 0;
    }
  });

  it('leaves the left edge, short drags, vertical drags and the tab strip alone', () => {
    const { container } = render(<MobilePersonPage {...props()} />);
    const root = container.querySelector('.mp-root')!;
    Object.defineProperty(root, 'clientWidth', { value: 390 });
    const panel = screen.getByRole('tabpanel');
    drag(panel, 10, 300);
    drag(panel, 320, 290);
    drag(panel, 320, 280, 200);
    drag(screen.getByRole('tablist'), 320, 90);
    expect(selected()).toBe('overview');
  });
});
