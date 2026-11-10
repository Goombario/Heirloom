import { describe, expect, it } from 'vitest';
import { withSharpSlot, SHARP_MAX_INPUT_PIXELS } from '@/lib/sharp-resource';

describe('shared Sharp resource gate', () => {
  it('allows at most two delayed operations across the shared gate', async () => {
    let active = 0;
    let maximum = 0;
    await Promise.all(Array.from({ length: 8 }, () => withSharpSlot(async () => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active--;
    })));

    expect(maximum).toBe(2);
  });

  it('publishes the hosted decoded-input pixel ceiling', () => {
    expect(SHARP_MAX_INPUT_PIXELS).toBe(64_000_000);
  });
});
