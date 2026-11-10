'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { filterTreePeople, type TreePersonInfo } from './tree-page-helpers';

export function useTreeSearch(allPeople: TreePersonInfo[] | undefined, onSelect: (personId: number) => boolean | void) {
    const [searchQuery, setSearchQueryState] = useState('');
    const [showDropdown, setShowDropdown] = useState(false);
    const [visibleCount, setVisibleCount] = useState(20);
    const searchRef = useRef<HTMLDivElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const allFilteredPeople = filterTreePeople(allPeople ?? [], searchQuery);
    const filteredPeople = allFilteredPeople.slice(0, visibleCount);
    const hasMore = allFilteredPeople.length > visibleCount;

    // Close dropdown when clicking outside
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
                setShowDropdown(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Reset the progressive-reveal window whenever the query changes — done in the
    // setter rather than an effect (avoids a cascading-render setState-in-effect).
    function setSearchQuery(value: string) {
        setSearchQueryState(value);
        setVisibleCount(20);
    }

    function handleDropdownScroll(e: React.UIEvent<HTMLDivElement>) {
        const target = e.target as HTMLDivElement;
        const scrollBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
        if (scrollBottom < 50 && hasMore) {
            setVisibleCount((prev) => prev + 20);
        }
    }

    // Memoized so its identity is stable across the frequent re-renders driven by
    // the search box (searchQuery state). It is passed to TreeVisualization as
    // onPersonDoubleClick, which is a dependency of the node-decoration effect —
    // an unstable identity there rebuilt every tree card on every keystroke.
    // Resets are inlined (rather than calling setSearchQuery) so the only
    // non-setter dependency is the stable onSelect callback. A guarded caller
    // returns false when focus would abandon an in-progress sidebar edit; keep
    // the query/dropdown intact in that case so the attempted selection is not
    // silently consumed.
    const handlePersonSelect = useCallback((personId: number) => {
        if (onSelect(personId) === false) return;
        setShowDropdown(false);
        setSearchQueryState('');
        setVisibleCount(20);
    }, [onSelect]);

    return {
        searchQuery,
        setSearchQuery,
        showDropdown,
        setShowDropdown,
        searchRef,
        dropdownRef,
        filteredPeople,
        allFilteredPeople,
        visibleCount,
        hasMore,
        handleDropdownScroll,
        handlePersonSelect,
    };
}
