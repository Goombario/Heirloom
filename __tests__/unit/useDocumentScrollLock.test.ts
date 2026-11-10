/** @vitest-environment happy-dom */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { acquireDocumentScrollLock, useDocumentScrollLock } from '@/app/hooks/useDocumentScrollLock';

describe('useDocumentScrollLock', () => {
    beforeEach(() => {
        document.body.removeAttribute('style');
        document.documentElement.removeAttribute('style');
        vi.spyOn(window, 'scrollX', 'get').mockReturnValue(120);
        vi.spyOn(window, 'scrollY', 'get').mockReturnValue(640);
        vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('fixes the body at the captured position without hiding overflow and restores it exactly', () => {
        document.body.style.setProperty('position', 'relative', 'important');
        document.body.style.top = '12px';
        document.body.style.left = '7px';
        document.body.style.right = '4px';
        document.body.style.width = '80%';
        document.body.style.overflow = 'auto';
        document.documentElement.style.setProperty('overscroll-behavior', 'contain', 'important');

        const release = acquireDocumentScrollLock();

        expect(document.body.style.position).toBe('fixed');
        expect(document.body.style.top).toBe('-640px');
        expect(document.body.style.left).toBe('-120px');
        expect(document.body.style.right).toBe('0px');
        expect(document.body.style.width).toBe('100%');
        expect(document.body.style.overflow).toBe('auto');
        expect(document.documentElement.style.overscrollBehavior).toBe('contain');

        release();

        expect(document.body.style.getPropertyValue('position')).toBe('relative');
        expect(document.body.style.getPropertyPriority('position')).toBe('important');
        expect(document.body.style.top).toBe('12px');
        expect(document.body.style.left).toBe('7px');
        expect(document.body.style.right).toBe('4px');
        expect(document.body.style.width).toBe('80%');
        expect(document.body.style.overflow).toBe('auto');
        expect(document.documentElement.style.getPropertyValue('overscroll-behavior')).toBe('contain');
        expect(document.documentElement.style.getPropertyPriority('overscroll-behavior')).toBe('important');
        expect(window.scrollTo).toHaveBeenLastCalledWith(120, 640);
    });

    it('keeps the lock active for nested consumers and tolerates duplicate release', () => {
        const firstRelease = acquireDocumentScrollLock();
        const secondRelease = acquireDocumentScrollLock();

        secondRelease();
        secondRelease();
        expect(document.body.style.position).toBe('fixed');
        expect(window.scrollTo).not.toHaveBeenCalledWith(120, 640);

        firstRelease();
        expect(document.body.style.position).toBe('');
        expect(window.scrollTo).toHaveBeenLastCalledWith(120, 640);
    });

    it('restores the initial overscroll behavior after a tree-style acquire', () => {
        document.documentElement.style.overscrollBehavior = 'contain';

        const { unmount } = renderHook(() => useDocumentScrollLock(true, { overscrollBehavior: 'none' }));
        expect(document.documentElement.style.overscrollBehavior).toBe('none');

        unmount();
        expect(document.documentElement.style.overscrollBehavior).toBe('contain');
    });

    it('does not restore a stale route position after a tree-style lock releases', () => {
        const modalRelease = acquireDocumentScrollLock();
        const treeRelease = acquireDocumentScrollLock({ restoreScroll: false });

        treeRelease();
        modalRelease();

        expect(document.body.style.position).toBe('');
        expect(window.scrollTo).not.toHaveBeenCalled();
    });

    it('does not acquire while inactive and acquires when activated', () => {
        const { rerender, unmount } = renderHook(
            ({ active }: { active: boolean }) => useDocumentScrollLock(active),
            { initialProps: { active: false } },
        );

        expect(document.body.style.position).toBe('');
        act(() => rerender({ active: true }));
        expect(document.body.style.position).toBe('fixed');

        unmount();
        expect(document.body.style.position).toBe('');
    });
});
