'use client';

import { useTranslations } from 'next-intl';
import { Compass, LayoutGrid, List } from '@/lib/icons';
import type { PlacesViewMode } from '@/lib/places/view-mode';

export type { PlacesViewMode } from '@/lib/places/view-mode';

// Heights come from --control-h (via `control-h`), the same token the search
// Input beside it uses — the toggle was a hardcoded 44px and so sat taller than
// its neighbour on desktop. The token is 50px on coarse pointers, which keeps the
// tap target above 44px on touch.
export function ViewToggle({ value, onChange }: { value: PlacesViewMode; onChange: (v: PlacesViewMode) => void }) {
    const t = useTranslations('places');
    return (
        <div role="group" aria-label={t('view_toggle_label')} className="inline-flex border border-border rounded-lg overflow-hidden bg-surface">
            <button
                type="button"
                aria-pressed={value === 'explore'}
                onClick={() => onChange('explore')}
                title={t('view_explore')}
                className={`flex items-center gap-1.5 px-3 control-h text-xs font-semibold transition-colors ${
                    value === 'explore' ? 'bg-card text-text shadow-card' : 'text-text-muted hover:text-text'
                }`}
            >
                <Compass size={14} aria-hidden="true" />
                {t('view_explore')}
            </button>
            <button
                type="button"
                aria-pressed={value === 'cards'}
                onClick={() => onChange('cards')}
                title={t('view_cards')}
                className={`flex items-center gap-1.5 px-3 control-h text-xs font-semibold transition-colors ${
                    value === 'cards' ? 'bg-card text-text shadow-card' : 'text-text-muted hover:text-text'
                }`}
            >
                <LayoutGrid size={14} aria-hidden="true" />
                {t('view_cards')}
            </button>
            <button
                type="button"
                aria-pressed={value === 'list'}
                onClick={() => onChange('list')}
                title={t('view_list')}
                className={`flex items-center gap-1.5 px-3 control-h text-xs font-semibold transition-colors ${
                    value === 'list' ? 'bg-card text-text shadow-card' : 'text-text-muted hover:text-text'
                }`}
            >
                <List size={14} aria-hidden="true" />
                {t('view_list')}
            </button>
        </div>
    );
}
