'use client';

import { useState, useEffect, useCallback } from 'react';

/** Tree display preferences, loaded from localStorage on mount. */
export function useTreeDisplayPrefs() {
    const [colorblindMode, setColorblindMode] = useState(false);
    const [showAgeIndicator, setShowAgeIndicatorState] = useState(false);

    // Read persisted prefs after mount (server render + first client paint use the
    // defaults, so there is no hydration mismatch).
    useEffect(() => {
        function loadPrefs() {
            setColorblindMode(localStorage.getItem('treeColorblindMode') === 'true');
            setShowAgeIndicatorState(localStorage.getItem('treeShowAgeIndicator') === 'true');
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

    return { colorblindMode, showAgeIndicator, setShowAgeIndicator };
}
