/** @vitest-environment happy-dom */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { DetailHero } from '@/app/components/ui/DetailHero';

describe('DetailHero', () => {
  it('is the hero-dark island with the shared bottom margin', () => {
    const { container } = render(<DetailHero><span>hero</span></DetailHero>);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain('hero-dark');
    expect(el.className).toContain('mb-[24px]');
  });

  it('appends caller className (consumer override wins)', () => {
    const { container } = render(<DetailHero className="hero-flex hidden md:flex">x</DetailHero>);
    expect((container.firstElementChild as HTMLElement).className).toContain('hero-flex');
  });

  it('tone="light" renders a Card surface, not the hero-dark island', () => {
    const { container } = render(<DetailHero tone="light">x</DetailHero>);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).not.toContain('hero-dark');
    expect(el.className).toContain('bg-card');
  });
});
