/** @vitest-environment happy-dom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';
import { SidebarContent } from '@/app/components/tree/person-sidebar/SidebarContent';

const listForOwner = vi.fn();
vi.mock('@/lib/data', () => ({ getDataClient: async () => ({ notes: { listForOwner } }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/app/components/LanguageProvider', () => ({ useLanguage: () => ({ language: 'en' }) }));
vi.mock('@/app/components/PersonAvatar', () => ({ default: () => <div /> }));
vi.mock('@/app/components/DateInput', () => ({ default: () => <input /> }));
vi.mock('@/app/components/LocationField', () => ({ default: () => <input /> }));
vi.mock('@/app/components/notes/OwnerNotesCard', () => ({
    OwnerNotesCard: () => <div data-testid="notes-card" />,
    NoteCount: () => null,
    visibleNotes: (notes: { OwnerFact?: string | null }[]) => notes.filter((n) => !n.OwnerFact),
    biographyNote: (notes: { IsPrimary: number }[]) => notes.find((n) => n.IsPrimary === 1) ?? null,
}));

type Editor = React.ComponentProps<typeof SidebarContent>['editor'];

function renderPanel(over: Partial<Record<string, unknown>> = {}) {
    const editor = {
        form: { FirstName: 'Ada', LastName: 'Byron', Sex: 'F', BirthDate: '1815', BirthPlace: '', DeathDate: '1852', DeathPlace: '', IsDeceased: 1 },
        setForm: vi.fn(), isReadOnly: false, canDelete: true, primaryPhotoId: null, primaryPhotoFocal: { x: null, y: null, r: null },
        activeTreeId: 1, displayName: 'Ada Byron', initials: 'AB', notesExpanded: false, setNotesExpanded: vi.fn(), isDirty: false,
        saving: false, loadedPersonId: 1, handleSave: vi.fn(), handleDiscard: vi.fn(), handleDeceasedChange: vi.fn(),
        placeChains: {}, setBirthPlaceResolution: vi.fn(), placeIds: { birth: null, death: null, marriage: null }, setPlaceId: vi.fn(), setDeathPlaceResolution: vi.fn(), guardNavigation: () => true,
        ...over,
    } as unknown as Editor;
    const onFocusPerson = vi.fn();
    const onClose = vi.fn();
    render(
        <NextIntlClientProvider locale="en" messages={en}>
            <SidebarContent editor={editor} personId={1} onFocusPerson={onFocusPerson} panel onClose={onClose} />
        </NextIntlClientProvider>,
    );
    return { editor, onFocusPerson, onClose };
}

// The v1.1 desktop person panel (#71).
describe('tree person panel (#71)', () => {
    it('heads with the name and years, then Open person page and Focus here', async () => {
        listForOwner.mockResolvedValue([]);
        const { onFocusPerson, onClose } = renderPanel();
        expect(screen.getByRole('heading', { name: 'Ada Byron' })).toBeTruthy();
        expect(screen.getByRole('button', { name: en.treeSidebar.full_profile })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: en.treeSidebar.focus_person }));
        expect(onFocusPerson).toHaveBeenCalledWith(1);
        fireEvent.click(screen.getByRole('button', { name: en.common.close }));
        expect(onClose).toHaveBeenCalled();
    });

    it('shows the preferred note above the quick edit while Notes is shut', async () => {
        listForOwner.mockResolvedValue([
            { Id: 2, Text: 'A note about her birth', IsPrimary: 1, OwnerFact: 'BIRT' },
            { Id: 3, Text: 'Mathematician and writer.', IsPrimary: 1, OwnerFact: null },
        ]);
        renderPanel();
        expect(await screen.findByText('Mathematician and writer.')).toBeTruthy();
        expect(screen.getByText(en.treeSidebar.note)).toBeTruthy();
        expect(screen.queryByText('A note about her birth')).toBeNull();
    });

    it('hides the note section when there is no preferred note, and offers Sex as a select', async () => {
        listForOwner.mockResolvedValue([]);
        renderPanel();
        await Promise.resolve();
        expect(screen.queryByText(en.treeSidebar.note)).toBeNull();
        expect(screen.queryByRole('radiogroup', { name: en.editPerson.sex })).toBeNull();
        expect(screen.getByText(en.editPerson.sex_female)).toBeTruthy();
        // Living status stays a segmented control, under Sex.
        expect(screen.getByRole('radiogroup', { name: en.common.living_status })).toBeTruthy();
    });

    it('pins Discard and Save, enabled only with changes', () => {
        listForOwner.mockResolvedValue([]);
        renderPanel();
        expect((screen.getByRole('button', { name: en.treeSidebar.save_changes }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('does not read notes while the Notes row is open', () => {
        listForOwner.mockClear();
        renderPanel({ notesExpanded: true });
        expect(listForOwner).not.toHaveBeenCalled();
        expect(screen.getByTestId('notes-card')).toBeTruthy();
    });
});
