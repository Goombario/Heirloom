/**
 * @vitest-environment happy-dom
 *
 * #797 (ED-7, M-2): the inline event editor ends with the shared record-editor
 * action row, and below md it opens in a bottom sheet with the date qualifier
 * stacked above the date and the notes rail without its own card.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

const useIsMobile = vi.hoisted(() => vi.fn().mockReturnValue(false));

const client = {
    events: { create: vi.fn(), update: vi.fn() },
    people: { update: vi.fn() },
    places: { pinChains: vi.fn().mockResolvedValue({}), geocodeUpsert: vi.fn(), geocodeUpsertHierarchy: vi.fn() },
};

vi.mock('@/lib/data', () => ({ getDataClient: () => Promise.resolve(client) }));
vi.mock('@/app/contexts/TreeContext', () => ({ useTree: () => ({ activeTreeId: 99, activePermission: 'owner' }) }));
const stableT = (key: string) => key;
vi.mock('next-intl', () => ({ useTranslations: () => stableT }));
vi.mock('@/app/components/LanguageProvider', () => ({ useLanguage: () => ({ language: 'en', setLanguage: vi.fn() }) }));
vi.mock('@/app/hooks/useIsMobile', () => ({ useIsMobile }));
vi.mock('@/app/components/LocationField', () => ({
    __esModule: true,
    default: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
        <input placeholder="place" value={value} onChange={(e) => onChange(e.target.value)} />
    ),
}));
vi.mock('@/app/components/media/OwnerMediaCard', () => ({ OwnerMediaCard: () => null }));
// Vaul's drawer needs real layout; a stand-in keeps this about what goes in it.
vi.mock('@/app/components/ui/Sheet', () => ({
    Sheet: ({ title, children }: { title: string; children: React.ReactNode }) => (
        <div data-testid="sheet" aria-label={title}>{children}</div>
    ),
}));

import InlineEventEditor from '@/app/components/InlineEventEditor';

/** The desktop event panel's save button: "Add event" for a new event, "Save changes" for an edit. */
const SAVE = /^(add_event|save_changes)$/;

function renderEdit() {
    return render(
        <InlineEventEditor
            target={{ kind: 'person', personId: 4 }}
            event={{ Id: 12, Type: 'OCCU', Date: 'ABT 1880', Place: null, Description: null } as never}
            onCancel={() => {}}
            onSaved={() => {}}
            onDelete={() => {}}
            notesSlot={<div className="card" data-testid="notes-rail" />}
        />,
    );
}

beforeEach(() => useIsMobile.mockReturnValue(false));

describe('InlineEventEditor action row and mobile sheet (#797)', () => {
    it('puts Delete on the left, and Cancel then the copper Save on the right (locked board)', () => {
        renderEdit();
        const del = screen.getByRole('button', { name: 'delete_event' });
        const save = screen.getByRole('button', { name: SAVE });
        const cancel = screen.getByRole('button', { name: 'cancel' });
        const buttons = [del, cancel, save];
        const order = Array.from(document.querySelectorAll('button')).filter((b) => buttons.includes(b));
        expect(order).toEqual(buttons);
        // Save and Cancel share the right-aligned group; Delete stays outside it.
        expect(save.parentElement).toBe(cancel.parentElement);
        expect(save.parentElement).toHaveClass('ml-auto');
        expect(del.parentElement).not.toBe(save.parentElement);
    });

    it('renders inline on desktop, with focus in its first field (#798, KB-2)', () => {
        renderEdit();
        expect(screen.queryByTestId('sheet')).toBeNull();
        // Headed as on the locked board ("Edit baptism"); the heading names the group.
        const panel = screen.getByRole('group', { name: 'edit_named' });
        expect(screen.getByRole('heading', { name: 'edit_named' })).toBeInTheDocument();
        expect(panel).toHaveClass('inline-panel');
        expect(panel.contains(document.activeElement)).toBe(true);
        expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'field_type' }));
    });

    it('opens in a sheet below md, with the qualifier stacked and the notes rail flat', () => {
        useIsMobile.mockReturnValue(true);
        renderEdit();
        const sheet = screen.getByTestId('sheet');
        expect(sheet).toHaveAttribute('aria-label', 'editing_event');
        expect(sheet.querySelector('.inline-panel')).toBeNull();
        const qualifier = screen.getByRole('combobox', { name: 'qualifier_label' });
        expect(qualifier.closest('.flex-col')).not.toBeNull();
        expect(screen.getByTestId('notes-rail').closest('.sheet-flat')).not.toBeNull();
    });
});
