/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const hasBackupWorthyData = vi.fn();
vi.mock('@/lib/data', () => ({ DATA_MODE: 'local' }));
vi.mock('next/navigation', () => ({ usePathname: () => '/people' }));
vi.mock('@/lib/db/connection.pglite', () => ({ hasBackupWorthyData: () => hasBackupWorthyData() }));

import { useLocalHasData, __resetLocalHasData } from '@/app/components/backup/useLocalHasData';
import { dataCache } from '@/lib/data/cache';

describe('useLocalHasData (#1269)', () => {
  beforeEach(() => {
    __resetLocalHasData();
    hasBackupWorthyData.mockReset();
  });

  it('shares one check between the components that ask, and keeps a yes until a write', async () => {
    hasBackupWorthyData.mockResolvedValue(true);
    const a = renderHook(() => useLocalHasData());
    const b = renderHook(() => useLocalHasData());
    await waitFor(() => expect(a.result.current).toBe(true));
    await waitFor(() => expect(b.result.current).toBe(true));
    const c = renderHook(() => useLocalHasData());
    await waitFor(() => expect(c.result.current).toBe(true));
    expect(hasBackupWorthyData).toHaveBeenCalledTimes(1);

    dataCache.clear();
    const d = renderHook(() => useLocalHasData());
    await waitFor(() => expect(d.result.current).toBe(true));
    expect(hasBackupWorthyData).toHaveBeenCalledTimes(2);
  });

  it('checks again after a no, so the first person shows up on the next navigation', async () => {
    hasBackupWorthyData.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const a = renderHook(() => useLocalHasData());
    await waitFor(() => expect(a.result.current).toBe(false));
    const b = renderHook(() => useLocalHasData());
    await waitFor(() => expect(b.result.current).toBe(true));
    expect(hasBackupWorthyData).toHaveBeenCalledTimes(2);
  });
});
