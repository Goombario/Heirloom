/** @vitest-environment happy-dom */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';

// The hosted server hands a sharper copy as the crop zooms; the frame must not go blank while it loads.
let src = '/api/media/7/file';
vi.mock('@/lib/media/useMediaUrl', () => ({ useMediaUrl: () => ({ src }) }));

import { PortraitFrame } from '@/app/people/view/mobile/PortraitFrame';

const frame = { w: 390, h: 292.5 };

async function load(img: HTMLImageElement, w: number, h: number) {
    Object.defineProperty(img, 'naturalWidth', { value: w, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: h, configurable: true });
    img.decode = () => Promise.resolve();
    await act(async () => { fireEvent.load(img); });
}

const placed = (c: HTMLElement) => [...c.querySelectorAll('img')].filter((i) => i.style.transform);

describe('PortraitFrame (#1051)', () => {
    it('keeps the photo up while a sharper copy loads, then swaps to it', async () => {
        const { container, rerender } = render(<PortraitFrame photo={{ mediaId: 7 }} treeId={null} frame={frame} crop={{ face: { x: 0.5, y: 0.4 }, zoom: 1 }} alt="" />);
        const first = container.querySelector('img')!;
        expect(first.getAttribute('src')).toContain('w=1024');
        await load(first, 1024, 683);
        expect(placed(container)).toHaveLength(1);

        rerender(<PortraitFrame photo={{ mediaId: 7 }} treeId={null} frame={frame} crop={{ face: { x: 0.5, y: 0.4 }, zoom: 2 }} alt="" />);
        const imgs = [...container.querySelectorAll('img')];
        expect(imgs).toHaveLength(2);
        const next = imgs.find((i) => i.getAttribute('src')!.includes('w=2048'))!;
        // The old copy still shows, placed for the new zoom; the new one waits unseen.
        expect(placed(container)).toEqual([first]);
        expect(first.style.transform).toContain('scale(');
        expect(next.style.opacity).toBe('0');

        await load(next, 2048, 1365);
        expect([...container.querySelectorAll('img')]).toEqual([next]);
        expect(placed(container)).toEqual([next]);
    });

    it('starts afresh for a different photo', async () => {
        const { container, rerender } = render(<PortraitFrame photo={{ mediaId: 7 }} treeId={null} frame={frame} crop={{ face: { x: 0.5, y: 0.4 }, zoom: 1 }} alt="" />);
        await load(container.querySelector('img')!, 1024, 683);
        src = '/api/media/8/file';
        rerender(<PortraitFrame photo={{ mediaId: 8 }} treeId={null} frame={frame} crop={{ face: { x: 0.5, y: 0.4 }, zoom: 1 }} alt="" />);
        expect(placed(container)).toHaveLength(0);
        expect(container.querySelector('img')!.getAttribute('src')).toContain('/8/');
    });
});
