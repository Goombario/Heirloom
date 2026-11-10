/** @vitest-environment happy-dom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';
import { TreeDisplayControls, type TreeDisplayProps } from '@/app/tree/TreeDisplayControls';

const props = (over: Partial<TreeDisplayProps> = {}): TreeDisplayProps => ({
    orientation: 'vertical', onOrientationChange: vi.fn(), orientationDisabled: false,
    barZoomThreshold: 0.5, onBarZoomThresholdChange: vi.fn(),
    depth: 4, maxDepth: 4, onDepthCommit: vi.fn(), showAges: false, onShowAgesChange: vi.fn(), ...over,
});
const renderControls = (p: TreeDisplayProps) => render(
    <NextIntlClientProvider locale="en" messages={en}><TreeDisplayControls {...p} /></NextIntlClientProvider>,
);

// The rail's settings, shared with the Display sheet below lg (#936).
describe('TreeDisplayControls', () => {
    it('switches orientation and commits a new depth', () => {
        const p = props();
        renderControls(p);
        fireEvent.click(screen.getByRole('radio', { name: new RegExp(en.treeView.layout_horizontal) }));
        expect(p.onOrientationChange).toHaveBeenCalledWith('horizontal');
        const slider = screen.getByRole('slider', { name: en.treeView.depth });
        fireEvent.change(slider, { target: { value: '2' } });
        fireEvent.keyUp(slider);
        expect(p.onDepthCommit).toHaveBeenCalledWith(2);
    });

    it('disables orientation in focus view and says why', () => {
        renderControls(props({ orientationDisabled: true }));
        expect(screen.getByText(en.treeView.orientation_focus_na)).toBeTruthy();
        expect((screen.getByRole('radio', { name: new RegExp(en.treeView.layout_horizontal) }) as HTMLButtonElement).disabled).toBe(true);
    });

    // "Show ages" moved here from Options › Experimental (#271).
    it('toggles Show ages', () => {
        const p = props();
        renderControls(p);
        const sw = screen.getByRole('switch', { name: en.treeView.show_ages });
        expect(sw.getAttribute('aria-checked')).toBe('false');
        fireEvent.click(sw);
        expect(p.onShowAgesChange).toHaveBeenCalledWith(true);
    });
});
