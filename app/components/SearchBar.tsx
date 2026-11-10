'use client';

import type { ReactNode } from 'react';
import { Search, X } from '@/lib/icons';

interface SearchBarProps {
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
    /** aria-label for the clear button. */
    clearLabel: string;
    /** Optional trailing slot (result count, tag select, etc.). */
    trailing?: ReactNode;
}

/**
 * Shared search input used by the Families / People / Cases list pages.
 * Magnifying-glass icon, transparent input, round clear button, optional
 * trailing slot. The shell is the md field recipe (`Input`): 36px, the field
 * radius and border, and no shadow, so every list-page search matches (#748).
 */
export default function SearchBar({ value, onChange, placeholder, clearLabel, trailing }: SearchBarProps) {
    return (
        <div
            className="row mb-2 min-h-9 py-1 px-3 gap-2.5 rounded-md border border-border bg-card focus-ring-within"
            style={{ alignItems: 'center' }}
        >
            <Search width="16" height="16" style={{ color: 'var(--text-muted)', flexShrink: 0 }} aria-hidden="true" />
            <input
                type="text"
                placeholder={placeholder}
                aria-label={placeholder}
                value={value}
                onChange={e => onChange(e.target.value)}
                className="input-nozoom text-base"
                style={{
                    flex: 1,
                    minWidth: 0,
                    background: 'transparent',
                    border: 'none',
                    outline: 'none',
                    color: 'var(--text)',
                }}
            />
            {value && (
                <button
                    type="button"
                    onClick={() => onChange('')}
                    aria-label={clearLabel}
                    className="w-5 h-5 leading-[1]"
                    style={{ flexShrink: 0, borderRadius: '50%', background: 'var(--surface-2)', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                >
                    <X width="11" height="11" aria-hidden="true" />
                </button>
            )}
            {trailing}
        </div>
    );
}
