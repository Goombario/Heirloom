/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { useEffect, useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

const harness = vi.hoisted(() => ({
  tree: { activeTreeId: 7, activePermission: 'edit', currentUserId: 42 },
  useFaceQueue: vi.fn(),
  searchParams: new URLSearchParams(),
  dynamicLoads: vi.fn(),
  getDataClient: vi.fn(),
  listFaceQueue: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => harness.searchParams,
}));
vi.mock('next/dynamic', () => ({
  default: (loader: () => Promise<{ default: React.ComponentType<Record<string, unknown>> }>, options: { loading?: () => React.ReactNode }) => {
    function DynamicComponent(props: Record<string, unknown>) {
      const [Loaded, setLoaded] = useState<React.ComponentType<Record<string, unknown>> | null>(null);
      useEffect(() => {
        harness.dynamicLoads();
        void loader().then((module) => setLoaded(() => module.default));
      }, []);
      return Loaded ? React.createElement(Loaded, props) : options.loading?.() ?? null;
    }
    return DynamicComponent;
  },
}));

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => (key: string) => key,
}));
vi.mock('@/app/contexts/TreeContext', () => ({ useTree: () => harness.tree }));
vi.mock('@/app/hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('@/app/components/useLoadPhase', () => ({ useLoadPhase: () => 'ready' }));
vi.mock('@/app/library/useLibrarySources', () => ({
  useLibrarySources: () => ({ sources: [], photos: [], loading: false, refetch: vi.fn() }),
}));
vi.mock('@/app/library/faces/useFaceQueue', () => ({
  useFaceQueue: (...args: unknown[]) => {
    harness.useFaceQueue(...args);
    return {
      groups: [], pendingTotal: 0, resolvedTotal: 0, loading: false, error: null,
      confirm: vi.fn(), repoint: vi.fn(), restoreFaceSuggestions: vi.fn(), dismiss: vi.fn(), undo: vi.fn(), reload: vi.fn(),
    };
  },
}));
vi.mock('@/lib/data', () => ({ getDataClient: harness.getDataClient }));

import FacesPanel from '@/app/library/faces/FacesPanel';
import LibraryPage from '@/app/library/page';

beforeEach(() => {
  harness.tree.activeTreeId = 7;
  harness.tree.activePermission = 'edit';
  harness.tree.currentUserId = 42;
  harness.useFaceQueue.mockClear();
  harness.dynamicLoads.mockClear();
  harness.getDataClient.mockReset();
  harness.listFaceQueue.mockReset();
  harness.listFaceQueue.mockResolvedValue({ pendingTotal: 0 });
  harness.getDataClient.mockResolvedValue({ media: { listFaceQueue: harness.listFaceQueue } });
  harness.searchParams = new URLSearchParams('tab=sources');
});

afterEach(cleanup);

describe('FacesPanel', () => {
  it('owns only queue content and does not render duplicate library chrome', async () => {
    render(<FacesPanel treeId={7} canEdit onPendingCountChange={vi.fn()} />);

    expect(await screen.findByText('queue_title')).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Library' })).not.toBeInTheDocument();
    expect(harness.useFaceQueue).toHaveBeenCalledWith(7, false);
  });

  it('keeps its local resolved view when the shell hides and shows the mounted panel', async () => {
    const { rerender } = render(
      <div><div data-testid="faces-slot"><FacesPanel treeId={7} canEdit /></div></div>,
    );
    fireEvent.click(await screen.findByRole('radio', { name: 'filter_resolved_short' }));
    expect(await screen.findByText('queue_resolved_title')).toBeInTheDocument();

    rerender(
      <div><div data-testid="faces-slot" hidden><FacesPanel treeId={7} canEdit /></div></div>,
    );
    rerender(
      <div><div data-testid="faces-slot"><FacesPanel treeId={7} canEdit /></div></div>,
    );
    expect(screen.getByText('queue_resolved_title')).toBeInTheDocument();
  });
});

describe('Library shell Faces activation', () => {
  it('does not mount Faces from a click until the active URL tab is Faces', async () => {
    const { rerender } = render(<LibraryPage />);
    const facesTab = await screen.findByRole('tab', { name: /queue_tab/ });

    fireEvent.click(facesTab);
    expect(harness.dynamicLoads).not.toHaveBeenCalled();

    harness.searchParams = new URLSearchParams('tab=faces');
    rerender(<LibraryPage />);
    await waitFor(() => expect(harness.dynamicLoads).toHaveBeenCalledTimes(1));
  });

  it('does not load Faces off-tab, loads it once on activation, and keeps it mounted', async () => {
    const { rerender } = render(<LibraryPage />);
    expect(await screen.findByRole('tabpanel')).toHaveAttribute('id', 'library-panel-sources');
    expect(harness.dynamicLoads).not.toHaveBeenCalled();
    await waitFor(() => expect(harness.listFaceQueue).toHaveBeenCalled());
    expect(harness.listFaceQueue.mock.calls.every(([options]) => options.countOnly === true)).toBe(true);

    harness.searchParams = new URLSearchParams('tab=faces');
    rerender(<LibraryPage />);
    await waitFor(() => expect(harness.dynamicLoads).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('tabpanel')).toHaveAttribute('id', 'library-panel-faces');

    harness.searchParams = new URLSearchParams('tab=sources');
    rerender(<LibraryPage />);
    expect(screen.getByRole('tabpanel')).toHaveAttribute('id', 'library-panel-sources');

    harness.searchParams = new URLSearchParams('tab=faces');
    rerender(<LibraryPage />);
    await waitFor(() => expect(screen.getByRole('tabpanel')).toHaveAttribute('id', 'library-panel-faces'));
    expect(harness.dynamicLoads).toHaveBeenCalledTimes(1);
  });

  it('does not load the full queue on an initial Photos tab', async () => {
    harness.searchParams = new URLSearchParams('tab=photos');
    render(<LibraryPage />);

    expect(await screen.findByRole('tabpanel')).toHaveAttribute('id', 'library-panel-photos');
    expect(harness.dynamicLoads).not.toHaveBeenCalled();
    await waitFor(() => expect(harness.listFaceQueue).toHaveBeenCalled());
    expect(harness.listFaceQueue.mock.calls.every(([options]) => options.countOnly === true)).toBe(true);
  });

  it('restores document positions after a shorter tab clamps the outgoing scroll', async () => {
    const { rerender } = render(<LibraryPage />);
    await screen.findByRole('tabpanel');
    const scrollElement = document.scrollingElement ?? document.documentElement;
    scrollElement.scrollTop = 111;
    fireEvent.scroll(window);

    harness.searchParams = new URLSearchParams('tab=photos');
    rerender(<LibraryPage />);
    await screen.findByRole('tabpanel');
    await waitFor(() => expect(scrollElement.scrollTop).toBe(0));
    scrollElement.scrollTop = 222;
    fireEvent.scroll(window);

    // Switching to the shorter Sources panel commits a smaller document and
    // the browser clamps its scroll before the shell's layout effect runs.
    scrollElement.scrollTop = 0;
    harness.searchParams = new URLSearchParams('tab=sources');
    rerender(<LibraryPage />);
    await screen.findByRole('tabpanel');
    await waitFor(() => expect(scrollElement.scrollTop).toBe(111));

    harness.searchParams = new URLSearchParams('tab=photos');
    rerender(<LibraryPage />);
    await waitFor(() => expect(scrollElement.scrollTop).toBe(222));
  });

  it('clears stored positions when the active tree changes', async () => {
    const { rerender } = render(<LibraryPage />);
    await screen.findByRole('tabpanel');
    const scrollElement = document.scrollingElement ?? document.documentElement;
    scrollElement.scrollTop = 333;
    fireEvent.scroll(window);

    harness.searchParams = new URLSearchParams('tab=photos');
    rerender(<LibraryPage />);
    await screen.findByRole('tabpanel');
    scrollElement.scrollTop = 444;
    fireEvent.scroll(window);

    harness.tree.activeTreeId = 8;
    rerender(<LibraryPage />);
    await waitFor(() => expect(scrollElement.scrollTop).toBe(0));

    harness.searchParams = new URLSearchParams('tab=sources');
    rerender(<LibraryPage />);
    expect(scrollElement.scrollTop).toBe(0);
  });
});
