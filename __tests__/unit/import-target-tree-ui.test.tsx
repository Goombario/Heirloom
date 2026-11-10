/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

const state = vi.hoisted(() => ({
  previewGedcom: vi.fn(),
  importGedcom: vi.fn(),
  getCounts: vi.fn(),
  suggestions: vi.fn(),
  treeId: 9 as number | null,
}));

// Echo each key with its values, so a test can see which tree and counts a
// string was given. Functions (rich-text tags) drop out of the JSON.
function echo(key: string, values?: Record<string, unknown>) {
  return values ? `${key} ${JSON.stringify(values)}` : key;
}
vi.mock('next-intl', () => ({
  useTranslations: () => Object.assign(echo, { rich: echo }),
}));
vi.mock('@/app/contexts/TreeContext', () => ({ useTree: () => ({ activeTreeId: state.treeId }) }));
vi.mock('@/lib/data', () => ({
  DATA_MODE: 'local',
  getDataClient: vi.fn(async () => ({
    gedcom: state,
    tree: state,
    dashboard: { suggestions: state.suggestions },
  })),
}));
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/app/hooks/useActiveTreeName', () => ({ useActiveTreeName: () => 'Test tree' }));
vi.mock('@/app/import-export/MediaImportRecovery', () => ({ default: () => <div /> }));

import ImportExportPage from '@/app/import-export/page';

const EMPTY = { people: 0, families: 0, events: 0, media: 0, cases: 0, places: 0, sources: 0, repositories: 0, notes: 0, citations: 0 };

function fileInput() {
  return document.querySelector('input[type="file"][accept=".ged,.zip"]') as HTMLInputElement | null;
}

async function chooseFileAndMode(mode: 'overwrite' | 'merge') {
  fireEvent.change(fileInput()!, { target: { files: [new File(['0 HEAD\n0 TRLR'], 'family.ged', { type: 'text/plain' })] } });
  fireEvent.click(document.querySelector(`input[type="radio"][value="${mode}"]`) as HTMLInputElement);
}

beforeEach(() => {
  vi.clearAllMocks();
  state.treeId = 9;
  HTMLElement.prototype.scrollIntoView = vi.fn();
  state.getCounts.mockResolvedValue(EMPTY);
  state.suggestions.mockResolvedValue([]);
  state.previewGedcom.mockImplementation(async ({ mode }: { mode: string }) => ({
    mode,
    skipped: [],
    toImport: { peopleCount: 4824, familiesCount: 964, childrenCount: 0, mediaCount: 0, sourcesCount: 0, citationsCount: 0 },
  }));
});

describe('import page names its target tree (FR-2)', () => {
  it('names the tree and its counts in the heading, the warning and the preview', async () => {
    state.getCounts.mockResolvedValue({ ...EMPTY, people: 120, families: 25 });
    render(<ImportExportPage />);
    expect(screen.getByRole('heading', { name: 'import_title_tree {"tree":"Test tree"}' })).toBeInTheDocument();
    await chooseFileAndMode('overwrite');

    const warning = await screen.findByText(/overwrite_warning_counts/);
    expect(warning.textContent).toContain('"tree":"Test tree"');
    expect(warning.textContent).toContain('people\\":120');
    expect(screen.getByRole('button', { name: 'back_up_first' })).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'preview_button' })[0]);
    const current = await screen.findByText(/preview_current_overwrite/);
    expect(current.textContent).toContain('"tree":"Test tree"');
    expect(current.textContent).toContain('people\\":120');
    // The mode is a translated label, not the raw enum value (FR-3).
    expect(screen.getByText(/preview_ready/).textContent).toContain('"mode":"mode_overwrite"');
  });

  it('keeps the warning, without numbers, when the counts cannot be read', async () => {
    state.getCounts.mockRejectedValue(new Error('offline'));
    render(<ImportExportPage />);
    await chooseFileAndMode('overwrite');
    const warning = await screen.findByText(/^overwrite_warning /);
    expect(warning.textContent).toContain('"tree":"Test tree"');
    expect(screen.getByRole('button', { name: 'back_up_first' })).toBeInTheDocument();
  });

  it('shows no overwrite warning or backup link on an empty tree', async () => {
    render(<ImportExportPage />);
    await chooseFileAndMode('overwrite');
    await act(async () => {});
    expect(screen.queryByText(/overwrite_warning/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'back_up_first' })).toBeNull();
  });
});

describe('overwrite confirmation is bound to its tree', () => {
  it('closes without importing when the active tree changes while it is open', async () => {
    state.getCounts.mockResolvedValue({ ...EMPTY, people: 120, families: 25 });
    const { rerender } = render(<ImportExportPage />);
    await chooseFileAndMode('overwrite');
    fireEvent.click(screen.getAllByRole('button', { name: 'preview_button' })[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'import_button' }));
    expect(await screen.findByText('overwrite_confirm_title')).toBeInTheDocument();

    state.treeId = 10;
    rerender(<ImportExportPage />);
    await act(async () => {});
    expect(screen.queryByText('overwrite_confirm_title')).toBeNull();
    expect(state.importGedcom).not.toHaveBeenCalled();
  });
});

describe('import progress and result (ST-1, FR-3)', () => {
  it('shows each reported step, then collapses the form into the result', async () => {
    let finish: (value: unknown) => void = () => {};
    state.importGedcom.mockImplementation(({ onProgress }: { onProgress: (step: string) => void }) => {
      onProgress('people');
      return new Promise((resolve) => { finish = resolve; });
    });
    state.suggestions.mockResolvedValue([{ type: 'duplicates', count: 4, href: '/people?filter=duplicates' }]);

    render(<ImportExportPage />);
    await chooseFileAndMode('merge');
    fireEvent.click(screen.getAllByRole('button', { name: 'preview_button' })[0]);
    // A large file in the browser build warns that it takes about a minute.
    expect(await screen.findByText('import_browser_note')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'import_button' }));

    expect(await screen.findByText('import_step_people')).toBeInTheDocument();
    expect(screen.getByText('3 / 6')).toBeInTheDocument();

    await act(async () => {
      finish({ mode: 'merge', peopleCount: 4824, familiesCount: 964, mediaItems: [] });
    });

    expect(fileInput()).toBeNull();
    expect(await screen.findByText(/suggestion_duplicates/)).toBeInTheDocument();
    // No home person prompt (#1055): the tree picks its own default root.
    expect(screen.queryByText('home_person_title')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'import_another' }));
    expect(fileInput()).not.toBeNull();
  });
});
