/** @vitest-environment happy-dom */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  mobile: false,
  query: 'tab=sources',
  permission: 'edit',
  push: vi.fn(),
  replace: vi.fn(),
  sources: [] as unknown[],
  repositories: [] as unknown[],
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: harness.push, replace: harness.replace }),
  useSearchParams: () => new URLSearchParams(harness.query),
}));
vi.mock('next-intl', () => ({ useLocale: () => 'en', useTranslations: () => (key: string, values?: Record<string, unknown>) => ({
  title: 'Library', evidence_subtitle: 'Sources, photos, and evidence', tab_sources_label: 'Sources', tab_photos_label: 'Photos',
  search_sources_placeholder: 'Search sources', search_photos_placeholder: 'Search photos',
  add_source_fab_label: 'Add source', upload_photo: 'Upload', repo_add: 'Add repository', filter_sources_title: 'Filter sources',
  filter_type: 'Type', filter_all_types: 'All types', filter_repository: 'Repository', filter_all_repositories: 'All repositories',
  empty_no_match: 'No match', empty_uncited: 'No uncited', show_label: 'Show', show_all_sources: 'All sources', show_uncited: 'Uncited',
  show_all_photos: 'All photos', manage_repositories: 'Manage repositories', repos_dialog_title: 'Repositories', repo_edit: 'Edit',
  add_source_here: 'Add a source here', uncited_note: 'No fact cites these yet.', uncited_mark: 'Uncited',
  col_title: 'Title', col_type: 'Type', col_repository: 'Repository', col_cited_by: 'Cited by', col_citations: 'Citations',
  filter_photos_title: 'Filter photos', photo_filter_all: 'All', photo_filter_tagged: 'Tagged', photo_filter_untagged: 'Untagged',
  photo_sort_label: 'Photo order', photo_sort_recent: 'Recently added', photo_grid_all: 'All photographs',
  queue_tab: 'Faces', select: 'Select', type_Census: 'Census', type_Oral: 'Oral',
  source_count: `${values?.count} sources`,
}[key] ?? key) }));
vi.mock('@/app/contexts/TreeContext', () => ({ useTree: () => ({ activeTreeId: 7, activePermission: harness.permission, currentUserId: 42 }) }));
vi.mock('@/app/hooks/useIsMobile', () => ({ useIsMobile: () => harness.mobile }));
vi.mock('@/app/components/useLoadPhase', () => ({ useLoadPhase: () => 'ready' }));
vi.mock('@/app/library/useLibrarySources', () => ({ useLibrarySources: () => ({ sources: harness.sources, photos: [], loading: false, refetch: vi.fn() }) }));
vi.mock('@/lib/data', () => ({ getDataClient: vi.fn().mockImplementation(async () => ({
  media: { listFaceQueue: vi.fn().mockResolvedValue({ pendingTotal: 0 }) },
  repositories: { list: vi.fn().mockResolvedValue(harness.repositories) },
})) }));
vi.mock('@/app/components/PersonAvatar', () => ({ default: ({ name }: { name: string }) => <span>{name}</span> }));
vi.mock('@/app/library/faces/FacesPanel', () => ({ default: () => <div>Faces panel</div> }));
vi.mock('@/app/library/RepositoryModal', () => ({ default: () => null }));
vi.mock('@/app/library/SourceModal', () => ({ default: () => null }));
vi.mock('@/app/components/UploadModal', () => ({ default: () => null }));
vi.mock('@/app/library/sections/RepositoriesList', () => ({ default: () => <div>Repositories list</div> }));
vi.mock('@/app/library/sections/PhotosGrid', () => ({ default: () => <div>Photos grid</div> }));

import LibraryPage from '@/app/library/page';

function source(id: number, title: string, overrides: Record<string, unknown> = {}) {
  return {
    Id: id, OwnerId: 1, Title: title, Author: null, PublicationInfo: null, RepositoryName: null, CallNumber: null, Text: null,
    Type: 'Census', Contents: null, Num: null, RepositoryId: null, citationCount: 1, citedByPeople: [], ...overrides,
  };
}

const rowTitles = () => screen.getAllByRole('row').slice(1).map((row) => row.querySelector('.serif')?.textContent);

beforeEach(() => {
  harness.mobile = false;
  harness.query = 'tab=sources';
  harness.permission = 'edit';
  harness.push.mockClear();
  harness.replace.mockClear();
  harness.sources = [];
  harness.repositories = [];
});

describe('Library tabs and toolbar', () => {
  it('opens on Photos for a bare /library (#1157), and Sources for tab=sources', async () => {
    harness.query = '';
    const { rerender } = render(<LibraryPage />);
    expect(await screen.findByRole('tab', { name: /^Photos/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'Upload' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add source' })).not.toBeInTheDocument();

    harness.query = 'tab=sources';
    rerender(<LibraryPage />);
    expect(screen.getByRole('tab', { name: /^Sources/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'Add source' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Upload' })).not.toBeInTheDocument();
  });

  it('has three tabs: Repositories and Uncited are Sources filters now', async () => {
    render(<LibraryPage />);
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent?.trim().replace(/\s*\(\d+\)$/, ''))).toEqual(['Photos', 'Sources', 'Faces']);
    expect(screen.getByRole('complementary', { name: 'Filter sources' })).toBeInTheDocument();
  });

  it('gives Faces the page without a filter panel', async () => {
    harness.query = 'tab=faces';
    render(<LibraryPage />);

    expect(await screen.findByRole('tabpanel', { name: 'Faces' })).toBeInTheDocument();
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });

  it('exposes photo Select only when the active tree permits deletion', async () => {
    harness.query = 'tab=photos';
    const { rerender } = render(<LibraryPage />);
    expect(await screen.findByRole('button', { name: 'Select' })).toBeInTheDocument();

    harness.permission = 'contribute';
    rerender(<LibraryPage />);
    expect(screen.queryByRole('button', { name: 'Select' })).not.toBeInTheDocument();
  });

  it('puts the Photos filters in the floating panel and reserves space for the selection dock', async () => {
    harness.query = 'tab=photos';
    render(<LibraryPage />);

    const panel = await screen.findByRole('tabpanel');
    expect(screen.getByRole('complementary', { name: 'Filter photos' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'All photographs' })).toBeInTheDocument();
    expect(screen.getByTestId('library-photo-grid')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Select' }));

    expect(screen.getByTestId('photo-selection-dock')).toBeInTheDocument();
    expect(panel).toHaveClass('pb-32');
  });
});

describe('Sources filters (#1154)', () => {
  beforeEach(() => {
    harness.sources = [
      source(1, 'Census 1880', { RepositoryId: 4, RepositoryName: 'State Archive', citationCount: 2 }),
      source(2, 'Census 1900', { RepositoryId: 5, RepositoryName: 'County Archive', citationCount: 0 }),
      source(3, 'Family story', { Type: 'Oral', Author: 'Grandmother', citationCount: 0 }),
    ];
    harness.repositories = [
      { Id: 4, Name: 'State Archive', Address: '1 Main St', SourceCount: 1 },
      { Id: 5, Name: 'County Archive', Address: null, SourceCount: 1 },
      { Id: 6, Name: 'Empty Archive', Address: null, SourceCount: 0 },
    ];
  });

  it('combines Show and Type, and notes what Uncited means', async () => {
    render(<LibraryPage />);
    await screen.findByRole('table');
    expect(rowTitles()).toEqual(['Census 1880', 'Census 1900', 'Family story']);

    fireEvent.click(screen.getByRole('button', { name: 'Uncited 2' }));
    expect(rowTitles()).toEqual(['Census 1900', 'Family story']);
    expect(screen.getByTestId('library-uncited-note')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Census 2' }));
    expect(rowTitles()).toEqual(['Census 1900']);
  });

  it('lists only repositories with sources, and picking one goes to its view', async () => {
    render(<LibraryPage />);
    const panel = await screen.findByRole('complementary', { name: 'Filter sources' });
    await within(panel).findByRole('button', { name: 'State Archive 1' });
    expect(within(panel).queryByRole('button', { name: /Empty Archive/ })).not.toBeInTheDocument();

    fireEvent.click(within(panel).getByRole('button', { name: 'State Archive 1' }));
    expect(harness.push).toHaveBeenCalledWith('/library?tab=sources&repo=4', { scroll: false });
  });

  it('shows a picked repository above the table and drops the Repository column (?repo=)', async () => {
    harness.query = 'tab=sources&repo=4';
    render(<LibraryPage />);

    const header = await screen.findByTestId('library-repository-header');
    expect(within(header).getByRole('heading', { name: 'State Archive' })).toBeInTheDocument();
    expect(within(header).getByText('1 Main St · 1 sources')).toBeInTheDocument();
    expect(within(header).getByRole('button', { name: 'Add a source here' })).toBeInTheDocument();
    expect(rowTitles()).toEqual(['Census 1880']);
    expect(screen.queryByRole('columnheader', { name: /Repository/ })).not.toBeInTheDocument();

    fireEvent.click(within(header).getByRole('button', { name: 'Add a source here' }));
    expect(harness.push).toHaveBeenCalledWith('/library/new?repository=State%20Archive');
  });

  it('keeps a repository with no sources reachable through its view', async () => {
    harness.query = 'tab=sources&repo=6';
    render(<LibraryPage />);

    expect(await screen.findByRole('heading', { name: 'Empty Archive' })).toBeInTheDocument();
    expect(screen.getByText('repo_no_sources')).toBeInTheDocument();
  });

  it('drops a repository that no longer exists from the URL', async () => {
    harness.query = 'tab=sources&repo=99';
    render(<LibraryPage />);

    await waitFor(() => expect(harness.replace).toHaveBeenCalledWith('/library?tab=sources', { scroll: false }));
  });

  it('maps an old ?tab=uncited link to the Uncited filter on Sources', async () => {
    harness.query = 'tab=uncited';
    render(<LibraryPage />);

    expect(await screen.findByRole('button', { name: 'Uncited 2' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('tab', { name: /^Sources/ })).toHaveAttribute('aria-selected', 'true');
    expect(harness.replace).toHaveBeenCalledWith('/library?tab=sources', { scroll: false });
  });

  it('maps an old ?tab=repositories link to the Manage repositories dialog', async () => {
    harness.query = 'tab=repositories';
    render(<LibraryPage />);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Repositories' })).toBeInTheDocument();
    expect(within(dialog).getByText('Repositories list')).toBeInTheDocument();
    expect(harness.replace).toHaveBeenCalledWith('/library?tab=sources', { scroll: false });
  });

  it('opens Manage repositories from the foot of the panel', async () => {
    render(<LibraryPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Manage repositories' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
