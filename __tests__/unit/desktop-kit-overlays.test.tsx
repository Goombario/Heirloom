/** @vitest-environment happy-dom */

import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { NextIntlClientProvider } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import type { PersonResult } from '@/lib/db/schema';
import type { ChildRelationships } from '@/lib/child-relationship';
import { InlinePanel } from '@/app/components/ui/InlinePanel';
import { ParentRelationshipSelects } from '@/app/components/ui/ParentRelationshipSelects';
import { PersonFinder } from '@/app/components/ui/PersonFinder';

const revert = vi.fn(async () => ({ success: true as const, revertedCount: 2 }));
const toast = vi.fn();
vi.mock('@/lib/data', () => ({ getDataClient: async () => ({ audit: { revert } }) }));
vi.mock('@/app/components/ui/Toast', () => ({
  showSuccessToast: (...args: unknown[]) => toast(...args),
  showErrorToast: vi.fn(),
}));
vi.mock('@/app/components/ProfileImage', () => ({ default: () => <img alt="" /> }));
vi.mock('@/app/components/UnsavedChangesProvider', () => ({
  useUnsavedChangesGuard: () => ({ guardNavigation: () => true }),
}));

const wrap = (ui: ReactNode) => render(<NextIntlClientProvider locale="en" messages={en}>{ui}</NextIntlClientProvider>);

const people: PersonResult[] = [
  { Id: 1, FirstName: 'Maja', LastName: 'Berg', Sex: 'F', BirthDate: '1893', DeathDate: null },
  { Id: 2, FirstName: 'Nils', LastName: 'Berg', Sex: 'M', BirthDate: '1895', DeathDate: null },
  { Id: 3, FirstName: 'Greta', LastName: 'Holm', Sex: 'F', BirthDate: null, DeathDate: null },
];
const search = async (q: string) => people.filter((p) => `${p.FirstName} ${p.LastName}`.toLowerCase().includes(q.toLowerCase()));
const trigger = (label: string) => function Trigger(tp: { ref: React.RefObject<HTMLButtonElement | null>; onClick: () => void }) {
  return <button type="button" {...tp}>{label}</button>;
};

describe('PersonFinder (#55)', () => {
  it('opens as a dialog, focuses the search and shows suggestions with reasons', () => {
    wrap(<PersonFinder title="Find a partner" treeId={null} search={search} onPick={() => {}}
      suggestions={[{ person: people[2], reason: 'Godparent' }]} trigger={trigger('Find a partner')} />);
    const open = screen.getByRole('button', { name: 'Find a partner' });
    expect(open).toHaveAttribute('aria-haspopup', 'dialog');
    fireEvent.click(open);
    expect(open).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('dialog', { name: 'Find a partner' })).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveFocus();
    expect(screen.getByRole('option', { name: /Greta Holm.*Godparent/ })).toBeInTheDocument();
  });

  it('lists Create first, searches, skips excluded people and picks with Enter', async () => {
    const onPick = vi.fn();
    const onCreate = vi.fn();
    wrap(<PersonFinder title="Find a partner" treeId={null} search={search} excludeIds={[1]} onPick={onPick} onCreate={onCreate}
      trigger={trigger('Find a partner')} />);
    fireEvent.click(screen.getByRole('button', { name: 'Find a partner' }));
    const box = screen.getByRole('combobox');
    fireEvent.change(box, { target: { value: 'berg' } });
    await waitFor(() => expect(screen.getByRole('option', { name: /Nils Berg/ })).toBeInTheDocument());
    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveTextContent('Create “berg” as a new person');
    expect(screen.queryByRole('option', { name: /Maja Berg/ })).toBeNull();
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(box).toHaveAttribute('aria-activedescendant', options[1].id);
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith(people[1]);
    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Find a partner' })).toHaveFocus();
  });

  it('says when no one matches', async () => {
    wrap(<PersonFinder title="Find" treeId={null} search={search} onPick={() => {}} trigger={trigger('Find')} />);
    fireEvent.click(screen.getByRole('button', { name: 'Find' }));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'zz' } });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('No one in this tree matches “zz”'));
  });

  it('closes on Escape without letting it reach an outer dialog, and returns focus', () => {
    const outer = vi.fn();
    wrap(<div onKeyDown={outer}><PersonFinder title="Find" treeId={null} search={search} onPick={() => {}} trigger={trigger('Find')} /></div>);
    fireEvent.click(screen.getByRole('button', { name: 'Find' }));
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(outer).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Find' })).toHaveFocus();
  });

  it('ticks several people and adds them together', () => {
    const onPickMany = vi.fn();
    wrap(<PersonFinder multiple title="Add children" treeId={null} search={search} onPickMany={onPickMany}
      suggestions={people.slice(0, 2).map((person) => ({ person }))} trigger={trigger('Add children')} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add children' }));
    const add = screen.getByRole('button', { name: 'Add 0 people' });
    expect(add).toBeDisabled();
    fireEvent.click(screen.getByRole('option', { name: /Maja Berg/ }));
    fireEvent.click(screen.getByRole('option', { name: /Nils Berg/ }));
    expect(screen.getByRole('option', { name: /Maja Berg/ })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Add 2 people' }));
    expect(onPickMany).toHaveBeenCalledWith([people[0], people[1]]);
  });
});

describe('InlinePanel (#55)', () => {
  it('focuses its first field, names itself and cancels on Escape when clean', () => {
    const onCancel = vi.fn();
    wrap(<InlinePanel label="Edit Birth" saving={false} onSave={() => {}} onCancel={onCancel}><input aria-label="Place" /></InlinePanel>);
    expect(screen.getByRole('group', { name: 'Edit Birth' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Place' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Place' }), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });

  it('shows Delete only when given one', () => {
    const { rerender } = wrap(<InlinePanel label="Edit" saving={false} onSave={() => {}} onCancel={() => {}}><input aria-label="x" /></InlinePanel>);
    expect(screen.queryByRole('button', { name: 'Delete event' })).toBeNull();
    rerender(<NextIntlClientProvider locale="en" messages={en}>
      <InlinePanel label="Edit" saving={false} onSave={() => {}} onCancel={() => {}} onDelete={() => {}} deleteLabel="Delete event"><input aria-label="x" /></InlinePanel>
    </NextIntlClientProvider>);
    expect(screen.getByRole('button', { name: 'Delete event' })).toBeInTheDocument();
  });
});

describe('ParentRelationshipSelects (#55, ADR 0027)', () => {
  function Harness({ two, spy }: { two: boolean; spy: (v: ChildRelationships) => void }) {
    const [v, setV] = useState<ChildRelationships>({ partner1: 'Birth', partner2: 'Birth' });
    return <ParentRelationshipSelects value={v} onChange={(n) => { setV(n); spy(n); }} partner1Name="Johan" partner2Name={two ? 'Kristina' : null} />;
  }

  it('gives each partner a select', () => {
    wrap(<Harness two spy={() => {}} />);
    expect(screen.getByText('Relationship to Johan')).toBeInTheDocument();
    expect(screen.getByText('Relationship to Kristina')).toBeInTheDocument();
  });

  it('with one partner, has one select', () => {
    wrap(<Harness two={false} spy={() => {}} />);
    expect(screen.getByText('Relationship to Johan')).toBeInTheDocument();
    expect(screen.queryByText(/Kristina/)).toBeNull();
  });
});

describe('useUndoRemoval (#55)', () => {
  it('reverts every audit entry of one action with one Undo', async () => {
    const { useUndoRemoval } = await import('@/app/hooks/useUndoRemoval');
    const intl = ({ children }: { children: ReactNode }) => <NextIntlClientProvider locale="en" messages={en}>{children}</NextIntlClientProvider>;
    const { result } = renderHook(() => useUndoRemoval(7), { wrapper: intl });
    const onUndone = vi.fn();
    result.current([{ auditId: 11 }, { auditId: null }, { auditId: 12 }], 'Removed', onUndone);
    const [, action] = toast.mock.calls.at(-1) as [string, { onClick: () => void }];
    await act(async () => { action.onClick(); await Promise.resolve(); await Promise.resolve(); });
    await waitFor(() => expect(onUndone).toHaveBeenCalled());
    expect(revert).toHaveBeenCalledWith([11, 12], 7);
  });

  it('offers no Undo without an audit entry', async () => {
    const { useUndoRemoval } = await import('@/app/hooks/useUndoRemoval');
    const intl = ({ children }: { children: ReactNode }) => <NextIntlClientProvider locale="en" messages={en}>{children}</NextIntlClientProvider>;
    const { result } = renderHook(() => useUndoRemoval(null), { wrapper: intl });
    result.current({ auditId: null }, 'Removed', () => {});
    expect(toast.mock.calls.at(-1)).toEqual(['Removed']);
  });
});
