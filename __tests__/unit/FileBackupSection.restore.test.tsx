/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

// next-intl → return the key verbatim.
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/app/hooks/useTimestamp', () => ({ useTimestamp: () => ({ timestamp: () => 'the-date' }) }));

// Mock the PGlite wiring so no WASM DB boots; restore just needs to resolve.
const DATADIR = new Blob(['datadir']);
vi.mock('@/lib/db/connection.pglite', () => ({
  dumpDatabaseLogical: vi.fn(() => Promise.resolve(new Blob(['gz']))),
  inspectBackupLogical: vi.fn(() => Promise.resolve({ datadir: DATADIR, totals: { trees: 2, people: 4824, families: 964, media: 5 } })),
  getDatabaseTotals: vi.fn(() => Promise.resolve({ trees: 1, people: 120, families: 25, media: 0 })),
  loadDatabase: vi.fn(() => Promise.resolve()),
}));

import * as connection from '@/lib/db/connection.pglite';
import FileBackupSection from '@/app/components/backup/FileBackupSection';

const reloadSpy = vi.fn();

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.stubGlobal('alert', vi.fn());
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, reload: reloadSpy },
  });
});

afterEach(() => vi.unstubAllGlobals());

/**
 * Regression guard for the §7 fix: a successful file restore must record a
 * backup marker (from the restored file's date). Markers live in localStorage,
 * not the DB dump, so without this a restore into a fresh browser shows "no
 * backup yet" and fires the stale-backup nudge even though data was just
 * restored. Mirrors the DriveBackupSection restore-marker test.
 */
describe('FileBackupSection — restore records a backup marker', () => {
  it('writes FILE_BACKUP_KEY as the restored file\'s lastModified on success', async () => {
    const { container } = render(<FileBackupSection />);

    const lastModified = Date.parse('2026-06-15T00:00:00.000Z');
    const file = new File(['snapshot'], 'heirloom-backup.tar.gz', { lastModified });

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    // Destructive confirm dialog → confirm
    fireEvent.click(await screen.findByRole('button', { name: 'restore_confirm' }));

    // The datadir rebuilt for the confirmation is the one restored; no second rebuild.
    await waitFor(() => expect(connection.loadDatabase).toHaveBeenCalledWith(DATADIR));
    expect(connection.inspectBackupLogical).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(localStorage.getItem('heirloom_last_backup')).toBe('2026-06-15T00:00:00.000Z'),
    );
  });

  it('does NOT record a marker when restore fails', async () => {
    vi.mocked(connection.loadDatabase).mockRejectedValueOnce(new Error('corrupt'));
    const { container } = render(<FileBackupSection />);

    const file = new File(['bad'], 'bad.tar.gz', { lastModified: Date.now() });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(await screen.findByRole('button', { name: 'restore_confirm' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('restore_failed'));
    expect(localStorage.getItem('heirloom_last_backup')).toBeNull();
  });
});

describe('FileBackupSection — restore confirmation compares counts (BK-1)', () => {
  it('shows the backup\'s date and counts beside this browser\'s', async () => {
    const { container } = render(<FileBackupSection />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['snapshot'], 'b.hlbak')] } });

    await screen.findByRole('button', { name: 'restore_confirm' });
    expect(screen.getByRole('columnheader', { name: 'restore_column_current' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'restore_column_backup' })).toBeInTheDocument();
    const people = screen.getByRole('rowheader', { name: 'restore_count_people' }).closest('tr')!;
    expect(people).toHaveTextContent((120).toLocaleString());
    expect(people).toHaveTextContent((4824).toLocaleString());
  });

  it('rejects an unreadable file before asking, and replaces nothing', async () => {
    vi.mocked(connection.inspectBackupLogical).mockRejectedValueOnce(new Error('bad magic'));
    const { container } = render(<FileBackupSection />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['junk'], 'junk.hlbak')] } });

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('restore_failed'));
    expect(screen.queryByRole('button', { name: 'restore_confirm' })).toBeNull();
    expect(connection.loadDatabase).not.toHaveBeenCalled();
  });
});

// #879 item 5: "last backup" is recorded once the file is saved, not on click.
describe('FileBackupSection — backup records a marker only once saved', () => {
  afterEach(() => {
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });

  it('records nothing when the save picker is cancelled', async () => {
    const picker = vi.fn(() => Promise.reject(new DOMException('cancelled', 'AbortError')));
    (window as { showSaveFilePicker?: unknown }).showSaveFilePicker = picker;
    render(<FileBackupSection />);
    fireEvent.click(screen.getByRole('button', { name: 'backup_button' }));

    await waitFor(() => expect(picker).toHaveBeenCalled());
    expect(connection.dumpDatabaseLogical).not.toHaveBeenCalled();
    expect(localStorage.getItem('heirloom_last_backup')).toBeNull();
  });

  it('records the backup after the file is written', async () => {
    const close = vi.fn(() => Promise.resolve());
    const write = vi.fn(() => Promise.resolve());
    (window as { showSaveFilePicker?: unknown }).showSaveFilePicker =
      vi.fn(() => Promise.resolve({ createWritable: () => Promise.resolve({ write, close }) }));
    render(<FileBackupSection />);
    fireEvent.click(screen.getByRole('button', { name: 'backup_button' }));

    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(write).toHaveBeenCalledWith(expect.any(Blob));
    await waitFor(() => expect(localStorage.length).toBe(1));
  });

  it('shows an error and records nothing when the backup fails', async () => {
    vi.mocked(connection.dumpDatabaseLogical).mockRejectedValueOnce(new Error('photo deleted'));
    render(<FileBackupSection />);
    fireEvent.click(screen.getByRole('button', { name: 'backup_button' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('backup_failed');
    expect(localStorage.length).toBe(0);
  });
});

describe('FileBackupSection — restore says what it does (#941)', () => {
  it('puts the restore button under its own heading and replace-everything text', () => {
    render(<FileBackupSection />);
    const heading = screen.getByRole('heading', { name: 'restore_title' });
    const block = heading.parentElement as HTMLElement;
    expect(block).toHaveTextContent('restore_desc');
    expect(block).toContainElement(screen.getByRole('button', { name: 'restore_button' }));
    // Download stays outside it, as the section's main action.
    expect(block).not.toContainElement(screen.getByRole('button', { name: 'backup_button' }));
  });
});
