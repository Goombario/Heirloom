/** @vitest-environment happy-dom */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

vi.mock('next-intl', () => ({
  useTranslations: () => Object.assign((key: string) => key, { has: () => false }),
}));
vi.mock('@/lib/data', () => ({ DATA_MODE: 'server' }));
vi.mock('@/app/hooks/useIsMobile', () => ({ useIsMobile: () => true }));

import { AuditFilterBar, type AuditFilters } from '@/app/audit/AuditFilterBar';

const filters: AuditFilters = { entityType: '', action: '', who: null, search: '', sort: 'date', dir: 'desc' };

/** Child links (#788) and data checks (#830) get their own type chips (#847). */
describe('audit log type chips', () => {
  it.each([
    ['filter bar', (onPatch: (p: Partial<AuditFilters>) => void) => (
      <AuditFilterBar filters={filters} onPatch={onPatch} editors={[]} entryDates={new Set()} count={0} />
    )],
  ])('the %s filters to child links and data checks', (_, ui) => {
    const onPatch = vi.fn();
    render(ui(onPatch));
    fireEvent.click(screen.getByRole('button', { name: 'filter_familychild' }));
    expect(onPatch).toHaveBeenLastCalledWith({ entityType: 'familychild' });
    fireEvent.click(screen.getByRole('button', { name: 'filter_datacheck' }));
    expect(onPatch).toHaveBeenLastCalledWith({ entityType: 'datacheck' });
  });
});
