/** @vitest-environment happy-dom */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import en from '@/messages/en.json';
import { LedgerTimeline, type LedgerItem } from '@/app/components/ui';

const item = (year: number | null, title: string): LedgerItem => ({ key: title, year: year == null ? '?' : String(year), sortYear: year, title });
const life = [
  item(1894, 'Birth'), item(1909, 'Confirmation'), item(1912, 'Emigration'), item(1919, 'Marriage'), item(1920, 'Child 1'),
  item(1922, 'Child 2'), item(1925, 'Child 3'), item(1940, 'Census'), item(1971, 'Death'), item(null, 'Occupation'),
];
const ledger = (keep: string[]) => render(
  <NextIntlClientProvider locale="en" messages={en}><LedgerTimeline items={life} keep={keep} /></NextIntlClientProvider>,
);
const titles = () => [...document.querySelectorAll('.ledger__title')].map((t) => t.textContent);

describe('LedgerTimeline (v1.1 person board)', () => {
  it('folds after five rows into "N more events" with the hidden years, keeping the pinned rows in view', () => {
    ledger(['Death', 'Occupation']);
    expect(titles()).toEqual(['Birth', 'Confirmation', 'Emigration', 'Marriage', 'Child 1', 'Death', 'Occupation']);
    const fold = screen.getByRole('button', { name: /Show 3 more events/ });
    expect(fold).toHaveTextContent('1922 – 1940');
    fireEvent.click(fold);
    expect(titles()).toHaveLength(10);
    fireEvent.click(screen.getByRole('button', { name: en.detailKit.show_fewer }));
    expect(titles()).toHaveLength(7);
  });

  it('folds each hidden run on its own, around a kept row in the middle', () => {
    ledger(['Census']);
    expect(titles()).toEqual(['Birth', 'Confirmation', 'Emigration', 'Marriage', 'Child 1', 'Census']);
    const folds = screen.getAllByRole('button', { name: /more events/ });
    expect(folds.map((f) => f.textContent)).toEqual(['…2 more events1922 – 1925', '…2 more events1971']);
  });

  it('does not fold a list that would hide a single row', () => {
    render(<NextIntlClientProvider locale="en" messages={en}><LedgerTimeline items={life.slice(0, 6)} /></NextIntlClientProvider>);
    expect(titles()).toHaveLength(6);
    expect(screen.queryByRole('button', { name: /more events/ })).toBeNull();
  });
});
