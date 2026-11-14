/** @vitest-environment happy-dom */
import { describe, it, expect, afterEach } from 'vitest';
import { addMapCredit } from '@/lib/geo/map-style';

// #42: the basemap credit is always-visible text in the map's corner, so the
// map needs no collapsing ⓘ (OSMF attribution guidelines).
function mount() {
    const corner = document.createElement('div');
    document.body.append(corner);
    let control: { onAdd(): HTMLElement; onRemove(): void } | null = null;
    let position: string | undefined;
    addMapCredit({
        addControl(c, p) { control = c; position = p; corner.append(c.onAdd()); },
    }, { osm: '© OpenStreetMap', tiles: 'OpenMapTiles' });
    return { corner, control: control!, position };
}

describe('addMapCredit', () => {
    afterEach(() => { document.body.innerHTML = ''; });

    it('adds the credit as a bottom-right control with both links', () => {
        const { corner, position } = mount();
        expect(position).toBe('bottom-right');
        const el = corner.querySelector('.map-credit');
        expect(el?.textContent).toBe('© OpenStreetMap · OpenMapTiles');
        const links = [...corner.querySelectorAll('a')];
        expect(links.map(a => a.getAttribute('href'))).toEqual([
            'https://www.openstreetmap.org/copyright',
            'https://openmaptiles.org/',
        ]);
        for (const a of links) {
            expect(a.target).toBe('_blank');
            expect(a.rel).toBe('noopener noreferrer');
        }
    });

    it('is plain text and links, never a button that hides it', () => {
        const { corner } = mount();
        expect(corner.querySelector('button, details, summary')).toBeNull();
    });

    it('removes itself when the map drops the control', () => {
        const { corner, control } = mount();
        control.onRemove();
        expect(corner.querySelector('.map-credit')).toBeNull();
    });
});
