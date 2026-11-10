/** @vitest-environment happy-dom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { collapseCompactAttribution } from '@/lib/geo/map-style';

// OSMF attribution guidelines (#740): the map credit may collapse after five
// seconds or on interaction, not on load.
function setup() {
    const container = document.createElement('div');
    const attrib = document.createElement('details');
    attrib.className = 'maplibregl-ctrl-attrib maplibregl-compact';
    const canvas = document.createElement('canvas');
    container.append(attrib, canvas);
    document.body.append(container);
    collapseCompactAttribution({ getContainer: () => container });
    // MapLibre shows the credit once the sources load.
    const show = () => { attrib.classList.add('maplibregl-compact-show'); attrib.setAttribute('open', ''); };
    return { attrib, canvas, show };
}
// MutationObserver callbacks run as microtasks.
const flush = () => new Promise<void>((r) => queueMicrotask(r));

describe('collapseCompactAttribution', () => {
    afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

    it('leaves the credit open on load, then collapses it after five seconds', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const { attrib, show } = setup();
        show();
        await flush();
        vi.advanceTimersByTime(4999);
        expect(attrib.classList.contains('maplibregl-compact-show')).toBe(true);
        vi.advanceTimersByTime(1);
        expect(attrib.classList.contains('maplibregl-compact-show')).toBe(false);
        expect(attrib.hasAttribute('open')).toBe(false);
    });

    it('collapses on the first input on the map, but not on the credit itself', async () => {
        const { attrib, canvas, show } = setup();
        show();
        await flush();
        attrib.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        expect(attrib.classList.contains('maplibregl-compact-show')).toBe(true);
        canvas.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        expect(attrib.classList.contains('maplibregl-compact-show')).toBe(false);
    });
});
