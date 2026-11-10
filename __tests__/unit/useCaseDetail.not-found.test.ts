/**
 * @vitest-environment happy-dom
 *
 * A missing case renders RecordNotFound in place; it never silently pushes to
 * the Cases list (#697). Mocks as in useCaseDetail.draft-transition.test.ts, so
 * no PGlite — safe in test:fast.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { NotFoundError } from '@/lib/data/errors';

const casesGet = vi.fn();
const client = { cases: { get: casesGet } };
vi.mock('@/lib/data', () => ({
    DATA_MODE: 'remote',
    getDataClient: () => Promise.resolve(client),
}));

vi.mock('@/app/contexts/TreeContext', () => ({
    useTree: () => ({ activeOwnerId: 99, activePermission: 'owner' }),
}));

const pushMock = vi.fn();
const replaceMock = vi.fn();
const routerObj = { replace: replaceMock, push: pushMock };
const searchParams = { get: (k: string) => (k === 'id' ? '99999' : null) };
vi.mock('next/navigation', () => ({
    useRouter: () => routerObj,
    useSearchParams: () => searchParams,
}));

const stableT = (key: string) => key;
vi.mock('next-intl', () => ({ useTranslations: () => stableT }));

import { useCaseDetail } from '@/app/cases/view/useCaseDetail';

describe('useCaseDetail missing case', () => {
    it('flags notFound instead of redirecting to the list', async () => {
        casesGet.mockRejectedValue(new NotFoundError('Case not found'));

        const { result } = renderHook(() => useCaseDetail());

        await waitFor(() => expect(result.current.notFound).toBe(true));
        expect(result.current.loading).toBe(false);
        expect(result.current.fetchError).toBeNull();
        expect(pushMock).not.toHaveBeenCalled();
        expect(replaceMock).not.toHaveBeenCalled();
    });
});
