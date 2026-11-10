/** @vitest-environment happy-dom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { Menu, Trash2 } from '@/lib/icons';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/' }));

import { GlassButton, MobileRow, CopperPill } from '@/app/components/ui';

describe('GlassButton (#1057)', () => {
  it('names an icon-only button by its label and a pill by its word', () => {
    render(<>
      <GlassButton label="Menu" icon={<Menu />} />
      <GlassButton label="Open the tree" icon={<Menu />} word="Tree" />
    </>);
    expect(screen.getByRole('button', { name: 'Menu' })).toHaveClass('w-[34px]');
    expect(screen.getByRole('button', { name: 'Tree' })).toHaveAttribute('title', 'Open the tree');
  });

  it('renders a link when it navigates', () => {
    render(<GlassButton label="Back" icon={<Menu />} href="/people" />);
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/people');
  });
});

describe('MobileRow (#1057)', () => {
  it('makes an action row from an icon tile, with a chevron for a next step', () => {
    const onClick = vi.fn();
    const { container } = render(<MobileRow icon={<Trash2 />} label="Edit birth" end="chevron" onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit birth' }));
    expect(onClick).toHaveBeenCalledOnce();
    expect(container.querySelectorAll('svg')).toHaveLength(2);
  });

  it('marks a multi-select row as a checkbox', () => {
    render(<MobileRow label="Karl Halvorsen" checked={false} onClick={vi.fn()} />);
    expect(screen.getByRole('checkbox', { name: 'Karl Halvorsen' })).toHaveAttribute('aria-checked', 'false');
  });

  it('gives a one-tap suggestion a plus and no checkbox', () => {
    const { container } = render(<MobileRow label="Hilda Halvorsen" suggestion onClick={vi.fn()} aria-label="Add Hilda as a child" />);
    expect(screen.getByRole('button', { name: 'Add Hilda as a child' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(container.querySelectorAll('svg')).toHaveLength(1);
  });

  it('leaves a content row without an end icon', () => {
    const { container } = render(<MobileRow label="A note" sub="12 Mar 2026" onClick={vi.fn()} />);
    expect(container.querySelector('svg')).toBeNull();
    expect(screen.getByText('12 Mar 2026')).toBeInTheDocument();
  });
});

describe('CopperPill (#1057)', () => {
  it('slides a floating pill away on scroll down and back on a flick up', () => {
    render(<CopperPill floating>Add person</CopperPill>);
    const pill = screen.getByRole('button', { name: 'Add person' });
    const scrollTo = (y: number) => act(() => {
      Object.defineProperty(window, 'scrollY', { value: y, configurable: true });
      window.dispatchEvent(new Event('scroll'));
    });
    scrollTo(100);
    scrollTo(200);
    expect(pill).toHaveAttribute('data-hidden', 'true');
    scrollTo(180);
    expect(pill).not.toHaveAttribute('data-hidden');
    scrollTo(300);
    scrollTo(10);
    expect(pill).not.toHaveAttribute('data-hidden');
  });

  it('never hides a pill inside content', () => {
    render(<CopperPill>Save</CopperPill>);
    act(() => {
      Object.defineProperty(window, 'scrollY', { value: 500, configurable: true });
      window.dispatchEvent(new Event('scroll'));
    });
    expect(screen.getByRole('button', { name: 'Save' })).not.toHaveAttribute('data-hidden');
  });
});
