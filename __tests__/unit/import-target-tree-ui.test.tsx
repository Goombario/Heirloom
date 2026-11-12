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
  useFormatter: () => ({ dateTime: (value: number) => String(value) }),
}));
vi.mock('@/app/contexts/TreeContext', () => ({ useTree: () => ({ activeTreeId: state.treeId, activePermission: 'owner' }) }));
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

/** Opens a job page the way a link would, then renders the page. */
function renderJob(job: 'add' | 'restore' | null) {
  window.history.replaceState(null, '', job ? `/import-export?job=${job}` : '/import-export');
  return render(<ImportExportPage />);
}

async function chooseAndCheck() {
  await act(async () => {});
  fireEvent.change(fileInput()!, { target: { files: [new File(['0 HEAD\n0 TRLR'], 'family.ged', { type: 'text/plain' })] } });
  fireEvent.click(screen.getByRole('button', { name: 'check_file' }));
  await screen.findByText('file_read');
}

beforeEach(() => {
  vi.clearAllMocks();
  state.treeId = 9;
  HTMLElement.prototype.scrollIntoView = vi.fn();
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  state.getCounts.mockResolvedValue(EMPTY);
  state.suggestions.mockResolvedValue([]);
  state.previewGedcom.mockImplementation(async ({ mode }: { mode: string }) => ({
    mode,
    skipped: [],
    toImport: { peopleCount: 4824, familiesCount: 964, childrenCount: 0, mediaCount: 0, sourcesCount: 0, citationsCount: 0 },
  }));
});

describe('import pages name their target tree (FR-2)', () => {
  it('names the tree and its counts in the hub band, the restore check and the confirmation', async () => {
    state.getCounts.mockResolvedValue({ ...EMPTY, people: 120, families: 25 });
    const view = renderJob(null);
    expect(await screen.findByText(/Test tree/)).toBeInTheDocument();
    expect((await screen.findByText(/start_again_line /)).textContent).toContain('people\\":120');
    view.unmount();

    renderJob('restore');
    expect(screen.getByText('scope_replace {"tree":"Test tree"}')).toBeInTheDocument();
    await chooseAndCheck();
    const current = screen.getByText(/preview_replaces/);
    expect(current.textContent).toContain('"tree":"Test tree"');
    expect(current.textContent).toContain('people\\":120');
    expect(state.previewGedcom).toHaveBeenCalledWith(expect.objectContaining({ mode: 'overwrite' }), 9);

    fireEvent.click(screen.getByRole('button', { name: 'replace_tree' }));
    expect(await screen.findByText('overwrite_confirm_title')).toBeInTheDocument();
    expect(screen.getByText(/overwrite_confirm_body /).textContent).toContain('"tree":"Test tree"');
  });

  it('still confirms, without numbers, when the counts cannot be read', async () => {
    state.getCounts.mockRejectedValue(new Error('offline'));
    renderJob('restore');
    await chooseAndCheck();
    fireEvent.click(screen.getByRole('button', { name: 'replace_tree' }));
    expect(await screen.findByText(/overwrite_confirm_body_no_counts/)).toBeInTheDocument();
    expect(state.importGedcom).not.toHaveBeenCalled();
  });

  it('hides Start again and greys out Back up on an empty tree', async () => {
    renderJob(null);
    expect(await screen.findByText('nothing_to_back_up')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /restore/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'download_backup' })).toBeDisabled();
  });

  it('refuses a file that is not a GEDCOM or backup and keeps Check disabled', async () => {
    renderJob('add');
    await act(async () => {});
    fireEvent.change(fileInput()!, { target: { files: [new File(['x'], 'notes.txt', { type: 'text/plain' })] } });
    expect(screen.getByRole('alert')).toHaveTextContent('wrong_type');
    expect(screen.getByRole('button', { name: 'check_file' })).toBeDisabled();
  });

  it('opens a job from the hub and comes back with the breadcrumb', async () => {
    state.getCounts.mockResolvedValue({ ...EMPTY, people: 120, families: 25 });
    renderJob(null);
    fireEvent.click(await screen.findByRole('button', { name: /^add_from_spreadsheet/ }));
    expect(window.location.search).toBe('?job=spreadsheet');
    expect(await screen.findByRole('heading', { name: 'add_from_spreadsheet', level: 1 })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^title/ }));
    expect(window.location.search).toBe('');
    expect(await screen.findByText('back_up_line')).toBeInTheDocument();
  });

  it('adds with merge, never overwrite', async () => {
    state.getCounts.mockResolvedValue({ ...EMPTY, people: 120, families: 25 });
    renderJob('add');
    await chooseAndCheck();
    expect(state.previewGedcom).toHaveBeenCalledWith(expect.objectContaining({ mode: 'merge' }), 9);
  });
});

describe('overwrite confirmation is bound to its tree', () => {
  it('closes without importing when the active tree changes while it is open', async () => {
    state.getCounts.mockResolvedValue({ ...EMPTY, people: 120, families: 25 });
    const { rerender } = renderJob('restore');
    await chooseAndCheck();
    fireEvent.click(screen.getByRole('button', { name: 'replace_tree' }));
    expect(await screen.findByText('overwrite_confirm_title')).toBeInTheDocument();

    state.treeId = 10;
    rerender(<ImportExportPage />);
    await act(async () => {});
    expect(screen.queryByText('overwrite_confirm_title')).toBeNull();
    expect(state.importGedcom).not.toHaveBeenCalled();
  });
});

describe('import progress and result (ST-1, FR-3)', () => {
  it('shows each reported step, then the result, then a clean form for another file', async () => {
    let finish: (value: unknown) => void = () => {};
    state.importGedcom.mockImplementation(({ onProgress }: { onProgress: (step: string) => void }) => {
      onProgress('people');
      return new Promise((resolve) => { finish = resolve; });
    });
    state.suggestions.mockResolvedValue([{ type: 'duplicates', count: 4, href: '/people?filter=duplicates' }]);

    renderJob('add');
    await chooseAndCheck();
    // A large file in the browser build warns that it takes about a minute.
    expect(screen.getByText('import_browser_note')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'import_n {"count":4824}' }));

    expect(await screen.findByText('3 / 6')).toBeInTheDocument();
    expect(screen.getAllByText('import_step_people').length).toBeGreaterThan(0);

    await act(async () => {
      finish({ mode: 'merge', peopleCount: 4824, familiesCount: 964, mediaItems: [] });
    });

    expect(fileInput()).toBeNull();
    expect(screen.getByText('people_added {"count":4824}')).toBeInTheDocument();
    expect(await screen.findByText(/suggestion_duplicates/)).toBeInTheDocument();
    // No home person prompt (#1055): the tree picks its own default root.
    expect(screen.queryByText('home_person_title')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'import_another' }));
    expect(fileInput()).not.toBeNull();
    expect(fileInput()!.files?.length ?? 0).toBe(0);
  });
});
