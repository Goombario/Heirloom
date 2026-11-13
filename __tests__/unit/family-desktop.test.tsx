/** @vitest-environment happy-dom */

import React, { type ReactNode } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import type { PartnerFamilies, PartnerPerson } from '@/app/families/view/useFamilyDetail';

const removeChild = vi.fn(async () => ({ auditId: 9 }));
vi.mock('@/lib/data', () => ({ getDataClient: async () => ({ families: { removeChild }, people: { search: async () => [], list: async () => ({ people: [] }) } }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/families/view' }));
vi.mock('next/dynamic', () => ({ default: () => () => <div data-testid="map" /> }));
vi.mock('@/app/components/GuardedLink', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock('@/app/components/ProfileImage', () => ({ default: () => <img alt="" /> }));
vi.mock('@/app/components/PersonAvatar', () => ({ default: () => <span /> }));
vi.mock('@/app/components/LanguageProvider', () => ({ useLanguage: () => ({ language: 'en' }) }));
vi.mock('@/app/contexts/TreeContext', () => ({ useTree: () => ({ activeTreeId: 1 }) }));

import { FamilyCover } from '@/app/families/view/desktop/FamilyCover';
import { FamilyRail } from '@/app/families/view/desktop/FamilyRail';

const person = (Id: number, FirstName: string, LastName: string, Sex: string, BirthDate: string | null, extra: Partial<PartnerPerson> = {}) =>
  ({ Id, FirstName, LastName, Sex, BirthDate, DeathDate: null, ...extra }) as unknown as PartnerPerson;
const johan = person(1, 'Johan', 'Lindqvist', 'M', '1861', { DeathDate: '1932' });
const kristina = person(2, 'Kristina', 'Lindqvist', 'F', '1866');
const nils = person(3, 'Nils', 'Holm', 'M', '1860');
const hilda = person(4, 'Hilda', 'Ek', 'F', '1893', { Partner1Relationship: 'Foster', Partner2Relationship: 'Foster' } as Partial<PartnerPerson>);
const writes = () => ({
  setPartner: vi.fn(async () => true), removePartner: vi.fn(async () => true), addChildren: vi.fn(async () => true),
  setType: vi.fn(async () => true), deleteFamily: vi.fn(async () => true),
});
const wrap = (ui: ReactNode) => render(<NextIntlClientProvider locale="en" messages={en}>{ui}</NextIntlClientProvider>);

describe('desktop family cover (#119)', () => {
  const cover = (role: 'viewer' | 'contributor' | 'editor', partner2: PartnerPerson | null = kristina, w = writes()) => wrap(
    <FamilyCover familyId={100} type="Marriage" partner1={johan} partner2={partner2} began="1888" ended="1932" place="Uppsala Cathedral, Uppsala, Sweden"
      about={null} treeId={1} role={role} run={vi.fn()} writes={w} onEditFamily={vi.fn()} />,
  );

  it('names a couple who share a surname once, with the years, the place and the type', () => {
    cover('editor');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Johan & Kristina Lindqvist');
    expect(screen.getByText('Marriage')).toBeInTheDocument();
    expect(screen.getByText('1888 – 1932')).toBeInTheDocument();
    expect(screen.getByText(/Uppsala Cathedral, Sweden/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'About this family' })).toBeInTheDocument();
  });

  it('opens each partner from their half of the split portrait', () => {
    cover('editor');
    expect(screen.getByRole('link', { name: 'Open Johan Lindqvist' })).toHaveAttribute('href', '/people/view?id=1');
    expect(screen.getByRole('link', { name: 'Open Kristina Lindqvist' })).toHaveAttribute('href', '/people/view?id=2');
  });

  it('gives an editor Edit family and Delete family, and an unknown partner an Add partner half', () => {
    cover('editor', null);
    fireEvent.click(screen.getByRole('button', { name: /More actions for/ }));
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Edit family', 'Delete family']);
    expect(screen.getByRole('button', { name: /Add partner/ })).toBeInTheDocument();
  });

  it('deletes the family from the ⋯ menu at once (the toast offers Undo)', () => {
    const w = writes();
    cover('editor', kristina, w);
    fireEvent.click(screen.getByRole('button', { name: /More actions for/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete family' }));
    expect(w.deleteFamily).toHaveBeenCalledTimes(1);
  });

  it('adds a partner from the hatched half: create someone new', async () => {
    const w = writes();
    cover('editor', null, w);
    fireEvent.click(screen.getByRole('button', { name: /Add partner/ }));
    fireEvent.change(screen.getByPlaceholderText(en.detailKit.finder_placeholder), { target: { value: 'Greta Berg' } });
    fireEvent.click(await screen.findByText('Create “Greta Berg” as a new person'));
    expect(w.setPartner).toHaveBeenCalledWith('partner2', { kind: 'new', draft: { firstName: 'Greta', lastName: 'Berg', sex: null, birthDate: null } });
  });

  it('gives a viewer no ⋯ menu, no About prompt and no Add partner', () => {
    cover('viewer', null);
    expect(screen.queryByRole('button', { name: /More actions for/ })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'About this family' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Add partner/ })).toBeNull();
    expect(screen.getByText('Partner unknown')).toBeInTheDocument();
  });
});

describe('desktop family rail (#119)', () => {
  const p1: PartnerFamilies = { person: kristina, spouses: [
    { person: johan, family: { Id: 100, MarriageDate: '1888' }, children: [] },
    { person: nils, family: { Id: 101, MarriageDate: '1935', Type: 'Marriage' }, children: [] },
  ] } as unknown as PartnerFamilies;
  const rail = (canDelete: boolean, w = writes(), partner2: PartnerPerson | null = kristina, kids: PartnerPerson[] = [hilda]) => wrap(
    <FamilyRail family={{ Id: 100, MarriageDate: '24 SEP 1888' }} partner1={johan} partner2={partner2} partner1Families={null} partner2Families={p1}
      childList={kids} places={[{ place: 'Uppsala' }, { place: 'Lund' }, { place: 'Uppsala' }]} placeCoords={{}}
      treeId={1} canEdit canDelete={canDelete} onChanged={vi.fn()} writes={w} />,
  );

  it('opens the tree on the first partner, then the partners with their ages at the marriage', () => {
    rail(true);
    expect(screen.getByRole('link', { name: /Open in tree/ })).toHaveAttribute('href', '/tree?rootId=1');
    const partners = screen.getByRole('region', { name: 'Partners' });
    expect(within(partners).getByRole('link', { name: /Johan Lindqvist/ })).toHaveTextContent('27 at marriage');
    expect(within(partners).getByRole('link', { name: /Kristina Lindqvist/ })).toHaveTextContent('22 at marriage');
  });

  it('nests a partner\'s other partnerships under them, named "with" the other partner', () => {
    rail(true);
    const partners = screen.getByRole('region', { name: 'Partners' });
    const other = within(partners).getByRole('link', { name: /with Nils Holm/ });
    expect(other).toHaveAttribute('href', '/families/view?id=101');
    expect(other).toHaveTextContent('Marriage · 1935 · no children');
  });

  it('lists the children with their role, and unlinks one at once', async () => {
    rail(true);
    const children = screen.getByRole('region', { name: /Children/ });
    expect(within(children).getByRole('link', { name: /Hilda Ek/ })).toHaveTextContent('Foster');
    fireEvent.click(within(children).getByRole('button', { name: 'Remove Hilda Ek' }));
    await vi.waitFor(() => expect(removeChild).toHaveBeenCalledWith(100, 4, 1));
  });

  it('counts each place they lived once', () => {
    rail(false);
    expect(screen.getByRole('region', { name: 'Where they lived' })).toHaveTextContent('2 places');
  });

  it('removes a partner at once, and deletes the family instead when nobody else is in it', () => {
    const w = writes();
    rail(true, w);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Kristina Lindqvist' }));
    expect(w.removePartner).toHaveBeenCalledWith('partner2');

    const lone = writes();
    const { unmount } = rail(true, lone, null, []);
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete family' })[0]);
    expect(lone.deleteFamily).toHaveBeenCalledTimes(1);
    expect(lone.removePartner).not.toHaveBeenCalled();
    unmount();
  });

  it('offers "Partner unknown · Find or add someone" in an empty partner slot', () => {
    rail(true, writes(), null);
    const partners = screen.getByRole('region', { name: 'Partners' });
    expect(within(partners).getByRole('button', { name: /Partner unknown/ })).toHaveTextContent('Find or add someone');
  });

  it('adds a child: pick or create, then say how they are related to each partner', async () => {
    const w = writes();
    rail(true, w);
    fireEvent.click(screen.getByRole('button', { name: 'Add child' }));
    fireEvent.change(screen.getByPlaceholderText(en.detailKit.finder_placeholder), { target: { value: 'Erik' } });
    fireEvent.click(await screen.findByText('Create “Erik” as a new person'));
    // The new child takes the family's surname, and Birth to each partner until changed.
    expect(screen.getByRole('group', { name: 'Add child' })).toHaveTextContent('Erik Lindqvist');
    fireEvent.click(screen.getByRole('button', { name: 'Add 1 child' }));
    await vi.waitFor(() => expect(w.addChildren).toHaveBeenCalledWith(
      [{ kind: 'new', draft: { firstName: 'Erik', lastName: 'Lindqvist', sex: null, birthDate: null } }],
      { partner1: 'Birth', partner2: 'Birth' },
    ));
  });
});
