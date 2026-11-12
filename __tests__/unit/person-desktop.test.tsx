/** @vitest-environment happy-dom */

import { fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import type { Family, LinkedChild, Person, PersonWithRelations } from '@/lib/db/schema';
import { FamilyRail } from '@/app/people/view/desktop/FamilyRail';
import { PersonCover } from '@/app/people/view/desktop/PersonCover';
import { EditPersonDialog } from '@/app/people/view/desktop/EditPersonDialog';

const update = vi.fn(async () => ({ auditIds: [7] }));
const removeChild = vi.fn(async () => ({ auditId: 9 }));
vi.mock('@/lib/data', () => ({
  getDataClient: async () => ({ people: { update }, families: { removeChild } }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/people/view' }));
vi.mock('@/app/components/GuardedLink', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock('@/app/components/ProfileImage', () => ({ default: () => <img alt="" /> }));
vi.mock('@/app/components/PersonAvatar', () => ({ default: () => <span /> }));
vi.mock('@/app/components/LanguageProvider', () => ({ useLanguage: () => ({ language: 'en' }) }));
vi.mock('@/app/people/view/desktop/AddFamilyPanel', () => ({ AddFamilyPanel: () => <div>add panel</div> }));

const person = (Id: number, FirstName: string, Sex: string, extra: Partial<Person> = {}): Person =>
  ({ Id, FirstName, LastName: 'Lind', Sex, BirthDate: null, DeathDate: null, ...extra } as unknown as Person);
const family = (Id: number, Partner1Id: number | null, Partner2Id: number | null, extra: Partial<Family> = {}): Family =>
  ({ Id, Partner1Id, Partner2Id, MarriageDate: null, MarriagePlace: null, UserId: 1, UpdatedAt: null, ...extra } as Family);
const child = (p: Person, l1: string | null, l2: string | null): LinkedChild => ({ ...p, Partner1Relationship: l1, Partner2Relationship: l2 });

const johan = person(1, 'Johan', 'M');
const kristina = person(2, 'Kristina', 'F');
const carl = person(3, 'Carl', 'M');
const erik = person(11, 'Erik', 'M', { BirthDate: '1866' });
const nils = person(13, 'Nils', 'M');
const anna = {
  ...person(10, 'Anna', 'F', { BirthDate: '3 MAR 1868', BirthPlace: 'Österbybruk', DeathDate: '1931', IsDeceased: 1 }),
  events: [],
  parents: [{
    family: family(100, 1, 2), father: johan, mother: kristina, partner1Relationship: 'Birth', partner2Relationship: 'Birth',
    siblings: [child(erik, 'Step', 'Birth')],
  }],
  spouses: [
    { family: family(200, 10, 3, { Type: 'Marriage', MarriageDate: '1890' }), person: carl, children: [child(nils, 'Adoption', 'Birth')] },
    { family: family(201, 10, null), person: null, children: [] },
  ],
} as unknown as PersonWithRelations;

const wrap = (ui: ReactNode) => render(<NextIntlClientProvider locale="en" messages={en}>{ui}</NextIntlClientProvider>);

describe('desktop person rail (#49)', () => {
  const rail = (canDelete: boolean) => wrap(
    <FamilyRail person={anna} treeId={1} canEdit canDelete={canDelete} journeyCount={3} onShowJourney={() => {}} onChanged={() => {}} run={vi.fn()} />,
  );

  it('opens with Open in tree, then parents with siblings inside, then each partnership', () => {
    rail(true);
    expect(screen.getByRole('link', { name: /Open in tree/ })).toHaveAttribute('href', '/tree?rootId=10');
    const parents = screen.getByRole('region', { name: 'Parents' });
    expect(parents).toHaveAttribute('id', 'parents');
    expect(within(parents).getByRole('link', { name: /Johan & Kristina’s family/ })).toHaveAttribute('href', '/families/view?id=100');
    expect(within(parents).getByRole('link', { name: /Johan Lind/ })).toHaveTextContent('Father');
    expect(within(parents).getByRole('link', { name: /Erik Lind/ })).toHaveTextContent('half-sibling');
    expect(screen.getByRole('region', { name: 'Partner 1 of 2' })).toHaveTextContent('Husband');
    expect(within(screen.getByRole('region', { name: 'Partner 1 of 2' })).getByRole('link', { name: /Nils Lind/ })).toHaveTextContent('adopted');
    expect(screen.getByRole('region', { name: 'Partner 2 of 2' })).toHaveTextContent('Partner unknown');
    expect(screen.getByRole('button', { name: /See the journey/ })).toBeInTheDocument();
  });

  it('gives editors the unlinks, and an unlink acts at once', async () => {
    rail(true);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Nils Lind from this family' }));
    await vi.waitFor(() => expect(removeChild).toHaveBeenCalledWith(200, 13, 1));
  });

  it('gives contributors no unlinks', () => {
    rail(false);
    expect(screen.queryByRole('button', { name: /^Remove / })).toBeNull();
    expect(screen.getByRole('button', { name: 'Add family' })).toBeInTheDocument();
  });
});

describe('desktop person cover (#49)', () => {
  const cover = (role: 'viewer' | 'contributor' | 'editor') => wrap(
    <PersonCover person={anna} media={[]} treeId={1} role={role} datesToCheck={2} biography={null} run={vi.fn()}
      onEdit={() => {}} onDescendants={() => {}} hasDescendants onDelete={() => {}} onAddPortrait={() => {}} onOpenPortrait={() => {}} />,
  );

  it('names the person and shows the dates-to-check pill', () => {
    cover('editor');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Anna Lind');
    expect(screen.getByText('2 dates to check')).toBeInTheDocument();
  });

  it('puts Edit person, Descendants and Delete person in the ⋯ menu for editors', () => {
    cover('editor');
    fireEvent.click(screen.getByRole('button', { name: /More actions for Anna Lind/ }));
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Edit person', 'Descendants', 'Delete person']);
  });

  it('gives a viewer only Descendants and no biography prompt', () => {
    cover('viewer');
    fireEvent.click(screen.getByRole('button', { name: /More actions for Anna Lind/ }));
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Descendants']);
    expect(screen.queryByRole('button', { name: 'Add a biography' })).toBeNull();
  });
});

describe('desktop Edit person (#49)', () => {
  const dialog = (onEditVital = vi.fn(), run = vi.fn(async (w: () => Promise<unknown>) => { await w(); return true; })) => {
    wrap(<EditPersonDialog open onClose={() => {}} person={anna} treeId={1} language="en" run={run} onEditVital={onEditVital} />);
    return { onEditVital, run };
  };

  it('shows birth and death read-only, with Edit in timeline', () => {
    const { onEditVital } = dialog();
    expect(screen.queryByRole('textbox', { name: /Birth date/i })).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: /Edit in timeline/ })[1]);
    expect(onEditVital).toHaveBeenCalledWith('death');
  });

  it('needs a first or a last name', () => {
    dialog();
    fireEvent.change(screen.getByRole('textbox', { name: 'First name' }), { target: { value: '' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Last name' }), { target: { value: '' } });
    expect(screen.getByText('Enter a first or a last name.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('asks before marking a person with a death living, and deletes the death only when told to', async () => {
    const { run } = dialog();
    fireEvent.click(screen.getByRole('radio', { name: 'Living' }));
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete death and mark living' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(run).toHaveBeenCalled());
    expect(update).toHaveBeenCalledWith(10, expect.objectContaining({ IsDeceased: 0, DeathDate: null }), 1);
  });
});
