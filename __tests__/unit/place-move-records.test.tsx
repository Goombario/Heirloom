/** @vitest-environment happy-dom */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom';
import type { PlaceDetail, PlaceFactLinkEntry } from '@/lib/data/types';

const list = vi.fn();
const moveRecords = vi.fn();
const revert = vi.fn();
const showSuccessToast = vi.hoisted(() => vi.fn());

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => (values ? `${key} ${JSON.stringify(values)}` : key),
}));
vi.mock('@/lib/data', () => ({
  getDataClient: async () => ({ places: { list, moveRecords }, audit: { revert } }),
}));
vi.mock('@/app/components/useErrorToast', () => ({ useErrorToast: () => ({ reportError: vi.fn() }) }));
vi.mock('@/app/places/usePlaceFactReason', () => ({
  usePlaceFactReason: () => (link: { kind: string }) => `reason:${link.kind}`,
}));
vi.mock('@/app/components/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/components/ui')>()),
  showSuccessToast,
}));

import { MoveRecordsDialog } from '@/app/places/view/MoveRecords';

function link(over: Partial<PlaceFactLinkEntry>): PlaceFactLinkEntry {
  return {
    personId: 1, name: 'Anna', sex: 'F', primaryMediaId: null, focalX: null, focalY: null, focalRadius: null,
    kind: 'birth', eventType: null, date: null, placeName: 'Paris', recordId: 1, placeId: 10,
    ...over,
  };
}

const detail = {
  name: 'Paris', id: 10, people: [], eventCounts: [], eventCount: 0, familyCount: 1,
  factLinks: [
    link({}),
    link({ personId: 2, name: 'Jan', kind: 'marriage', recordId: 7 }),
    link({ personId: 1, name: 'Anna', kind: 'marriage', recordId: 7 }),
    // A fact on a place within Paris is that place's to move, not this one's.
    link({ personId: 3, name: 'Ivo', recordId: 3, placeId: 11, placeName: 'Montmartre' }),
  ],
} as unknown as PlaceDetail;

function open() {
  const onChanged = vi.fn().mockResolvedValue(undefined);
  const onClose = vi.fn();
  render(<MoveRecordsDialog detail={detail} placeId={10} placeName="Paris" treeId={1} canUndo onChanged={onChanged} onClose={onClose} />);
  return { onChanged, onClose };
}

describe('Move records to another place (#1186)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    list.mockResolvedValue({
      places: [{ id: 12, count: 1 }, { id: 13, count: 9 }],
      gazetteer: [
        { id: 10, name: 'Paris', parentId: null, displayName: null },
        { id: 13, name: 'Lyon', parentId: null, displayName: null },
        { id: 12, name: 'Paris', parentId: 14, displayName: null },
        { id: 14, name: 'Ontario', parentId: null, displayName: null },
      ],
    });
    moveRecords.mockResolvedValue({ moved: 1, auditIds: [55] });
  });

  it('lists the other place of the same name first, and never this place', async () => {
    open();
    const radios = await screen.findAllByRole('radio');
    expect(radios.map((r) => r.closest('label')?.textContent)).toEqual([
      expect.stringContaining('move_records_part_of {"place":"Ontario"}'),
      expect.stringContaining('Lyon'),
      expect.stringContaining('Ontario'),
    ]);
  });

  it("shows this place's own facts once each, and moves only the ticked ones", async () => {
    const user = userEvent.setup();
    const { onChanged, onClose } = open();
    const records = screen.getByRole('group', { name: 'move_records_which' });
    // The marriage names both partners on one row; Ivo's fact belongs to Montmartre.
    expect(within(records).getByText('Jan & Anna')).toBeInTheDocument();
    expect(within(records).queryByText('Ivo')).toBeNull();

    const submit = screen.getByRole('button', { name: /move_records_confirm/ });
    expect(submit).toBeDisabled();
    await user.click((await screen.findAllByRole('radio'))[0]);
    await user.click(within(records).getByRole('checkbox', { name: /Jan & Anna/ }));
    await user.click(screen.getByRole('button', { name: 'move_records_confirm {"count":1}' }));

    await waitFor(() => expect(moveRecords).toHaveBeenCalledWith(10, 12, [{ kind: 'birth', recordId: 1 }], 1));
    expect(onChanged).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    expect(showSuccessToast).toHaveBeenCalledWith('move_records_done {"count":1,"place":"Paris"}', expect.objectContaining({ label: 'undo' }));
  });

  it('moves the whole place when every record stays ticked', async () => {
    const user = userEvent.setup();
    open();
    await user.click((await screen.findAllByRole('radio'))[1]);
    await user.click(screen.getByRole('button', { name: 'move_records_confirm {"count":2}' }));
    await waitFor(() => expect(moveRecords).toHaveBeenCalledWith(10, 13, undefined, 1));
  });
});
