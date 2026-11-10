import { describe, expect, it } from 'vitest';
import { placeCitationPopover } from '@/app/components/citations/popoverPlacement';

const box = (top: number, bottom: number, left: number, right: number) => ({ top, bottom, left, right });
const viewport = { width: 1440, height: 900 };

// EV-5: the popover sits beside the fact's row, never over it, and inside the
// content column.
describe('placeCitationPopover', () => {
  it('opens below the row, inside the content column', () => {
    const place = placeCitationPopover({ anchor: box(200, 218, 220, 238), row: box(190, 240, 208, 900), bounds: box(0, 900, 208, 900), height: 300, viewport });
    expect(place.top).toBe(248);
    expect(place.left).toBe(208);
    expect(place.width).toBe(480);
  });

  it('opens above the row when there is no room below', () => {
    const place = placeCitationPopover({ anchor: box(700, 718, 500, 518), row: box(690, 740, 208, 900), bounds: box(0, 900, 208, 900), height: 300, viewport });
    expect(place.top).toBe(382);
    expect(place.top + 300).toBeLessThanOrEqual(690);
  });

  it('narrows to a column slimmer than the popover', () => {
    const place = placeCitationPopover({ anchor: box(200, 218, 300, 318), row: box(190, 240, 100, 420), bounds: box(0, 900, 100, 420), height: 200, viewport });
    expect(place).toMatchObject({ top: 248, left: 100, width: 320 });
  });

  it('takes the roomier side and caps its height when it fits neither', () => {
    const place = placeCitationPopover({ anchor: box(400, 418, 300, 318), row: box(390, 440, 208, 900), bounds: box(0, 900, 208, 900), height: 520, viewport });
    expect(place.top).toBe(448);
    expect(place.maxHeight).toBe(440);
    expect(place.top).toBeGreaterThanOrEqual(440);
  });
});
