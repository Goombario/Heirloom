/** @vitest-environment happy-dom */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

vi.mock('next-intl', () => ({
  useTranslations: () => Object.assign((key: string) => key, { has: () => false }),
}));
vi.mock('@/lib/data', () => ({ DATA_MODE: 'server' }));
vi.mock('@/app/hooks/useIsMobile', () => ({ useIsMobile: () => false }));

import { AuditFilterBar, type AuditFilters } from '@/app/audit/AuditFilterBar';

const filters: AuditFilters = { entityType: '', action: '', who: null, search: '', sort: 'date', dir: 'desc' };

/** Child links (#788) and data checks (#830) get their own types (#847); a Type select since #59. */
describe('audit log type filter', () => {
  it.each([
    ['filter bar', (onPatch: (p: Partial<AuditFilters>) => void) => (
      <AuditFilterBar filters={filters} onPatch={onPatch} editors={[]} entryDates={new Set()} />
    )],
  ])('the %s filters to child links and data checks', (_, ui) => {
    const onPatch = vi.fn();
    render(ui(onPatch));
    const pick = (name: string) => {
      fireEvent.click(screen.getByRole('button', { name: /col_type/ }));
      fireEvent.click(screen.getByRole('option', { name }));
    };
    pick('filter_familychild');
    expect(onPatch).toHaveBeenLastCalledWith({ entityType: 'familychild' });
    pick('filter_datacheck');
    expect(onPatch).toHaveBeenLastCalledWith({ entityType: 'datacheck' });
  });
});
