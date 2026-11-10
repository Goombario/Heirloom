/** @vitest-environment happy-dom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

import ConfirmDialog from '@/app/components/ConfirmDialog';

describe('ConfirmDialog', () => {
  it('renders title and body and fires onConfirm (calm)', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        variant="calm"
        tone="danger"
        title="Delete person"
        body="Remove Ada Lovelace?"
        confirmLabel="Yes, Delete"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByText('Delete person')).toBeInTheDocument();
    expect(screen.getByText('Remove Ada Lovelace?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, Delete' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when closed', () => {
    const { container } = render(
      <ConfirmDialog open={false} variant="calm" title="x" body="y"
        confirmLabel="ok" onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('gates the confirm button until the phrase matches (type-to-confirm)', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        variant="type-to-confirm"
        tone="danger"
        title="Erase all data"
        body="This cannot be undone."
        bullets={['All people', 'All families']}
        confirmPhrase="DELETE ALL DATA"
        confirmLabel="Erase everything"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    const confirmBtn = screen.getByRole('button', { name: 'Erase everything' });
    expect(confirmBtn).toBeDisabled();
    expect(screen.getByText('All people')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'wrong' } });
    expect(confirmBtn).toBeDisabled();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'DELETE ALL DATA' } });
    expect(confirmBtn).toBeEnabled();
    fireEvent.click(confirmBtn);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('disables actions while busy', () => {
    render(
      <ConfirmDialog open variant="calm" title="t" body="b" busy
        confirmLabel="Confirm" onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'cancel' })).toBeDisabled();
  });

  it('fires onCancel when cancel is clicked (calm)', () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog open variant="calm" title="t" body="b"
        confirmLabel="ok" onConfirm={vi.fn()} onCancel={onCancel} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('calm variant renders no close/X button', () => {
    render(
      <ConfirmDialog open variant="calm" tone="danger" title="Delete person"
        body="Remove Ada?" confirmLabel="Delete" onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    // 'close' is the i18n key returned by the mocked useTranslations
    expect(screen.queryByRole('button', { name: 'close' })).not.toBeInTheDocument();
  });

  it('type-to-confirm renders a warning callout role', () => {
    render(
      <ConfirmDialog open variant="type-to-confirm" tone="danger" title="Erase"
        body="Cannot be undone." confirmPhrase="ERASE" confirmLabel="Erase"
        onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('calm variant renders an amber warning callout when warning is set', () => {
    render(
      <ConfirmDialog
        open
        variant="calm"
        tone="danger"
        title="Delete this photo?"
        body="Photo will be removed."
        warning="This is a profile picture."
        confirmLabel="Delete"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const callout = screen.getByRole('alert');
    expect(callout).toHaveTextContent('This is a profile picture.');
  });

  it('calm variant has no alert callout when warning is absent', () => {
    render(
      <ConfirmDialog open variant="calm" tone="danger" title="t" body="b"
        confirmLabel="Delete" onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
