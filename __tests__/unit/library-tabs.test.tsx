/** @vitest-environment happy-dom */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('next-intl', () => ({
  useTranslations: (namespace: string) => (key: string) => namespace === 'faceTags' && key === 'queue_tab'
    ? 'Faces'
    : key.replace('tab_', '').replace('_label', ''),
}));

import LibraryTabs from '@/app/library/sections/LibraryTabs';

describe('LibraryTabs', () => {
  it('renders the three desktop tabs (Media, Sources, Faces) with a matching panel relationship', () => {
    render(<LibraryTabs activeTab="sources" onSelect={vi.fn()} />);

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    expect(tabs.map((tab) => tab.id)).toEqual(['library-tab-photos', 'library-tab-sources', 'library-tab-faces']);
    for (const tab of tabs) {
      const name = tab.id.replace('library-tab-', '');
      expect(tab).toHaveAttribute('id', `library-tab-${name}`);
      expect(tab).toHaveAttribute('aria-controls', `library-panel-${name}`);
    }
    expect(screen.getByRole('tab', { name: 'sources' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'photos' })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('tab', { name: 'sources' })).toHaveClass('min-h-11', 'gap-1', 'focus-ring-inset');
  });

  it('wraps keyboard movement, activates the destination, and focuses it', () => {
    const onSelect = vi.fn();
    render(<LibraryTabs activeTab="photos" onSelect={onSelect} />);

    const photos = screen.getByRole('tab', { name: 'photos' });
    fireEvent.keyDown(photos, { key: 'ArrowLeft' });
    expect(onSelect).toHaveBeenCalledWith('faces');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Faces' }));

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'End' });
    expect(onSelect).toHaveBeenLastCalledWith('faces');
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Home' });
    expect(onSelect).toHaveBeenLastCalledWith('photos');
    expect(document.activeElement).toBe(photos);
  });
});
