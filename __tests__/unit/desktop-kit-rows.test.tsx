/** @vitest-environment happy-dom */

import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { EmptySlot, SuggestionRow } from '@/app/components/ui/AddRow';
import { FamilyRecordRow } from '@/app/components/ui/FamilyRecordRow';
import { PersonIdentity } from '@/app/components/ui/PersonIdentity';
import { PersonRow } from '@/app/components/ui/PersonRow';
import { Timeline } from '@/app/components/Timeline';

vi.mock('@/app/components/GuardedLink', () => ({
  default: ({ href, onNavigate: _n, children, ...rest }: { href: string; onNavigate?: () => void; children: ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock('@/app/components/ProfileImage', () => ({ default: () => <img alt="" /> }));

const wrap = (ui: ReactNode) => render(<NextIntlClientProvider locale="en" messages={en}>{ui}</NextIntlClientProvider>);

describe('PersonRow (#55)', () => {
  it('links to the person, shows the role tag, and keeps actions outside the link', () => {
    const unlink = vi.fn();
    wrap(<PersonRow href="/people/view?id=12" name="Maja Berg" role="foster child" nameStyle="serif"
      edit={{ label: 'Edit Maja Berg', onClick: () => {} }} unlink={{ label: 'Remove Maja Berg from this family', onClick: unlink }} />);
    const link = screen.getByRole('link', { name: /Maja Berg/ });
    expect(link).toHaveAttribute('href', '/people/view?id=12');
    expect(link).toHaveTextContent('foster child');
    const remove = screen.getByRole('button', { name: 'Remove Maja Berg from this family' });
    expect(link.contains(remove)).toBe(false);
    fireEvent.click(remove);
    expect(unlink).toHaveBeenCalled();
  });

  it('has no actions for a viewer', () => {
    wrap(<PersonRow href="/people/view?id=12" name="Maja Berg" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('FamilyRecordRow (#55)', () => {
  const stack = [{ Id: 1, FirstName: 'Johan', LastName: 'L', Sex: 'M' }, { Id: 2, FirstName: 'Kristina', LastName: 'H', Sex: 'F' }];

  it('keeps the phone row a plain link with ↗', () => {
    const { container } = wrap(<FamilyRecordRow href="/families/view?id=1" title="Johan & Kristina’s family" sub="Marriage" stack={stack} treeId={null} />);
    const link = screen.getByRole('link', { name: /Johan & Kristina/ });
    expect(link.querySelector('svg')).not.toBeNull();
    expect(container.querySelector('.family-record-row')).toBeNull();
  });

  it('drops ↗ and adds an unlink beside the link on desktop', () => {
    wrap(<FamilyRecordRow density="desktop" arrow={false} href="/families/view?id=1" title="with Kristina" stack={stack} treeId={null}
      unlink={{ label: 'Remove Anna from this family', onClick: () => {} }} />);
    const link = screen.getByRole('link', { name: /with Kristina/ });
    expect(link.querySelector('svg')).toBeNull();
    expect(link.contains(screen.getByRole('button', { name: 'Remove Anna from this family' }))).toBe(false);
  });

  it('wraps a long family name instead of cutting it off, with the unlink shown (#48)', () => {
    const long = 'Maximiliana Charlotta & Karl-Johan Östergren-Lindqvist’s family';
    const sub = 'Marriage · 1902 · 11 children';
    const { container } = wrap(<FamilyRecordRow density="desktop" arrow={false} href="/families/view?id=1" title={long} sub={sub} stack={stack} treeId={null}
      unlink={{ label: 'Remove Anna from this family', onClick: () => {} }} />);
    const link = screen.getByRole('link', { name: new RegExp(long) });
    const title = screen.getByText(long);
    expect(title.className).toContain('break-words');
    for (const el of [title, screen.getByText(sub)]) {
      expect(el.className).not.toMatch(/truncate|line-clamp|text-ellipsis|whitespace-nowrap/);
    }
    // The stack and the unlink keep their size and centre on the wrapped text.
    expect(link.querySelector('[aria-hidden="true"].shrink-0')).not.toBeNull();
    expect(container.querySelector('.family-record-row')!.className).toContain('items-center');
    expect(screen.getByRole('button', { name: 'Remove Anna from this family' })).toBeInTheDocument();
  });
});

describe('SuggestionRow and EmptySlot (#55)', () => {
  it('acts in one click and reads its reason', () => {
    const pick = vi.fn();
    wrap(<SuggestionRow onClick={pick} reason="Same last name" identity={<PersonIdentity as="span" name="Nils Berg" />} />);
    const btn = screen.getByRole('button', { name: /Nils Berg.*Same last name/ });
    fireEvent.click(btn);
    expect(pick).toHaveBeenCalled();
  });

  it('names the empty slot by its title and hint', () => {
    wrap(<EmptySlot title="Partner unknown" hint="Find or add someone" onClick={() => {}} />);
    expect(screen.getByRole('button', { name: /Partner unknown.*Find or add someone/ })).toBeInTheDocument();
  });
});

describe('Timeline read-only relative row (#55)', () => {
  it('links the title and drops row actions', () => {
    wrap(<Timeline items={[{ key: 'b', icon: null, title: 'Birth of Anna', href: '/people/view?id=1', actions: <button type="button">Edit</button> }]} />);
    expect(screen.getByRole('link', { name: 'Birth of Anna' })).toHaveAttribute('href', '/people/view?id=1');
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });
});
