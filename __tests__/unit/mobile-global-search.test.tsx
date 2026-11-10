/** @vitest-environment happy-dom */

import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', () => ({
    useTranslations: () => (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key),
}));
vi.mock('@/app/components/PersonAvatar', () => ({ default: () => null }));

import { MobileGlobalSearch } from '@/app/components/search/MobileGlobalSearch';
import type { SearchResult } from '@/app/components/GlobalSearch';

const person = (id: number, title: string, place?: string): SearchResult => ({
    type: 'person', id, title, lifespan: { birth: '1880', death: null }, place,
    avatars: [{ key: `p${id}`, initials: 'X', sex: 'F' }],
});
const base = {
    onQuery: vi.fn(), onCancel: vi.fn(), inputRef: createRef<HTMLInputElement>(), stale: false,
    treeId: 1, treeName: 'Halvorsen family', onSelect: vi.fn(), onRetry: vi.fn(),
};

describe('MobileGlobalSearch (#1128)', () => {
    it('says what it searches before any typing', () => {
        render(<MobileGlobalSearch {...base} query="" state="idle" results={[]} />);
        expect(screen.getByText('phone_intro_tree:{"tree":"Halvorsen family"}')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'cancel' })).toBeInTheDocument();
    });

    it('marks the matched words, folding accents, and shows the town that matched', () => {
        render(<MobileGlobalSearch {...base} query="vaxjo" state="results" results={[person(1, 'Kristina Berg', 'Kronoberg, Växjö, Sweden')]} />);
        const mark = screen.getByText('Växjö');
        expect(mark.tagName).toBe('MARK');
        expect(screen.queryByText(/Sweden/)).not.toBeInTheDocument();
    });

    it('caps people at six, then Show all opens the rest', () => {
        const rows = Array.from({ length: 8 }, (_, i) => person(i + 1, `Halvorsen ${i + 1}`));
        render(<MobileGlobalSearch {...base} query="halv" state="results" results={rows} />);
        // The <mark> splits the name, so read the rows' text rather than their accessible names.
        const names = () => screen.getAllByRole('button').map((b) => b.textContent ?? '').filter((s) => s.startsWith('Halvorsen'));
        expect(names()).toHaveLength(6);
        fireEvent.click(screen.getByRole('button', { name: 'show_all_people:{"count":8}' }));
        expect(names()).toHaveLength(8);
    });

    it('gives a one-partner family the dashed disc and Partner not recorded', () => {
        const fam: SearchResult = { type: 'family', id: 9, title: 'Thomas Marsh', avatars: [
            { key: 'a', initials: 'TM', sex: 'M' }, { key: 'b', initials: '?', sex: null, placeholder: true },
        ] };
        render(<MobileGlobalSearch {...base} query="marsh" state="results" results={[fam]} />);
        expect(screen.getByText('partner_not_recorded')).toBeInTheDocument();
        expect(screen.getByTestId('search-avatar-placeholder')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /Marsh/ }));
        expect(base.onSelect).toHaveBeenCalledWith(fam);
    });

    it('says No one called … with the hint when nothing matches', () => {
        render(<MobileGlobalSearch {...base} query="Pettersen" state="empty" results={[]} />);
        expect(screen.getByText('no_one_called:{"query":"Pettersen"}')).toBeInTheDocument();
        expect(screen.getByText('no_one_hint')).toBeInTheDocument();
    });
});
