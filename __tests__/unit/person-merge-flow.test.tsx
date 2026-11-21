/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import '@testing-library/jest-dom';
import en from '@/messages/en.json';
import type { MergePreview, MergeSide } from '@/lib/data/types';

vi.mock('@/app/components/LanguageProvider', () => ({ useLanguage: () => ({ language: 'en' }) }));
const mobile = vi.hoisted(() => ({ value: false }));
vi.mock('@/app/hooks/useIsMobile', () => ({ useIsMobile: () => mobile.value }));

const previewMerge = vi.fn();
const merge = vi.fn();
vi.mock('@/lib/data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/data')>()),
  getDataClient: async () => ({ people: { previewMerge, merge, listFlagged: async () => [], search: async () => [], get: async () => null } }) as unknown as Awaited<
    ReturnType<typeof import('@/lib/data').getDataClient>
  >,
}));

import { PersonMergeFlow } from '@/app/components/person-merge/PersonMergeFlow';

const side = (over: Partial<MergeSide>): MergeSide => ({
  Id: 1, FirstName: 'Anna', LastName: 'Lindqvist', DisplayFirstName: 'Anna', Sex: null, IsDeceased: null,
  BirthDate: null, BirthPlace: null, BirthPlaceId: null, DeathDate: null, DeathPlace: null, DeathPlaceId: null,
  CreatedAt: null, Imported: false, BirthSources: 0, DeathSources: 0,
  Counts: { events: 0, citations: 0, notes: 0, photos: 0, cases: 0, familyLinks: 0, names: 0 },
  ...over,
});

function renderFlow(preview: MergePreview, onMerged = vi.fn()) {
  previewMerge.mockResolvedValue(preview);
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <PersonMergeFlow open onClose={() => {}} person={{ Id: 1, FirstName: 'Anna Maria', LastName: 'Lindqvist' }} otherId={2} treeId={7} onMerged={onMerged} />
    </NextIntlClientProvider>,
  );
  return onMerged;
}

describe('PersonMergeFlow (#28)', () => {
  beforeEach(() => { previewMerge.mockReset(); merge.mockReset(); mobile.value = false; });

  it('shows each differing field and merges with the values picked', async () => {
    const a = side({ Id: 1, FirstName: 'Anna Maria', Sex: 'F' });
    const b = side({ Id: 2, Sex: null, Counts: { events: 2, citations: 6, notes: 1, photos: 3, cases: 1, familyLinks: 2, names: 0 } });
    merge.mockResolvedValue({ keptId: 1, auditIds: [9] });
    const onMerged = renderFlow({ a, b, differing: ['name', 'sex'], blocked: null });

    expect(await screen.findByRole('heading', { name: 'Merge two people' })).toBeInTheDocument();
    expect(screen.getByText('3 fields match and aren\'t shown.')).toBeInTheDocument();
    expect(screen.getByText('Also moves: 2 events, 6 citations, 1 note, 3 photos, 1 case, 2 family links')).toBeInTheDocument();

    // Take the other record's sex.
    fireEvent.click(screen.getByRole('radio', { name: /Unknown/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }));
    await waitFor(() => expect(merge).toHaveBeenCalledWith({ keptId: 1, otherId: 2, take: { sex: 'other' } }, 7));
    expect(await screen.findByRole('heading', { name: 'Anna Lindqvist was merged into Anna Maria Lindqvist' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onMerged).toHaveBeenCalledWith(1);
  });

  it('keeping the other record moves every pick to it', async () => {
    merge.mockResolvedValue({ keptId: 2, auditIds: [9] });
    renderFlow({ a: side({ Id: 1, FirstName: 'Anna Maria' }), b: side({ Id: 2 }), differing: ['name'], blocked: null });
    fireEvent.click(await screen.findByRole('radio', { name: /Merge away/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }));
    await waitFor(() => expect(merge).toHaveBeenCalledWith({ keptId: 2, otherId: 1, take: {} }, 7));
  });

  it('a blocked pair says why and links the family instead of merging', async () => {
    renderFlow({ a: side({ Id: 1, FirstName: 'Johan', LastName: 'Berg' }), b: side({ Id: 2, FirstName: 'Johann', LastName: 'Berg' }), differing: ['name'], blocked: { reason: 'partners', familyId: 44 } });
    expect(await screen.findByRole('heading', { name: 'These two can\'t be merged' })).toBeInTheDocument();
    expect(screen.getByText(/are the two partners in the same family/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the family' })).toHaveAttribute('href', '/families/view?id=44');
    expect(screen.queryByRole('button', { name: 'Merge' })).toBeNull();
  });
});
