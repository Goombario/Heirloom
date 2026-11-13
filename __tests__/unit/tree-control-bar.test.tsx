/** @vitest-environment happy-dom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';
import { TreeControlBar } from '@/app/tree/TreeControlBar';
import type { TreeDisplayProps } from '@/app/tree/TreeDisplayControls';
import type { useTreeSearch } from '@/app/tree/useTreeSearch';

vi.mock('@/app/contexts/TreeContext', () => ({ useTree: () => ({ activeTreeId: 1 }) }));
vi.mock('@/app/components/PersonAvatar', () => ({ default: () => <span data-testid="avatar" /> }));

const display: TreeDisplayProps = {
    orientation: 'vertical', onOrientationChange: vi.fn(), orientationDisabled: false,
    barZoomThreshold: 0.5, onBarZoomThresholdChange: vi.fn(),
    depth: 3, maxDepth: 3, onDepthCommit: vi.fn(), showAges: false, onShowAgesChange: vi.fn(), showStatus: true, onShowStatusChange: vi.fn(),
};

function search(): ReturnType<typeof useTreeSearch> {
    return {
        searchQuery: '', setSearchQuery: vi.fn(), showDropdown: false, setShowDropdown: vi.fn(),
        searchRef: { current: null }, dropdownRef: { current: null },
        filteredPeople: [], allFilteredPeople: [], visibleCount: 20, hasMore: false,
        handleDropdownScroll: vi.fn(), handlePersonSelect: vi.fn(),
    };
}

function renderBar(over: Partial<React.ComponentProps<typeof TreeControlBar>> = {}) {
    const props: React.ComponentProps<typeof TreeControlBar> = {
        mode: 'descendants', ready: true, canViewDescendants: true, canViewAncestors: false, canFocus: true,
        onModeChange: vi.fn(),
        currentPersonInfo: { id: 7, name: 'Agnes Whitfield', isRoot: true, isLeaf: false, hasAncestors: false, hasDescendants: true, isIsolated: false },
        rootFace: null, onBringIntoView: vi.fn(), canExport: true, onExport: vi.fn(), isExporting: false,
        selectedRootId: 7, search: search(), display, ...over,
    };
    render(<NextIntlClientProvider locale="en" messages={en}><TreeControlBar {...props} /></NextIntlClientProvider>);
    return props;
}

// The desktop tree's one control bar (#71).
describe('TreeControlBar', () => {
    it('names the root person and brings them into view without a label change', () => {
        const p = renderBar();
        expect(screen.getByText('Agnes Whitfield')).toBeTruthy();
        const bring = screen.getByRole('button', { name: en.treeView.bring_into_view });
        expect(bring.getAttribute('title')).toBe('Scroll the tree back to Agnes Whitfield');
        fireEvent.click(bring);
        expect(p.onBringIntoView).toHaveBeenCalledOnce();
    });

    it('keeps an impossible direction visible but disabled, with the reason', () => {
        renderBar();
        const ancestors = screen.getByRole('radio', { name: new RegExp(en.treeView.leaf_view) }) as HTMLButtonElement;
        expect(ancestors.disabled).toBe(true);
        expect(ancestors.getAttribute('title')).toBe(en.treeView.no_ancestors_tooltip);
    });

    it('hides Export for view-only members', () => {
        renderBar({ canExport: false });
        expect(screen.queryByRole('button', { name: en.treeView.export_jpeg })).toBeNull();
    });

    it('opens Display with Layout, Depth and Show ages, and closes on Escape', () => {
        renderBar();
        const trigger = screen.getByRole('button', { name: en.treeView.display });
        fireEvent.click(trigger);
        expect(screen.getByRole('dialog', { name: en.treeView.display_title })).toBeTruthy();
        expect(screen.getByRole('switch', { name: en.treeView.show_ages })).toBeTruthy();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('focuses Find on / before the global search sees it', () => {
        renderBar();
        const ev = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true });
        document.body.dispatchEvent(ev);
        expect(ev.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(screen.getByRole('textbox', { name: en.treeView.find_in_tree }));
    });
});
