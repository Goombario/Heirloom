/** @vitest-environment happy-dom */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { DetailRail } from '@/app/components/ui/DetailRail';

describe('DetailRail', () => {
  it('stacks rail cards on the page, with no grey well', () => {
    const { container } = render(<DetailRail><div>a</div></DetailRail>);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain('person-rail');
    expect(el.className).toContain('flex-col');
    expect(el.className).toContain('gap-4');
    expect(el.className).not.toContain('bg-surface-2');
  });

  it('applies sticky positioning when sticky', () => {
    const { container } = render(<DetailRail sticky><div>a</div></DetailRail>);
    expect((container.firstElementChild as HTMLElement).className).toContain('sticky');
  });
});
