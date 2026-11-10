/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';

const h = vi.hoisted(() => ({ push: vi.fn(), switchTree: vi.fn(), switchToDefaultTree: vi.fn(), pathname: '/people/view' }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: h.push }), usePathname: () => h.pathname }));
vi.mock('@/app/contexts/TreeContext', () => ({ useTree: () => ({ switchTree: h.switchTree, switchToDefaultTree: h.switchToDefaultTree }) }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

import { UnsavedChangesProvider, useUnsavedChangesGuard } from '@/app/components/UnsavedChangesProvider';
import { useSwitchTree } from '@/app/hooks/useSwitchTree';

const selection = { treeId: 7, permission: 'view' as const, treeName: 'Shared' };

function renderSwitch(dirty: boolean) {
    const wrapper = ({ children }: { children: ReactNode }) => <UnsavedChangesProvider>{children}</UnsavedChangesProvider>;
    return renderHook(() => {
        useUnsavedChangesGuard(dirty);
        return useSwitchTree();
    }, { wrapper });
}

afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    h.pathname = '/people/view';
});

describe('useSwitchTree (#916)', () => {
    it('leaves a record page for its list and switches', () => {
        const { result } = renderSwitch(false);
        expect(result.current(selection)).toBe(true);
        expect(h.push).toHaveBeenCalledWith('/people');
        expect(h.switchTree).toHaveBeenCalledWith(selection);
    });

    it('stays on a list page', () => {
        h.pathname = '/families';
        const { result } = renderSwitch(false);
        result.current(null);
        expect(h.push).not.toHaveBeenCalled();
        expect(h.switchToDefaultTree).toHaveBeenCalledTimes(1);
    });

    it('asks first with unsaved edits, and switches nothing when the user stays', () => {
        const confirm = vi.fn().mockReturnValue(false);
        vi.stubGlobal('confirm', confirm);
        const { result } = renderSwitch(true);
        expect(result.current(selection)).toBe(false);
        expect(confirm).toHaveBeenCalledWith('unsaved_changes_confirm');
        expect(h.push).not.toHaveBeenCalled();
        expect(h.switchTree).not.toHaveBeenCalled();
    });
});
