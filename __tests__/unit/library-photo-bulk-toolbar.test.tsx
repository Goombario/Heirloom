/** @vitest-environment happy-dom */

import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: { count?: number; title?: string }) => ({
    select: 'Select',
    done: 'Done',
    selected_count: `${values?.count ?? 0} selected`,
    select_all_results: `Select all ${values?.count ?? 0} results`,
    clear_selection: 'Clear selection',
    delete_selected: `Delete ${values?.count ?? 0} selected`,
    delete_selected_title: 'Delete selected photos?',
    delete_selected_body: `This will permanently delete ${values?.count ?? 0} photos.`,
    delete_selected_confirm: 'Delete photos',
    deleting_selected: 'Deleting…',
    delete_selected_short: `Delete ${values?.count ?? 0}`,
    selection_mode_label: 'Selection mode',
    delete_failed_item: `Could not delete ${values?.title ?? 'photo'}.`,
    retry_failed: 'Retry failed',
    cleanup_warning: `Deleted successfully, but ${values?.count ?? 0} files could not be cleaned up.`,
  }[key] ?? key),
}));
import LibraryPhotoBulkToolbar from '@/app/library/sections/LibraryPhotoBulkToolbar';

const baseProps = {
  canDelete: true,
  selectionMode: false,
  selectedCount: 0,
  visibleCount: 4,
  allVisibleSelected: false,
  busy: false,
  failures: [],
  cleanupWarningCount: 0,
  onEnter: vi.fn(),
  onDone: vi.fn(),
  onSelectAll: vi.fn(),
  onClear: vi.fn(),
  onDelete: vi.fn(),
  onRetry: vi.fn(),
};

describe('LibraryPhotoBulkToolbar', () => {
  it('gates Select on delete permission and enters temporary select mode', () => {
    const onEnter = vi.fn();
    const { rerender } = render(<LibraryPhotoBulkToolbar {...baseProps} canDelete={false} onEnter={onEnter} />);
    expect(screen.queryByRole('button', { name: 'Select' })).not.toBeInTheDocument();
    rerender(<LibraryPhotoBulkToolbar {...baseProps} onEnter={onEnter} />);
    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    expect(onEnter).toHaveBeenCalledOnce();
  });

  it('offers complete visible-result selection, clear, done, and guarded delete', () => {
    const callbacks = { onDone: vi.fn(), onSelectAll: vi.fn(), onClear: vi.fn(), onDelete: vi.fn() };
    render(<LibraryPhotoBulkToolbar {...baseProps} selectionMode selectedCount={2} {...callbacks} />);
    const dockWrap = screen.getByTestId('photo-selection-dock-wrap');
    const dock = screen.getByTestId('photo-selection-dock');
    expect(dockWrap).toHaveClass('pointer-events-none', 'fixed', 'inset-x-0', 'bottom-0', 'pb-[calc(env(safe-area-inset-bottom)+var(--space-3))]', 'md:left-[220px]', 'md:right-0');
    expect(dock).toHaveClass('pointer-events-auto', 'rounded-panel', 'backdrop-blur-md');
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    expect(screen.getByText('Selection mode')).toBeInTheDocument();
    expect(screen.getByText('Delete 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete 2 selected' }).parentElement).toHaveClass('border-l');
    fireEvent.click(screen.getByRole('button', { name: 'Select all 4 results' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(callbacks.onSelectAll).toHaveBeenCalledOnce();
    expect(callbacks.onClear).toHaveBeenCalledOnce();
    expect(callbacks.onDone).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Delete 2 selected' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('This will permanently delete 2 photos.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete photos' }));
    expect(callbacks.onDelete).toHaveBeenCalledOnce();
  });

  it('shows only one Clear control when all visible results are selected', () => {
    render(<LibraryPhotoBulkToolbar {...baseProps} selectionMode selectedCount={4} allVisibleSelected />);
    expect(screen.getAllByRole('button', { name: 'Clear selection' })).toHaveLength(1);
  });

  it('keeps the browse Select trigger in the normal action flow', () => {
    render(<LibraryPhotoBulkToolbar {...baseProps} />);
    const select = screen.getByRole('button', { name: 'Select' });
    expect(select.parentElement).not.toHaveClass('fixed');
    expect(screen.queryByTestId('photo-selection-dock-wrap')).not.toBeInTheDocument();
  });

  it('disables delete without selection or while busy', () => {
    const { rerender } = render(<LibraryPhotoBulkToolbar {...baseProps} selectionMode />);
    expect(screen.getByRole('button', { name: 'Delete 0 selected' })).toBeDisabled();
    rerender(<LibraryPhotoBulkToolbar {...baseProps} selectionMode selectedCount={1} busy />);
    expect(screen.getByRole('button', { name: 'Deleting…' })).toBeDisabled();
  });

  it('disables Done, Clear, and Retry while a deletion is busy', () => {
    const callbacks = { onDone: vi.fn(), onClear: vi.fn(), onRetry: vi.fn() };
    const { rerender } = render(<LibraryPhotoBulkToolbar
      {...baseProps}
      selectionMode
      selectedCount={2}
      busy
      {...callbacks}
    />);
    expect(screen.getByRole('button', { name: 'Done' })).toBeDisabled();
    expect(screen.getAllByRole('button', { name: 'Clear selection' }).every(button => (button as HTMLButtonElement).disabled)).toBe(true);

    rerender(<LibraryPhotoBulkToolbar {...baseProps} selectionMode selectedCount={4} allVisibleSelected busy />);
    expect(screen.getByRole('button', { name: 'Clear selection' })).toBeDisabled();
  });

  it('restores focus to the replacement Select control after successful confirmation', () => {
    function Harness() {
      const [selectionMode, setSelectionMode] = useState(true);
      const [busy, setBusy] = useState(false);
      return <LibraryPhotoBulkToolbar
        {...baseProps}
        selectionMode
        selectedCount={1}
        busy={busy}
        onDelete={() => {
          setBusy(true);
          setSelectionMode(false);
          setBusy(false);
        }}
        {...(selectionMode ? {} : { selectionMode: false })}
      />;
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete 1 selected' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete photos' }));
    expect(screen.getByRole('button', { name: 'Select' })).toHaveFocus();
  });

});
