/** @vitest-environment happy-dom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';
import { TreeDisplayControls, type TreeDisplayProps } from '@/app/tree/TreeDisplayControls';

const props = (over: Partial<TreeDisplayProps> = {}): TreeDisplayProps => ({
    orientation: 'vertical', onOrientationChange: vi.fn(), orientationDisabled: false,
    barZoomThreshold: 0.5, onBarZoomThresholdChange: vi.fn(),
    depth: 4, maxDepth: 4, onDepthCommit: vi.fn(), showAges: false, onShowAgesChange: vi.fn(),
    showStatus: true, onShowStatusChange: vi.fn(), colorblind: false, onColorblindChange: vi.fn(),
    secondNameType: null, onSecondNameTypeChange: vi.fn(), ...over,
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

    // The living-status mark can be hidden from the Display menu (#68).
    it('toggles Show living status, on by default', () => {
        const p = props();
        renderControls(p);
        const sw = screen.getByRole('switch', { name: en.treeView.show_living_status });
        expect(sw.getAttribute('aria-checked')).toBe('true');
        fireEvent.click(sw);
        expect(p.onShowStatusChange).toHaveBeenCalledWith(false);
    });

    // Colorblind mode moved here from Options › Tree display.
    it('toggles Colorblind mode, off by default', () => {
        const p = props();
        renderControls(p);
        const sw = screen.getByRole('switch', { name: en.treeView.colorblind_mode });
        expect(sw.getAttribute('aria-checked')).toBe('false');
        fireEvent.click(sw);
        expect(p.onColorblindChange).toHaveBeenCalledWith(true);
    });

    // The second name line on vertical cards: None by default, then the name types.
    it('picks a Second name type, and None turns it off', () => {
        const p = props();
        const { unmount } = renderControls(p);
        const field = screen.getByRole('combobox', { name: en.treeView.second_name });
        expect(field.textContent).toContain(en.treeView.second_name_none);
        fireEvent.click(field);
        fireEvent.click(screen.getByRole('option', { name: en.personDetail.vtype_alias }));
        expect(p.onSecondNameTypeChange).toHaveBeenCalledWith('Alias');
        unmount();

        const q = props({ secondNameType: 'Alias' });
        renderControls(q);
        fireEvent.click(screen.getByRole('combobox', { name: en.treeView.second_name }));
        fireEvent.click(screen.getByRole('option', { name: en.treeView.second_name_none }));
        expect(q.onSecondNameTypeChange).toHaveBeenCalledWith(null);
    });

    it('disables Second name in the horizontal layout and says why', () => {
        renderControls(props({ orientation: 'horizontal', secondNameType: 'Nickname' }));
        const field = screen.getByRole('combobox', { name: en.treeView.second_name }) as HTMLButtonElement;
        expect(field.disabled).toBe(true);
        expect(field.textContent).toContain(en.personDetail.vtype_nickname);
        expect(screen.getByText(en.treeView.second_name_vertical_only)).toBeTruthy();
    });
});
