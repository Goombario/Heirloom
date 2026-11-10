// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button, Badge, Cite, Input, Card, FilterChip, cx } from '@/app/components/ui';

describe('ui primitives render', () => {
  it('Button defaults to the ink primary fill, never an amber one', () => {
    render(<Button>Attach source</Button>);
    const btn = screen.getByRole('button', { name: 'Attach source' });
    expect(btn.className).toContain('bg-primary');
    expect(btn.className).toContain('text-white');
    expect(btn.className).toContain('rounded-btn');
    expect(btn.className).not.toMatch(/accent|evidence/); // #688: amber is never an action colour
  });
  it('Button forwards extra className and size', () => {
    render(<Button size="sm" className="shrink-0">Save</Button>);
    const btn = screen.getByRole('button', { name: 'Save' });
    expect(btn.className).toContain('shrink-0');
    expect(btn.className).toContain('min-h-8'); // sm size: 32px (#693)
  });

  it('Button block is full width', () => {
    render(<Button block>Go</Button>);
    expect(screen.getByRole('button', { name: 'Go' }).className).toContain('w-full');
  });

  it('Cite square renders the number', () => {
    render(<Cite n={3} />);
    expect(screen.getByRole('button', { name: 'View source' }).textContent).toBe('3');
  });

  it('Badge green tag renders success token utilities, not .pill', () => {
    const { container } = render(<Badge tone="green">Matched</Badge>);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain('bg-success-bg');
    expect(el.className).toContain('text-success');
    expect(el.className.split(/\s+/)).not.toContain('pill');
  });

  it('Input renders a token-based field, not input-field class', () => {
    const { container } = render(<Input placeholder="Search" />);
    const input = container.querySelector('input')!;
    expect(input.className).toContain('border-border');
    expect(input.className).toContain('bg-card');
    expect(input.className).not.toContain('input-field');
  });
  it('Card renders token utilities, not the .card class', () => {
    const { container } = render(<Card>hi</Card>);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain('bg-card');
    expect(el.className).toContain('rounded-card');
    expect(el.className).toContain('shadow-card');
    expect(el.className.split(/\s+/)).not.toContain('card');
  });
  it('Card interactive + accent apply their utilities', () => {
    const { container } = render(<Card interactive accent>hi</Card>);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain('card-interactive');
    expect(el.className).not.toContain('shadow-card');
    expect(el.className).toContain('border-l-[3px]');
  });
  it('FilterChip renders its label, active state, and a tabular (not mono) count', () => {
    const { container } = render(<FilterChip label="Living" count={12} active />);
    const btn = container.firstElementChild as HTMLElement;
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(btn.className).toContain('rounded-full');
    expect(btn.textContent).toContain('Living');
    const count = screen.getByText('12');
    expect(count.className).not.toContain('font-mono'); // mono is for dates, times, IDs and key caps only (#762)
    expect(count.className).toContain('tabular-nums');
  });
});

describe('cx', () => {
  it('joins truthy class strings and drops falsy ones', () => {
    expect(cx('a', false, 'b', null, undefined, '', 'c')).toBe('a b c');
  });
  it('returns empty string when all parts are falsy', () => {
    expect(cx(false, null, undefined, '')).toBe('');
  });
});
