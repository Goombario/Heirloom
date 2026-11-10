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
const router = vi.hoisted(() => ({ back: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/app/components/GuardedLink', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock('@/app/components/nav/appEvents', () => ({ openAppMenu: vi.fn(), openGlobalSearch: vi.fn() }));
vi.mock('@/app/components/date-input/aliases', () => ({ useDateQualifierWords: () => ({}) }));
vi.mock('@/app/components/ProfileImage', () => ({ default: () => null }));
vi.mock('@/app/components/PersonAvatar', () => ({ default: () => <span /> }));
vi.mock('@/app/components/media/MediaGallery', () => ({ default: () => <div data-testid="gallery" /> }));
vi.mock('@/app/components/UploadModal', () => ({ default: () => null }));
vi.mock('@/app/components/media/MediaPickerModal', () => ({ default: () => null }));
vi.mock('@/app/components/media/OwnerMediaCard', () => ({ OwnerMediaCard: () => null }));
vi.mock('@/app/components/media/EventMediaDraftPanel', () => ({ default: () => null }));
vi.mock('@/app/components/media/useEventMediaDraft', () => ({ useEventMediaDraft: () => ({ items: [], failures: [], process: vi.fn() }) }));
vi.mock('@/app/components/useCachedResource', () => ({ useCachedResource: () => ({ data: { people: [] } }) }));
vi.mock('@/app/components/FamilySearch', () => ({
  FamilySearch: ({ onPick }: { onPick: (f: { Id: number; husbandName: string; wifeName: string }) => void }) =>
    <button type="button" onClick={() => onPick({ Id: 77, husbandName: 'Per Berg', wifeName: 'Lena Berg' })}>pick-family</button>,
}));
vi.mock('@/app/components/PersonPickerSheet', () => ({
  PersonPickerSheet: ({ open, title, onPick }: { open: boolean; title: string; onPick: (p: unknown[]) => void }) =>
    open ? (
      <div role="dialog" aria-label={title}>
        <button type="button" onClick={() => onPick([{ kind: 'existing', person: { Id: 50, FirstName: 'Nils', LastName: 'Dahl', Sex: 'M', BirthDate: null, DeathDate: null } }])}>pick-nils</button>
      </div>
    ) : null,
}));
vi.mock('@/app/components/ui/Sheet', () => ({
  Sheet: ({ open, title, children, onSave, onBack, dirty, saveWhenClean, saveDisabled }: {
    open: boolean; title: string; children: React.ReactNode; onSave?: () => void; onBack?: () => void; dirty?: boolean; saveWhenClean?: boolean; saveDisabled?: boolean;
  }) =>
    open ? (
      <div role="dialog" aria-label={title}>
        {onBack && <button type="button" onClick={onBack}>sheet-back</button>}
        {onSave && <button type="button" onClick={onSave} disabled={saveDisabled || !(dirty || saveWhenClean)}>sheet-save</button>}
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
  default: ({ id, value, onChange }: { id?: string; value: string; onChange: (v: string) => void }) =>
    <input id={id} aria-label="place" value={value} onChange={(e) => onChange(e.target.value)} />,
}));

const client = vi.hoisted(() => ({
  families: {
    update: vi.fn(async () => ({ Id: 30, auditIds: [1] })),
    remove: vi.fn(async () => ({ auditId: 2 })),
    create: vi.fn(async () => ({ Id: 31, auditIds: [3] })),
    addChild: vi.fn(async () => ({ auditIds: [4] })),
    updateChildType: vi.fn(async () => ({ auditIds: [5] })),
    removeChild: vi.fn(async () => ({ auditId: 6 })),
    moveChild: vi.fn(async () => ({ auditId: 7 })),
  },
  events: { create: vi.fn(async () => ({ Id: 99, auditIds: [8] })), update: vi.fn(async () => ({ Id: 10, auditIds: [9] })), remove: vi.fn(async () => ({ auditIds: [11] })) },
  notes: {
    listForOwner: vi.fn(async () => []),
    create: vi.fn(async () => ({ Id: 41, auditIds: [12] })),
    update: vi.fn(async () => ({ Id: 40, auditIds: [13] })),
    remove: vi.fn(async () => ({ auditIds: [14] })),
  },
  media: { listGalleryForOwner: vi.fn(async () => []), unlinkFromOwner: vi.fn(async () => undefined) },
  places: { geocodeUpsert: vi.fn(), geocodeUpsertHierarchy: vi.fn() },
  audit: { revert: vi.fn(async () => ({ success: true, revertedCount: 1 })) },
}));
vi.mock('@/lib/data', async (orig) => ({ ...(await orig<typeof import('@/lib/data')>()), getDataClient: async () => client }));
const toast = vi.hoisted(() => ({ showChangeToast: vi.fn(), showErrorToast: vi.fn() }));
vi.mock('@/app/components/ui/Toast', () => ({ ...toast, showSuccessToast: vi.fn(), showInfoToast: vi.fn(), AppToaster: () => null }));

import type { GedcomEvent } from '@/lib/db/schema';
import type { PartnerPerson } from '@/app/families/view/useFamilyDetail';
import type { DataCheckMarks } from '@/app/components/data-checks/marks';
import { MobileFamilyPage, type MobileFamilyPageProps } from '@/app/families/view/mobile/MobileFamilyPage';
import { coupleName, endingOf, suggestChildren, timelineRows, togetherOf, unionRange, type PhoneFamily } from '@/app/families/view/mobile/model';

const p = (Id: number, FirstName: string, LastName: string, Sex: string, BirthDate: string | null = null, DeathDate: string | null = null): PartnerPerson =>
  ({ Id, FirstName, LastName, Sex, BirthDate, DeathDate, BirthPlace: null, DeathPlace: null, IsDeceased: DeathDate ? 1 : null, PrimaryMediaId: null } as unknown as PartnerPerson);

const anders = p(1, 'Anders', 'Halvorsen', 'M', '1866', '1939');
const greta = p(2, 'Greta', 'Halvorsen', 'F', '1871', '1948');
const ingrid = p(3, 'Ingrid', 'Halvorsen', 'F', '1894');

function fam(over: Partial<PhoneFamily> = {}, family: Partial<PhoneFamily['family']> = {}): PhoneFamily {
  return {
    family: { Id: 30, Partner1Id: 1, Partner2Id: 2, MarriageDate: '1893', MarriagePlace: 'Göteborg, Sweden', Type: 'Marriage', ...family },
    partner1: anders, partner2: greta, children: [ingrid], events: [],
    ...over,
  };
}

const noMarks: DataCheckMarks = { open: [], byFact: new Map(), text: { sentence: () => '', ruleName: () => '' } as never };

function props(over: Partial<MobileFamilyPageProps> = {}): MobileFamilyPageProps {
  return {
    data: fam(), others: [], facts: [], sourceNumbers: new Map(), marks: noMarks, treeId: 1, role: 'editor', language: 'en',
    active: false, citePins: () => null, citeSheets: () => null, onCite: vi.fn(), onChanged: vi.fn(),
    ...over,
  };
}

const divorce = { Id: 10, Type: 'DIV', Date: '1920', Place: 'Duluth', Description: null } as unknown as GedcomEvent;

describe('phone family page model (#1062)', () => {
  it('names the couple once by a shared surname, each in full otherwise, and one alone', () => {
    expect(coupleName(anders, greta)).toBe('Anders & Greta Halvorsen');
    expect(coupleName(p(4, 'Thomas', 'Marsh', 'M'), p(5, 'Ellen', 'Pryce', 'F'))).toBe('Thomas Marsh & Ellen Pryce');
    expect(coupleName(null, greta)).toBe('Greta Halvorsen');
    expect(coupleName(null, null)).toBe('');
  });

  it('ends with a recorded divorce before a death, and with the first death otherwise', () => {
    expect(endingOf(fam({ events: [divorce] }))).toMatchObject({ kind: 'event', reason: 'Divorce' });
    expect(endingOf(fam())).toMatchObject({ kind: 'death', partner: { Id: 1 }, date: '1939' });
    // One partner alone: nothing ended.
    expect(endingOf(fam({ partner2: null }))).toBeNull();
    // A death before the start is a bad date, not an end.
    expect(endingOf(fam({}, { MarriageDate: '1945' }))).toBeNull();
    expect(unionRange(fam())).toBe('1893–1939');
    expect(unionRange(fam({}, { MarriageDate: null }))).toBe('?–1939');
  });

  it('counts the years together and each partner’s age at the start', () => {
    expect(togetherOf(fam())).toEqual({ years: 46, approx: false, ages: [27, 22] });
    expect(togetherOf(fam({}, { MarriageDate: 'ABT 1893' })).approx).toBe(true);
  });

  it('orders the timeline by year, children’s births included, with the worked-out end last', () => {
    expect(timelineRows(fam()).map((r) => r.key)).toEqual(['start', 'birth-3', 'derived-end']);
    expect(timelineRows(fam({ events: [divorce] })).map((r) => r.key)).toEqual(['start', 'birth-3', 'event-10']);
  });

  it('shows a child’s adoption event as a child row that cites the event (#485)', () => {
    const adoption = { Id: 40, Type: 'ADOP', Date: '1899', Place: 'Duluth', PersonId: 3 } as unknown as GedcomEvent;
    const stray = { Id: 41, Type: 'ADOP', Date: '1899', Place: null, PersonId: 99 } as unknown as GedcomEvent;
    const rows = timelineRows(fam({ childAdoptions: [adoption, stray] }));
    expect(rows.map((r) => r.key)).toEqual(['start', 'birth-3', 'adop-40', 'derived-end']);
    expect(rows[2]).toMatchObject({ kind: 'child-adoption', person: { Id: 3 }, fact: { factTable: 'Events', factId: 40 } });
  });

  it('suggests parentless people with a partner’s surname born while they could have children', () => {
    const pool = [
      { Id: 7, LastName: 'Halvorsen', BirthDate: '1897', FatherName: null, MotherName: null },
      { Id: 8, LastName: 'Halvorsen', BirthDate: '1950', FatherName: null, MotherName: null },
      { Id: 9, LastName: 'Halvorsen', BirthDate: '1899', FatherName: 'Per', MotherName: null },
      { Id: 3, LastName: 'Halvorsen', BirthDate: '1894', FatherName: null, MotherName: null },
      { Id: 10, LastName: 'Berg', BirthDate: '1897', FatherName: null, MotherName: null },
    ];
    expect(suggestChildren(fam(), pool).map((x) => x.Id)).toEqual([7]);
  });
});

describe('phone family page (#1062)', () => {
  it('hides the app top bar while mounted (#1099)', () => {
    const { unmount } = render(<MobileFamilyPage {...props()} />);
    expect(document.documentElement).toHaveAttribute('data-own-header', 'hero');
    unmount();
    expect(document.documentElement).not.toHaveAttribute('data-own-header');
  });

  beforeEach(() => { vi.clearAllMocks(); });

  it('shows the couple in the hero and gives a viewer no edit affordances', () => {
    render(<MobileFamilyPage {...props({ role: 'viewer' })} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Anders & Greta Halvorsen' })).toBeInTheDocument();
    expect(screen.getByText('kind_marriage · 1893–1939')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'open_person' })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'edit_family' })).toBeNull();
    expect(screen.queryByText('add_child')).toBeNull();
    expect(screen.queryByText('add_note')).toBeNull();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['tab_overview', 'tab_timeline3', 'tab_media', 'tab_sources']);
  });

  it('shows the hatched Add partner half when a partner is unknown and adds one with the chosen type', async () => {
    render(<MobileFamilyPage {...props({ data: fam({ partner2: null }, { Partner2Id: null, Type: null }) })} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'add_partner' })[0]);
    fireEvent.click(within(screen.getByRole('dialog', { name: 'add_partner' })).getByText('pick-nils'));
    const confirm = screen.getByRole('dialog', { name: 'add_partner' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'ftype_common_law' }));
    await act(async () => { fireEvent.click(within(confirm).getByText('sheet-save')); });
    expect(client.families.update).toHaveBeenCalledWith(30, { Partner2Id: 50, Type: 'Common-law' }, 1);
    expect(toast.showChangeToast).toHaveBeenCalledWith(expect.objectContaining({ message: 'partner_added' }));
  });

  it('removes a partner from the menu, keeping the family, with Undo', async () => {
    render(<MobileFamilyPage {...props()} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'edit_family' })[0]);
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Anders & Greta Halvorsen' })).getByText('change_partners'));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'change_partners' })).getByText('Greta Halvorsen'));
    fireEvent.click(screen.getByText('remove_partner'));
    await act(async () => { fireEvent.click(within(screen.getByRole('alertdialog', { name: 'remove_partner_title' })).getByText('remove_pill')); });
    expect(client.families.update).toHaveBeenCalledWith(30, { Partner2Id: null }, 1);
    const { onUndo } = toast.showChangeToast.mock.calls[0][0] as { onUndo?: () => Promise<void> };
    await act(async () => { await onUndo!(); });
    expect(client.audit.revert).toHaveBeenCalledWith([1], 1);
  });

  it('offers Delete family instead of removing the last person left', async () => {
    render(<MobileFamilyPage {...props({ data: fam({ partner2: null, children: [] }, { Partner2Id: null }) })} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'edit_family' })[0]);
    fireEvent.click(screen.getByText('change_partners'));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'change_partners' })).getByText('Anders Halvorsen'));
    expect(screen.getByText('remove_partner_last')).toBeInTheDocument();
    fireEvent.click(screen.getByText('remove_partner'));
    await act(async () => { fireEvent.click(within(screen.getByRole('alertdialog', { name: 'delete_family_title' })).getByText('delete_family_pill')); });
    expect(client.families.update).not.toHaveBeenCalled();
    expect(client.families.remove).toHaveBeenCalledWith(30, 1);
    // Back where they came from; a page opened on its own goes to the families list.
    expect(router.back.mock.calls.length + router.push.mock.calls.filter((c) => c[0] === '/families').length).toBe(1);
  });

  it('deletes the family, goes back, and Undo brings it back here', async () => {
    render(<MobileFamilyPage {...props()} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'edit_family' })[0]);
    fireEvent.click(screen.getByText('delete_family'));
    await act(async () => { fireEvent.click(within(screen.getByRole('alertdialog')).getByText('delete_family_pill')); });
    expect(client.families.remove).toHaveBeenCalledWith(30, 1);
    // Back where they came from; a page opened on its own goes to the families list.
    expect(router.back.mock.calls.length + router.push.mock.calls.filter((c) => c[0] === '/families').length).toBe(1);
    const call = toast.showChangeToast.mock.calls[0][0] as { message: string; onUndo?: () => Promise<void> };
    expect(call.message).toBe('family_deleted');
    await act(async () => { await call.onUndo!(); });
    expect(client.audit.revert).toHaveBeenCalledWith([2], 1);
    expect(router.push).toHaveBeenCalledWith('/families/view?id=30');
  });

  it('sets a child’s relationship to each partner, and moves them to a family found by search', async () => {
    render(<MobileFamilyPage {...props()} />);
    fireEvent.click(screen.getByText('edit_children'));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'edit_children' })).getByText('Ingrid Halvorsen'));
    const sheet = screen.getByRole('dialog', { name: 'Ingrid Halvorsen' });
    const groups = within(sheet).getAllByRole('group', { name: 'relationship_to' });
    expect(groups).toHaveLength(2);
    fireEvent.click(within(groups[0]).getByRole('button', { name: 'link_Step' }));
    await act(async () => { fireEvent.click(within(sheet).getByText('sheet-save')); });
    expect(client.families.updateChildType).toHaveBeenCalledWith(30, 3, { partner1: 'Step', partner2: 'Birth' }, 1);

    fireEvent.click(screen.getByText('edit_children'));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'edit_children' })).getByText('Ingrid Halvorsen'));
    fireEvent.click(screen.getByText('move_child'));
    const move = screen.getByRole('dialog', { name: 'move_title' });
    fireEvent.click(within(move).getByText('move_search'));
    fireEvent.click(within(move).getByText('pick-family'));
    await act(async () => { fireEvent.click(within(move).getByText('sheet-save')); });
    expect(client.families.moveChild).toHaveBeenCalledWith(30, 3, 77, 1);
  });

  it('gives a contributor no remove, move or delete, and no Undo', async () => {
    render(<MobileFamilyPage {...props({ role: 'contributor' })} />);
    fireEvent.click(screen.getByText('edit_children'));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'edit_children' })).getByText('Ingrid Halvorsen'));
    expect(screen.queryByText('move_child')).toBeNull();
    expect(screen.queryByText('remove_child')).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'edit_family' })[0]);
    expect(screen.queryByText('delete_family')).toBeNull();
  });

  it('records a divorce from the Ended panel', async () => {
    render(<MobileFamilyPage {...props()} />);
    fireEvent.click(screen.getByRole('button', { name: /ended/ }));
    fireEvent.click(screen.getByText('record_end'));
    const sheet = screen.getByRole('dialog', { name: 'how_it_ended' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'reason_Divorce' }));
    fireEvent.change(within(sheet).getByLabelText('date'), { target: { value: '1920' } });
    await act(async () => { fireEvent.click(within(sheet).getByText('sheet-save')); });
    await waitFor(() => expect(client.events.create).toHaveBeenCalledWith({ Type: 'DIV', Date: '1920', Place: null, PlaceId: null, FamilyId: 30 }, 1));
  });
});
