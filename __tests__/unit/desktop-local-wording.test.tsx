/** @vitest-environment happy-dom */
// #61: the desktop app has no browser, and its storage is not a website's, so
// the local-data copy says "this computer"/"this app" there and the storage
// persistence rows are hidden.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/app/hooks/useTimestamp', () => ({ useTimestamp: () => ({ timestamp: () => 'the-date' }) }));
vi.mock('@/lib/db/connection.pglite', () => ({
  dumpDatabaseLogical: vi.fn(),
  inspectBackupLogical: vi.fn(),
  getDatabaseTotals: vi.fn(),
  loadDatabase: vi.fn(),
}));

import FileBackupSection from '@/app/components/backup/FileBackupSection';

const w = window as unknown as Record<string, unknown>;
afterEach(() => { delete w.__TAURI_INTERNALS__; });

describe('local data wording in the desktop app (#61)', () => {
  it('a browser gets the browser copy and the storage persistence status', () => {
    render(<FileBackupSection />);
    expect(screen.getByText('restore_desc')).toBeInTheDocument();
    expect(screen.getByText(/^storage_/)).toBeInTheDocument();
  });

  it('the desktop app gets the desktop copy and no storage persistence row', () => {
    w.__TAURI_INTERNALS__ = {};
    render(<FileBackupSection />);
    expect(screen.getByText('restore_desc_desktop')).toBeInTheDocument();
    expect(screen.queryByText(/^storage_/)).toBeNull();
  });

  it('every desktop variant exists in all three locales', async () => {
    const locales = await Promise.all(['en', 'fr', 'ru'].map((l) => import(`@/messages/${l}.json`)));
    const keys: [string, string][] = [
      ['options', 'restore_column_current'], ['options', 'local_data_desc'], ['options', 'restore_desc'],
      ['options', 'restore_confirm_body'], ['options', 'backup_status_warn'], ['options', 'nudge_message'],
      ['importExport', 'import_browser_note'], ['mobileBackup', 'body_overdue'],
      ['mobileBackup', 'restore_sub'], ['mobileBackup', 'nudge_body'],
    ];
    for (const m of locales) {
      for (const [ns, key] of keys) {
        const text = (m.default as Record<string, Record<string, string>>)[ns][`${key}_desktop`];
        expect(text, `${ns}.${key}_desktop`).toBeTruthy();
        expect(text).not.toMatch(/browser|navigateur|браузер/i);
      }
    }
  });
});
