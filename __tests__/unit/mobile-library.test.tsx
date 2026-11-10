/** @vitest-environment happy-dom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  query: '',
  permission: 'edit',
  push: vi.fn(),
  replace: vi.fn(),
  pending: 0,
  sources: [] as Array<Record<string, unknown>>,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: harness.push, replace: harness.replace }),
  useSearchParams: () => new URLSearchParams(harness.query),
}));
vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  // Keys come back with their params, so a test can read what a row says.
  useTranslations: () => (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key),
}));
vi.mock('@/app/contexts/TreeContext', () => ({ useTree: () => ({ activeTreeId: 7, activePermission: harness.permission, currentUserId: 42 }) }));
vi.mock('@/app/hooks/useIsMobile', () => ({ useIsMobile: () => true }));
vi.mock('@/app/components/useLoadPhase', () => ({ useLoadPhase: () => 'ready' }));
vi.mock('@/app/library/useLibrarySources', () => ({
  useLibrarySources: () => ({ sources: harness.sources, photos: [], loading: false, refetch: vi.fn(), sourceError: null, photoError: null }),
}));
vi.mock('@/app/library/useMediaStorage', () => ({ useMediaStorage: () => ({ summary: null, loading: false, error: null, retry: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/lib/data', () => ({
  getDataClient: vi.fn().mockImplementation(async () => ({
    media: { listFaceQueue: vi.fn().mockResolvedValue({ pendingTotal: harness.pending }) },
    repositories: { list: vi.fn().mockResolvedValue([]) },
  })),
}));
vi.mock('@/app/library/faces/FacesPanel', () => ({ default: () => <div>Faces panel</div> }));
vi.mock('@/app/components/UploadModal', () => ({ default: () => null }));
vi.mock('@/app/library/sections/PhotosGrid', () => ({ default: () => <div>Photos grid</div> }));

import MobileLibrary from '@/app/library/MobileLibrary';

const source = (Id: number, Title: string, citationCount: number, extra: Record<string, unknown> = {}) => ({
  Id, Title, citationCount, Type: 'Census', RepositoryName: null, Contents: null, Author: null, citedByPeople: [], ...extra,
});

describe('MobileLibrary (#1119)', () => {
  beforeEach(() => {
    harness.query = 'tab=sources';
    harness.permission = 'edit';
    harness.pending = 0;
    harness.push.mockReset();
    harness.replace.mockReset();
    harness.sources = [source(1, 'Bible', 2), source(2, 'Census 1900', 0, { RepositoryName: 'National Archives' })];
  });

  it('lists sources as rows that open the source page', () => {
    render(<MobileLibrary />);
    const link = screen.getByRole('link', { name: /Census 1900/ });
    expect(link).toHaveAttribute('href', '/library/view?id=2');
    expect(link).toHaveTextContent('National Archives');
    expect(link).toHaveTextContent('not_cited');
  });

  it('opens an old ?tab=uncited link on Sources with the Uncited chip on', () => {
    harness.query = 'tab=uncited';
    render(<MobileLibrary />);
    expect(screen.queryByRole('link', { name: /Bible/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Census 1900/ })).toBeInTheDocument();
    expect(screen.getByText('uncited_hint')).toBeInTheDocument();
  });

  it('sends a desktop ?source= link to the source page', () => {
    harness.query = 'source=5';
    render(<MobileLibrary />);
    expect(harness.replace).toHaveBeenCalledWith('/library/view?id=5');
  });

  it('opens the New source sheet from the Add source pill instead of a page (#1127)', async () => {
    render(<MobileLibrary />);
    fireEvent.click(screen.getByRole('button', { name: 'add_source' }));
    expect(await screen.findByRole('dialog', { name: 'new_source' })).toBeInTheDocument();
    expect(harness.push).not.toHaveBeenCalledWith('/library/new');
  });

  it('opens the New source sheet for a /library/new link (?new=1)', async () => {
    harness.query = 'new=1';
    render(<MobileLibrary />);
    expect(await screen.findByRole('dialog', { name: 'new_source' })).toBeInTheDocument();
  });

  it('gives viewers no Add source pill', () => {
    harness.permission = 'view';
    render(<MobileLibrary />);
    expect(screen.queryByRole('button', { name: 'add_source' })).not.toBeInTheDocument();
  });

  it('shows Faces to confirm above the photos when faces wait', async () => {
    harness.query = 'tab=photos';
    harness.pending = 3;
    render(<MobileLibrary />);
    const row = await screen.findByRole('button', { name: /faces_to_confirm/ });
    expect(row).toHaveTextContent('3');
    fireEvent.click(row);
    expect(harness.push).toHaveBeenCalledWith('/library?tab=faces', { scroll: false });
  });

  it('shows Manage repositories as its own page with the menu at the top left, not Back', async () => {
    harness.query = 'tab=repositories';
    render(<MobileLibrary />);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'tab_repositories_label' })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'toggle_menu' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'back' })).not.toBeInTheDocument();
  });
});
