/** @vitest-environment happy-dom */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { Input } from '@/app/components/ui/Input';

/**
 * Guard against the search-icon overlap regression: when `Input` renders a leading
 * `icon`, the field must reserve left padding (`pl-9`) for it. The bug was that the
 * `sm` size pulled in the unlayered legacy `.input-field-sm` class, whose padding
 * overrode `pl-9`, so the icon sat on top of the placeholder. The primitive is the
 * single sanctioned way to build an icon input, so locking its class output here
 * protects every call site (places, library, …) and any future one.
 */
describe('Input icon padding', () => {
  it('reserves left padding for a leading icon (both sizes)', () => {
    for (const size of ['sm', 'md'] as const) {
      const { container, unmount } = render(
        <Input size={size} icon={<span data-testid="icon">i</span>} placeholder="Search…" />,
      );
      const input = container.querySelector('input');
      expect(input).toBeInTheDocument();
      // Padding for the icon must be present…
      expect(input!.className).toContain('pl-9');
      unmount();
    }
  });

  it('does not re-introduce the legacy .input-field-sm class that overrode pl-9', () => {
    const { container } = render(<Input size="sm" icon={<span>i</span>} placeholder="Search…" />);
    const input = container.querySelector('input')!;
    // The unlayered legacy class beat layered utilities and caused the overlap.
    // The class is retired (#331), but the primitive must keep styling itself with
    // utilities only (plus the padding-free .input-nozoom iOS guard).
    expect(input.className).not.toContain('input-field-sm');
  });

  it('omits icon padding when there is no icon', () => {
    const { container } = render(<Input size="sm" placeholder="No icon" />);
    const input = container.querySelector('input')!;
    expect(input.className).not.toContain('pl-9');
  });
});
