/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

const harness = vi.hoisted(() => ({
  queue: null as null | Record<string, unknown>,
  confirm: vi.fn(),
  undo: vi.fn(),
  reload: vi.fn(),
  bulkConfirm: vi.fn(),
  getDataClient: vi.fn(),
  success: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  translations: [] as Array<{ key: string; values?: Record<string, number> }>,
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, number>) => {
    harness.translations.push({ key, values });
    return key;
  },
}));
vi.mock('@/lib/data', () => ({ getDataClient: harness.getDataClient }));
vi.mock('@/app/components/SkeletonLoader', () => ({ Skeleton: () => <div data-testid="skeleton" /> }));
vi.mock('@/app/components/ui', () => ({
  Banner: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Button: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) => <button {...props}>{children}</button>,
  EmptyState: ({ title, message, action }: { title: string; message: string; action: React.ReactNode }) => <div><h2>{title}</h2><p>{message}</p>{action}</div>,
  SectionHeader: ({ title, subtitle }: { title: React.ReactNode; subtitle?: React.ReactNode }) => <div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>,
  SegmentedControl: () => null,
  showSuccessToast: harness.success,
  showInfoToast: harness.info,
  showErrorToast: harness.error,
}));
vi.mock('@/app/library/faces/FaceQueuePanel', () => ({
  faceQueueGroupAnchor: (key: string) => `face-${key}`,
  default: ({ confirmAllCount, onConfirmAll }: { confirmAllCount: number; onConfirmAll: () => void }) => (
    <button type="button" disabled={confirmAllCount === 0} onClick={onConfirmAll}>confirm-all</button>
  ),
}));
vi.mock('@/app/library/faces/FaceDecisionRows', () => ({
  FaceRowsHeader: () => null,
  FaceSettledRow: () => <div data-testid="settled" />,
  FaceResolvedRow: () => null,
  FaceDecisionRow: ({ row, actions }: { row: unknown; actions: { onTag: (row: unknown) => void } }) => (
    <button type="button" onClick={() => actions.onTag(row)}>group-confirm</button>
  ),
}));
vi.mock('@/app/components/lightbox/MediaLightbox', () => ({ default: () => null }));
vi.mock('@/app/library/faces/useFaceQueue', () => ({
  useFaceQueue: () => harness.queue,
}));

import FacesPanel from '@/app/library/faces/FacesPanel';

const group = (ids: number[]) => ({
  groupKey: `group-${ids[0]}`,
  sourceName: 'Ada',
  matchKind: 'exact' as const,
  suggestedPerson: { id: 9, name: 'Ada', birthYear: null, deathYear: null, sex: null, mediaId: null, focalX: null, focalY: null, focalRadius: null },
  candidateCount: ids.length,
  candidates: ids.map(Id => ({ Id })),
  ambiguousPersonCount: null,
  ambiguousCandidates: [],
});

function response(results: Array<{ candidateId: number; status: 'confirmed' | 'skipped' | 'failed' }>) {
  return {
    results: results.map(item => item.status === 'confirmed'
      ? { ...item, tagId: item.candidateId + 100 }
      : item.status === 'skipped'
        ? { ...item, code: 'already_resolved' as const }
        : { ...item, code: 'confirm_failed' as const, retryable: true as const }),
    requestedCount: results.length,
    confirmedCount: results.filter(item => item.status === 'confirmed').length,
    skippedCount: results.filter(item => item.status === 'skipped').length,
    failedCount: results.filter(item => item.status === 'failed').length,
  };
}

function renderPanel(groups = [group([1, 2])]) {
  harness.queue = {
    groups,
    pendingTotal: groups.reduce((sum, item) => sum + item.candidateCount, 0),
    resolvedTotal: 0,
    loading: false,
    error: null,
    confirm: harness.confirm,
    dismiss: vi.fn(),
    undo: harness.undo,
    reload: harness.reload,
  };
  render(<FacesPanel treeId={7} canEdit />);
}

beforeEach(() => {
  harness.confirm.mockReset();
  harness.undo.mockReset().mockResolvedValue({ restored: 1, skipped: 0 });
  harness.reload.mockReset().mockResolvedValue(undefined);
  harness.bulkConfirm.mockReset();
  harness.getDataClient.mockReset().mockResolvedValue({ media: { confirmFaces: harness.bulkConfirm } });
  harness.success.mockReset();
  harness.info.mockReset();
  harness.error.mockReset();
  harness.translations = [];
});

afterEach(cleanup);

describe('FacesPanel confirmation outcomes', () => {
  it.each([
    ['all confirmed', response([{ candidateId: 1, status: 'confirmed' }, { candidateId: 2, status: 'confirmed' }]), 'toast_confirmed_all', 'success'],
    ['partial', response([{ candidateId: 1, status: 'confirmed' }, { candidateId: 2, status: 'failed' }]), 'toast_confirmed_partial', 'info'],
    ['all failed', response([{ candidateId: 1, status: 'failed' }, { candidateId: 2, status: 'failed' }]), 'toast_confirmed_failed', 'error'],
    ['all skipped', response([{ candidateId: 1, status: 'skipped' }, { candidateId: 2, status: 'skipped' }]), 'toast_confirmed_skipped', 'info'],
  ])('shows one translated message for %s and offers Undo only for confirmed items', async (_label, result, message, tone) => {
    harness.confirm.mockResolvedValueOnce(result);
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: 'group-confirm' }));
    await waitFor(() => expect(harness.confirm).toHaveBeenCalledWith([1, 2], 9));

    const toast = harness[tone as 'success' | 'info' | 'error'];
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0]).toBe(message);
    if (result.confirmedCount > 0) {
      const options = toast.mock.calls[0][1];
      expect(options.label).toBe('action_undo');
      options.onClick();
      const confirmedIds = result.results.filter(item => item.status === 'confirmed').map(item => item.candidateId);
      await waitFor(() => expect(harness.undo).toHaveBeenCalledWith(confirmedIds));
    } else {
      expect(toast.mock.calls[0][1]).toBeUndefined();
      expect(harness.undo).not.toHaveBeenCalled();
    }
  });

  it('keeps a request-wide exception as an error', async () => {
    harness.confirm.mockRejectedValueOnce(new Error('permission denied'));
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: 'group-confirm' }));
    await waitFor(() => expect(harness.error).toHaveBeenCalledWith('action_failed'));
    expect(harness.success).not.toHaveBeenCalled();
    expect(harness.info).not.toHaveBeenCalled();
  });

  it('continues bulk confirmation, aggregates item results, reloads once, and undoes confirmed IDs only', async () => {
    harness.bulkConfirm
      .mockResolvedValueOnce(response([{ candidateId: 1, status: 'confirmed' }, { candidateId: 2, status: 'failed' }]))
      .mockResolvedValueOnce(response([{ candidateId: 3, status: 'confirmed' }, { candidateId: 4, status: 'skipped' }]));
    renderPanel([group([1, 2]), group([3, 4])]);

    fireEvent.click(await screen.findByRole('button', { name: 'confirm-all' }));
    await waitFor(() => expect(harness.bulkConfirm).toHaveBeenCalledTimes(2));
    expect(harness.bulkConfirm).toHaveBeenNthCalledWith(1, [1, 2], 9, 7);
    expect(harness.bulkConfirm).toHaveBeenNthCalledWith(2, [3, 4], 9, 7);
    expect(harness.reload).toHaveBeenCalledTimes(1);
    expect(harness.info).toHaveBeenCalledWith('toast_confirmed_partial', expect.anything());

    const options = harness.info.mock.calls[0][1];
    options.onClick();
    await waitFor(() => expect(harness.undo).toHaveBeenCalledWith([1, 3]));
  });

  it('reports a later request-wide group failure as retryable items and still runs later groups', async () => {
    harness.bulkConfirm
      .mockResolvedValueOnce(response([{ candidateId: 1, status: 'confirmed' }, { candidateId: 2, status: 'confirmed' }]))
      .mockRejectedValueOnce(new Error('preflight failed'))
      .mockResolvedValueOnce(response([{ candidateId: 5, status: 'confirmed' }]));
    renderPanel([group([1, 2]), group([3, 4]), group([5])]);

    fireEvent.click(await screen.findByRole('button', { name: 'confirm-all' }));
    await waitFor(() => expect(harness.bulkConfirm).toHaveBeenCalledTimes(3));
    expect(harness.reload).toHaveBeenCalledTimes(1);
    expect(harness.info).toHaveBeenCalledWith('toast_confirmed_partial', expect.anything());
    expect(harness.translations).toContainEqual({
      key: 'toast_confirmed_partial',
      values: { confirmed: 3, failed: 2, skipped: 0 },
    });

    const options = harness.info.mock.calls[0][1];
    options.onClick();
    await waitFor(() => expect(harness.undo).toHaveBeenCalledWith([1, 2, 5]));
    expect(harness.error).not.toHaveBeenCalled();
  });
});
