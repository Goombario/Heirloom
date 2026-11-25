'use client';

import { useState, useEffect, useCallback } from 'react';
import { TREE_SPACINGS, TREE_ARRANGEMENTS, type TreeSpacing, type TreeArrangement } from '@/lib/tree/geometry';
import { TREE_SECOND_NAME_TYPES, TREE_UNDER_NAME, type TreeSecondNameType, type TreeUnderName } from '@/app/components/tree/types';

/** A stored "Second name" choice, or null for none (also for anything unrecognised). */
function parseSecondNameType(value: string | null): TreeSecondNameType | null {
    return (TREE_SECOND_NAME_TYPES as readonly string[]).includes(value ?? '') ? value as TreeSecondNameType : null;
}

/** A stored "Under the name" choice; dates (today's cards) for anything unrecognised. */
function parseUnderName(value: string | null): TreeUnderName {
    return (TREE_UNDER_NAME as readonly string[]).includes(value ?? '') ? value as TreeUnderName : 'dates';
}

/** A stored Spacing choice (#249); Normal (today's gaps) for anything unrecognised. */
function parseSpacing(value: string | null): TreeSpacing {
    return (TREE_SPACINGS as readonly string[]).includes(value ?? '') ? value as TreeSpacing : 'normal';
}

/** Tree display preferences, loaded from localStorage on mount. */
export function useTreeDisplayPrefs() {
    const [colorblindMode, setColorblindModeState] = useState(false);
    const [showAgeIndicator, setShowAgeIndicatorState] = useState(false);
    const [showStatusMark, setShowStatusMarkState] = useState(true);
    const [secondNameType, setSecondNameTypeState] = useState<TreeSecondNameType | null>(null);
    const [underName, setUnderNameState] = useState<TreeUnderName>('dates');
    const [spacing, setSpacingState] = useState<TreeSpacing>('normal');
    const [arrangement, setArrangementState] = useState<TreeArrangement>('compact');

    // Read persisted prefs after mount (server render + first client paint use the
    // defaults, so there is no hydration mismatch).
    useEffect(() => {
        function loadPrefs() {
            setColorblindModeState(localStorage.getItem('treeColorblindMode') === 'true');
            setShowAgeIndicatorState(localStorage.getItem('treeShowAgeIndicator') === 'true');
            // On unless turned off (#68), so trees look as they did before the switch.
            setShowStatusMarkState(localStorage.getItem('treeShowStatusMark') !== 'false');
            setSecondNameTypeState(parseSecondNameType(localStorage.getItem('treeSecondName')));
            setUnderNameState(parseUnderName(localStorage.getItem('treeUnderName')));
            setSpacingState(parseSpacing(localStorage.getItem('treeSpacing')));
            const storedArrangement = localStorage.getItem('treeArrangement');
            setArrangementState((TREE_ARRANGEMENTS as readonly string[]).includes(storedArrangement ?? '') ? storedArrangement as TreeArrangement : 'compact');
            // Debug-only card styles with no switch anywhere, removed by #271.
            localStorage.removeItem('treeRoundedPhotos');
            localStorage.removeItem('treeGreyscaleMode');
        }
        loadPrefs();
    }, []);

    // "Show ages" lives in the tree's Display controls (#271); same per-device key
    // the old Options › Experimental switch wrote, so existing choices carry over.
    const setShowAgeIndicator = useCallback((value: boolean) => {
        setShowAgeIndicatorState(value);
        localStorage.setItem('treeShowAgeIndicator', String(value));
    }, []);

    // Branch shape markers; moved here from Options › Tree display, same per-device key.
    const setColorblindMode = useCallback((value: boolean) => {
        setColorblindModeState(value);
        localStorage.setItem('treeColorblindMode', String(value));
    }, []);

    // The living-status mark on the cards (#68): off hides only the mark, never a card.
    const setShowStatusMark = useCallback((value: boolean) => {
        setShowStatusMarkState(value);
        localStorage.setItem('treeShowStatusMark', String(value));
    }, []);

    // The second name line on vertical cards: a name type, or null for none (today's cards).
    const setSecondNameType = useCallback((value: TreeSecondNameType | null) => {
        setSecondNameTypeState(value);
        if (value) localStorage.setItem('treeSecondName', value);
        else localStorage.removeItem('treeSecondName');
    }, []);

    // The line under the name (#12): dates (today's cards) or one fact, per device.
    const setUnderName = useCallback((value: TreeUnderName) => {
        setUnderNameState(value);
        if (value === 'dates') localStorage.removeItem('treeUnderName');
        else localStorage.setItem('treeUnderName', value);
    }, []);

    // Spacing (#249): a layout input, per device; Normal is today's gaps.
    const setSpacing = useCallback((value: TreeSpacing) => {
        setSpacingState(value);
        if (value === 'normal') localStorage.removeItem('treeSpacing');
        else localStorage.setItem('treeSpacing', value);
    }, []);

    // Arrangement (#250): a layout input, per device; Compact is today's packing.
    const setArrangement = useCallback((value: TreeArrangement) => {
        setArrangementState(value);
        if (value === 'compact') localStorage.removeItem('treeArrangement');
        else localStorage.setItem('treeArrangement', value);
    }, []);

    return {
        arrangement, setArrangement,
        spacing, setSpacing,
        underName, setUnderName,
        colorblindMode, setColorblindMode, showAgeIndicator, setShowAgeIndicator, showStatusMark, setShowStatusMark,
        secondNameType, setSecondNameType,
    };
}
