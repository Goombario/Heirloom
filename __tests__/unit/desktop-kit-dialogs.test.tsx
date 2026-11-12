/** @vitest-environment happy-dom */

import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { NextIntlClientProvider } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { FormDialog } from '@/app/components/ui/FormDialog';
import { FieldColumn, RecordBlock, WarningLine } from '@/app/components/ui/FormParts';
import { ListToolbar, TablePanel } from '@/app/components/ui/ListRecipe';

let allowDiscard = true;
vi.mock('@/app/components/UnsavedChangesProvider', () => ({
  useUnsavedChangesGuard: () => ({ guardNavigation: () => allowDiscard }),
}));

const wrap = (ui: ReactNode) => render(<NextIntlClientProvider locale="en" messages={en}>{ui}</NextIntlClientProvider>);

describe('FormDialog (#55)', () => {
  function Harness({ dirty, onClose }: { dirty: boolean; onClose: () => void }) {
    return (
      <FormDialog open onClose={onClose} title="Add a person" dirty={dirty}
        footer={(close) => <><button type="button" onClick={close}>Cancel</button><button type="button">Save and open</button></>}>
        <input aria-label="First name" />
      </FormDialog>
    );
  }

  it('is a named dialog that focuses its first field', () => {
    wrap(<Harness dirty={false} onClose={() => {}} />);
    expect(screen.getByRole('dialog', { name: 'Add a person' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'First name' })).toHaveFocus();
  });

  it('closes from ×, Cancel and Escape when clean', () => {
    const onClose = vi.fn();
    wrap(<Harness dirty={false} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('keeps unsaved changes when the person says no', () => {
    const onClose = vi.fn();
    allowDiscard = false;
    wrap(<Harness dirty onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    allowDiscard = true;
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('Form parts (#55)', () => {
  it('greys and disables an inactive column, with its reason in place of the action', () => {
    wrap(<FieldColumn title="Died" inactive inactiveReason="Living people have no death." action={<button type="button">Cite</button>}><input aria-label="Death date" /></FieldColumn>);
    expect(screen.getByRole('group', { name: /Died/ })).toBeDisabled();
    expect(screen.getByText('Living people have no death.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cite' })).toBeNull();
  });

  it('puts the remove × right after the name, and only with a label', () => {
    const onRemove = vi.fn();
    const { rerender } = wrap(<RecordBlock identity={<span>Johan Lindqvist</span>} onRemove={onRemove} removeLabel="Remove Johan Lindqvist" />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Johan Lindqvist' }));
    expect(onRemove).toHaveBeenCalled();
    rerender(<NextIntlClientProvider locale="en" messages={en}><RecordBlock identity={<span>Johan</span>} /></NextIntlClientProvider>);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('announces a warning line politely', () => {
    wrap(<WarningLine>These two already have a family.</WarningLine>);
    expect(screen.getByRole('status')).toHaveTextContent('These two already have a family.');
  });
});

describe('List recipe (#55)', () => {
  function Toolbar() {
    const [q, setQ] = useState('');
    return <><ListToolbar search={q} onSearchChange={setQ} searchLabel="Search people" action={<button type="button">Add person</button>} /><input aria-label="Other field" /><div role="dialog" aria-label="Over the list"><button type="button">In dialog</button></div></>;
  }

  it('focuses the search on /, but not while typing elsewhere or in a dialog', () => {
    wrap(<Toolbar />);
    const search = screen.getByRole('searchbox', { name: 'Search people' });
    expect(search).toHaveAttribute('aria-keyshortcuts', '/');
    fireEvent.keyDown(document.body, { key: '/' });
    expect(search).toHaveFocus();
    const other = screen.getByRole('textbox', { name: 'Other field' });
    other.focus();
    fireEvent.keyDown(other, { key: '/' });
    expect(other).toHaveFocus();
    const inDialog = screen.getByRole('button', { name: 'In dialog' });
    inDialog.focus();
    fireEvent.keyDown(inDialog, { key: '/' });
    expect(inDialog).toHaveFocus();
  });

  it('pages with a range line and hides the pager on one page', () => {
    const onPage = vi.fn();
    const { rerender } = wrap(<TablePanel page={2} pageSize={25} total={60} onPage={onPage}><table /></TablePanel>);
    expect(screen.getByText('26–50 of 60')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onPage).toHaveBeenCalledWith(3);
    rerender(<NextIntlClientProvider locale="en" messages={en}><TablePanel page={1} pageSize={25} total={10} onPage={onPage}><table /></TablePanel></NextIntlClientProvider>);
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
  });
});
