/** @vitest-environment happy-dom */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { PageShell, PAGE_COLUMN } from '@/app/components/ui/PageShell';

describe('PageShell', () => {
  it('renders one <main> with a list column and a page-title h1', () => {
    const { container, getByRole } = render(
      <PageShell title="People" subtitle="19 people" actions={<button>Add person</button>}>
        <p>body</p>
      </PageShell>,
    );
    expect(container.querySelectorAll('main')).toHaveLength(1);
    const h1 = getByRole('heading', { level: 1, name: 'People' });
    expect(h1).toHaveClass('title');
    expect(container.textContent).toContain('19 people');
    expect(getByRole('button', { name: 'Add person' })).toBeInTheDocument();
    expect(container.querySelector('main > div')!.className).toContain('max-w-[1240px]');
  });

  it('uses the 1240 column for detail and renders no h1 of its own', () => {
    const { container } = render(<PageShell variant="detail"><h1>Rosa</h1></PageShell>);
    expect(container.querySelector('main > div')!.className).toContain('max-w-[1240px]');
    expect(container.querySelectorAll('h1')).toHaveLength(1);
  });

  it('is full width for workspace, with no column around the children', () => {
    const { container } = render(<PageShell variant="workspace"><div data-testid="canvas" /></PageShell>);
    const main = container.querySelector('main')!;
    expect(main.getAttribute('data-page-shell')).toBe('workspace');
    expect(main.firstElementChild!.getAttribute('data-testid')).toBe('canvas');
  });

  it('renders the top bar outside the content column', () => {
    const { container } = render(
      <PageShell variant="detail" topBar={<div data-testid="bar" />}><p>form</p></PageShell>,
    );
    expect(container.querySelector('main')!.firstElementChild!.getAttribute('data-testid')).toBe('bar');
  });

  it('marks the shell busy for loading paints', () => {
    const { container } = render(<PageShell variant="detail" busy />);
    expect(container.querySelector('main')).toHaveAttribute('aria-busy', 'true');
  });

  it('exposes the column classes for chrome that aligns with it', () => {
    // The nav, the tree toolbar and every page share the boards' 1240 column.
    expect(PAGE_COLUMN.workspace).toBe(PAGE_COLUMN.list);
  });
});
