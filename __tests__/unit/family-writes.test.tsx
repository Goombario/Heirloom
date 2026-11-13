/** @vitest-environment happy-dom */

import React, { type ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import en from '@/messages/en.json';

const push = vi.fn();
const showChangeToast = vi.fn();
const client = {
  families: { remove: vi.fn(), update: vi.fn() },
  people: { create: vi.fn() },
  audit: { revert: vi.fn(async () => undefined) },
};
vi.mock('@/lib/data', () => ({ getDataClient: async () => client }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/app/components/ui', () => ({ showChangeToast: (t: unknown) => showChangeToast(t) }));
vi.mock('@/app/components/useErrorToast', () => ({ useErrorToast: () => ({ reportError: vi.fn() }) }));

import { useFamilyWrites } from '@/app/families/view/desktop/familyWrites';

const wrapper = ({ children }: { children: ReactNode }) => <NextIntlClientProvider locale="en" messages={en}>{children}</NextIntlClientProvider>;
// A run that does what useChange does with the write: run it, report failure as false.
const run = vi.fn(async (write: () => Promise<{ auditIds: number[] }>) => { try { await write(); return true; } catch { return false; } });
const hook = (role: 'contributor' | 'editor' = 'editor') => renderHook(() => useFamilyWrites({
  familyId: 7, partner1: null, partner2: null, name: 'Johan & Kristina Lindqvist', treeId: 1, role, run,
}), { wrapper }).result.current;

beforeEach(() => { vi.clearAllMocks(); });

describe('desktop family writes (#119)', () => {
  it('deletes the family, goes back to Families and offers Undo that reopens it', async () => {
    client.families.remove.mockResolvedValue({ auditId: 55 });
    expect(await hook().deleteFamily()).toBe(true);
    expect(push).toHaveBeenCalledWith('/families');
    const toast = showChangeToast.mock.calls[0][0] as { message: string; onUndo?: () => Promise<void> };
    expect(toast.message).toBe('Johan & Kristina Lindqvist deleted');
    await toast.onUndo?.();
    expect(client.audit.revert).toHaveBeenCalledWith([55], 1);
    expect(push).toHaveBeenLastCalledWith('/families/view?id=7');
  });

  it('gives a contributor no Undo on a delete', async () => {
    client.families.remove.mockResolvedValue({ auditId: 55 });
    await hook('contributor').deleteFamily();
    expect((showChangeToast.mock.calls[0][0] as { onUndo?: unknown }).onUndo).toBeUndefined();
  });

  it('takes back a person created in the finder when linking them fails', async () => {
    client.people.create.mockResolvedValue({ Id: 9, auditIds: [101] });
    client.families.update.mockRejectedValue(new Error('nope'));
    const ok = await hook().setPartner('partner2', { kind: 'new', draft: { firstName: 'Greta', lastName: 'Berg', sex: null, birthDate: null } });
    expect(ok).toBe(false);
    expect(client.audit.revert).toHaveBeenCalledWith([101], 1);
  });
});
