/** @vitest-environment happy-dom */

import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SourceTypeIcon, SOURCE_TYPES } from '@/app/library/sourceTypes';

// The Library source card shows a type glyph instead of a dashed "scan" placeholder (#765).
describe('SourceTypeIcon', () => {
  const glyph = (sourceType: string | null) =>
    render(<SourceTypeIcon sourceType={sourceType} />).container.querySelector('svg')?.getAttribute('class') ?? '';

  it('gives every known source type its own glyph', () => {
    const classes = SOURCE_TYPES.map((type) => glyph(type));
    expect(new Set(classes).size).toBe(SOURCE_TYPES.length);
  });

  it('treats a missing type as a Document and a custom type as the generic scroll', () => {
    expect(glyph(null)).toBe(glyph('Document'));
    expect(glyph('Probate bundle')).toBe(glyph('Other'));
  });
});
