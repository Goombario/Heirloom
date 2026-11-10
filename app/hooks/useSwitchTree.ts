'use client';

import { useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useTree, type TreeSelection } from '@/app/contexts/TreeContext';
import { useUnsavedChangesGuard } from '@/app/components/UnsavedChangesProvider';
import { treeSwitchTarget } from '@/lib/tree-switch-target';

/**
 * Switches the active tree the way the user meant it (#916): an open edit asks
 * first, as leaving the page does, and a record page goes to its section's
 * list, since the record belongs to the tree being left. Returns false when the
 * user kept their unsaved changes.
 */
export function useSwitchTree() {
    const { switchTree, switchToDefaultTree } = useTree();
    const router = useRouter();
    const pathname = usePathname();
    const { guardNavigation } = useUnsavedChangesGuard(false);

    return useCallback((selection: TreeSelection | null) => {
        if (!guardNavigation()) return false;
        const target = treeSwitchTarget(pathname ?? '/', typeof window === 'undefined' ? '' : window.location.search);
        if (target) router.push(target);
        if (selection) switchTree(selection);
        else switchToDefaultTree();
        return true;
    }, [guardNavigation, pathname, router, switchTree, switchToDefaultTree]);
}
