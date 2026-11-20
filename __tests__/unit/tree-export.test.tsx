/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const toJpeg = vi.hoisted(() => vi.fn());
vi.mock('html-to-image', () => ({ toJpeg }));
vi.mock('reactflow', () => ({ getRectOfNodes: () => ({ x: 0, y: 0, width: 400, height: 300 }) }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

import { useTreeExport } from '@/app/components/tree/useTreeExport';
import type { ReactFlowInstance } from 'reactflow';

function setup() {
    const { result } = renderHook(() => useTreeExport());
    const container = document.createElement('div');
    container.style.width = '800px';
    container.style.height = '600px';
    container.style.overflow = 'hidden';
    container.appendChild(Object.assign(document.createElement('div'), { className: 'react-flow' }));
    document.body.appendChild(container);
    (result.current.containerRef as { current: HTMLDivElement | null }).current = container;
    const setViewport = vi.fn();
    result.current.setReactFlowInstance({
        getViewport: () => ({ x: 5, y: 6, zoom: 0.8 }),
        getNodes: () => [{ id: '1' }],
        setViewport,
    } as unknown as ReactFlowInstance);
    return { result, container, setViewport };
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); toJpeg.mockReset(); document.body.innerHTML = ''; });

async function run(result: ReturnType<typeof setup>['result']) {
    vi.useFakeTimers();
    let done!: Promise<void>;
    act(() => { done = result.current.exportAsJPEG(1); });
    await act(async () => { await vi.runAllTimersAsync(); await done; });
}

describe('tree JPEG export (#186)', () => {
    it('does not cache-bust image URLs, which breaks local blob: photos', async () => {
        toJpeg.mockResolvedValue('data:image/jpeg;base64,AAAA');
        const { result } = setup();
        await run(result);
        const options = toJpeg.mock.calls[0][1];
        expect(options.cacheBust).toBeFalsy();
        expect(options.imagePlaceholder).toMatch(/^data:image\//);
    });

    it('puts the container and viewport back when the capture fails', async () => {
        toJpeg.mockRejectedValue(new Event('error'));
        vi.stubGlobal('alert', vi.fn());
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const { result, container, setViewport } = setup();
        await run(result);
        expect(alert).toHaveBeenCalledWith('export_failed');
        expect(container.style.width).toBe('800px');
        expect(container.style.height).toBe('600px');
        expect(container.style.overflow).toBe('hidden');
        expect(setViewport).toHaveBeenLastCalledWith({ x: 5, y: 6, zoom: 0.8 }, { duration: 200 });
        expect(result.current.isExporting).toBe(false);
    });
});
