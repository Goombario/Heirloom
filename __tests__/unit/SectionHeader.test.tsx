/** @vitest-environment happy-dom */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { SectionHeader } from '@/app/components/ui/SectionHeader';

describe('SectionHeader', () => {
  it('renders an h2 section title by default', () => {
    const { container, getByText } = render(<SectionHeader title="Life events" />);
    const h = container.querySelector('h2');
    expect(h).toBeInTheDocument();
    expect(h!.className).toContain('section');
    expect(getByText('Life events')).toBeInTheDocument();
  });

  it('renders an h3 rail heading when level="rail"', () => {
    const { container } = render(<SectionHeader level="rail" title="Relationships" />);
    expect(container.querySelector('h3')).toBeInTheDocument();
    expect(container.querySelector('h2')).toBeNull();
  });

  it('shows a muted count suffix only when count > 0', () => {
    const { getByText, queryByText, rerender } = render(<SectionHeader title="Gallery" count={0} />);
    expect(queryByText('(0)')).toBeNull();
    rerender(<SectionHeader title="Gallery" count={3} />);
    expect(getByText('(3)')).toBeInTheDocument();
  });

  it('renders the action node and the subtitle', () => {
    const { getByText } = render(
      <SectionHeader title="Names" subtitle="Other names for X" action={<button>Add</button>} />,
    );
    expect(getByText('Add')).toBeInTheDocument();
    expect(getByText('Other names for X')).toBeInTheDocument();
  });
});
