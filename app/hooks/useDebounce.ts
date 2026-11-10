import { useEffect, useState } from 'react';

/**
 * Returns a debounced copy of `value` that only updates after `delay`ms of no
 * changes. Useful for search inputs so we don't fire a request (and re-render)
 * on every keystroke.
 */
export function useDebounce<T>(value: T, delay = 300): T {
    const [debounced, setDebounced] = useState(value);

    useEffect(() => {
        const id = setTimeout(() => setDebounced(value), delay);
        return () => clearTimeout(id);
    }, [value, delay]);

    return debounced;
}
