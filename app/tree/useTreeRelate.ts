'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { getDataClient } from '@/lib/data';
import type { RelationshipResult } from '@/lib/data/types';
import { NO_PAIR, parseRelateParam, shiftPick, type RelatePair } from '@/lib/tree/relate';

/**
 * "How are these two related?" on the tree (#256): Shift-click two people, or start
 * from the person panel's button and click someone. The walk is the Relationship
 * tool's own; the tree only draws it. See lib/tree/relate.ts for the click rules.
 */
export function useTreeRelate({ panelId, treeId }: { panelId: number | null; treeId: number | null }) {
    const searchParams = useSearchParams();
    const [pair, setPair] = useState<RelatePair>(() => parseRelateParam(searchParams.get('relate')));
    // Set while the panel's button waits for the second person: their id is person 1.
    const [picking, setPicking] = useState<number | null>(null);
    // The walk's answer, for the pair it was asked about; an older answer is no answer.
    const [fetched, setFetched] = useState<{ key: string; result: RelationshipResult } | null>(null);
    const [shiftHeld, setShiftHeld] = useState(false);
    const pairKey = pair.first != null && pair.second != null ? `${pair.first},${pair.second}` : null;
    const result = fetched && fetched.key === pairKey ? fetched.result : null;

    const clear = useCallback(() => { setPair(NO_PAIR); setPicking(null); }, []);

    // The Relationship tool's "Show in the tree" opens the tree with the pair; a
    // later link with another pair replaces it (state adjusted during render).
    const relateParam = searchParams.get('relate');
    const [seenParam, setSeenParam] = useState(relateParam);
    if (relateParam !== seenParam) {
        setSeenParam(relateParam);
        const next = parseRelateParam(relateParam);
        if (next.first != null) { setPair(next); setPicking(null); }
    }

    useEffect(() => {
        if (pairKey == null) return;
        const [a, b] = pairKey.split(',').map(Number);
        let live = true;
        void (async () => {
            try {
                const client = await getDataClient();
                const r = await client.relationship.get(a, b, treeId);
                if (live) setFetched({ key: pairKey, result: r });
            } catch {
                if (live) setFetched({ key: pairKey, result: { path: [], relationship: '', degree: -1 } });
            }
        })();
        return () => { live = false; };
    }, [pairKey, treeId]);

    /**
     * A card click. Returns true when the comparison took it (the panel stays as it
     * is); false for a plain click, which clears any comparison and opens the panel.
     */
    const onCardClick = useCallback((id: number, shift: boolean): boolean => {
        if (picking != null) {
            if (id !== picking) setPair({ first: picking, second: id });
            setPicking(null);
            return true;
        }
        if (shift) {
            setPair((p) => shiftPick(p, id, panelId));
            return true;
        }
        if (pair.first != null) clear();
        return false;
    }, [picking, panelId, pair.first, clear]);

    // Esc clears the comparison before it closes anything else (the panel waits
    // for the next one). Shift held shows the hint.
    const active = pair.first != null || picking != null;
    const activeRef = useRef(active);
    useEffect(() => { activeRef.current = active; }, [active]);
    useEffect(() => {
        function onKeyCapture(e: KeyboardEvent) {
            if (e.key === 'Shift') setShiftHeld(true);
            if (e.key !== 'Escape' || !activeRef.current) return;
            const target = e.target instanceof Element ? e.target : null;
            if (target?.closest('[aria-modal="true"], [role="alertdialog"], [aria-expanded="true"]')) return;
            e.preventDefault();
            e.stopPropagation();
            clear();
        }
        function onKeyUp(e: KeyboardEvent) { if (e.key === 'Shift') setShiftHeld(false); }
        function onBlur() { setShiftHeld(false); }
        window.addEventListener('keydown', onKeyCapture, true);
        window.addEventListener('keyup', onKeyUp);
        window.addEventListener('blur', onBlur);
        return () => {
            window.removeEventListener('keydown', onKeyCapture, true);
            window.removeEventListener('keyup', onKeyUp);
            window.removeEventListener('blur', onBlur);
        };
    }, [clear]);

    const path = useMemo(() => result?.path.map((s) => s.id) ?? [], [result]);
    const relate = useMemo(() => (active ? { pair: picking != null ? { first: picking, second: null } : pair, path } : undefined), [active, picking, pair, path]);

    return { pair, picking, result, shiftHeld, relate, clear, onCardClick, startPicking: setPicking };
}
