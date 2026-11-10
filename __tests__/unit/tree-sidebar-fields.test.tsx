/** @vitest-environment happy-dom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';
import { SidebarContent } from '@/app/components/tree/person-sidebar/SidebarContent';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/app/components/LanguageProvider', () => ({ useLanguage: () => ({ language: 'en' }) }));
vi.mock('@/app/components/PersonAvatar', () => ({ default: () => <div /> }));
vi.mock('@/app/components/DateInput', () => ({ default: () => <input /> }));
vi.mock('@/app/components/LocationField', () => ({ default: () => <input /> }));
vi.mock('@/app/components/notes/OwnerNotesCard', () => ({ OwnerNotesCard: () => null, NoteCount: () => null, visibleNotes: () => [] }));

type Editor = React.ComponentProps<typeof SidebarContent>['editor'];

function renderSidebar(readOnly = false) {
    const editor = {
        form: { FirstName: 'Ada', LastName: 'Byron', Sex: 'F', BirthDate: '', BirthPlace: '', DeathDate: '', DeathPlace: '', IsDeceased: 1 },
        setForm: vi.fn(), isReadOnly: readOnly, canDelete: true, primaryPhotoId: null, primaryPhotoFocal: { x: null, y: null, r: null },
        activeTreeId: 1, displayName: 'Ada Byron', initials: 'AB', notesExpanded: false, setNotesExpanded: vi.fn(), isDirty: false,
        saving: false, loadedPersonId: 1, handleSave: vi.fn(), handleDiscard: vi.fn(), handleDeceasedChange: vi.fn(),
        placeChains: {}, setBirthPlaceResolution: vi.fn(), placeIds: { birth: null, death: null, marriage: null }, setPlaceId: vi.fn(), setDeathPlaceResolution: vi.fn(), guardNavigation: () => true,
    } as unknown as Editor;
    return render(
        <NextIntlClientProvider locale="en" messages={en}>
            <SidebarContent editor={editor} personId={1} onFocusPerson={vi.fn()} />
        </NextIntlClientProvider>,
    );
}

const optionNames = (group: HTMLElement) => within(group).getAllByRole('radio').map((r) => r.textContent);

describe('tree sidebar fields (#761)', () => {
    it('says "Sex", never "Gender", in sentence case', () => {
        renderSidebar();
        expect(screen.getByText(en.editPerson.sex)).toBeTruthy();
        expect(screen.queryByText(/gender/i)).toBeNull();
    });

    it('uses the person editor’s segmented controls and option order, Unknown first', () => {
        renderSidebar();
        const sex = screen.getByRole('radiogroup', { name: en.editPerson.sex });
        expect(optionNames(sex)).toEqual([en.common.unknown, en.editPerson.sex_male, en.editPerson.sex_female, en.editPerson.sex_nonbinary]);
        expect(within(sex).getByRole('radio', { name: en.editPerson.sex_female }).getAttribute('aria-checked')).toBe('true');
        const living = screen.getByRole('radiogroup', { name: en.common.living_status });
        expect(optionNames(living)).toEqual([en.common.unknown, en.common.living, en.common.deceased]);
        expect(within(living).getByRole('radio', { name: en.common.deceased }).getAttribute('aria-checked')).toBe('true');
    });

    it('disables the controls for a read-only viewer', () => {
        renderSidebar(true);
        for (const radio of within(screen.getByRole('radiogroup', { name: en.editPerson.sex })).getAllByRole('radio')) {
            expect((radio as HTMLButtonElement).disabled).toBe(true);
        }
    });
});
