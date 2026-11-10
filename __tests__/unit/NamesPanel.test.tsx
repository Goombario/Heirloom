/** @vitest-environment happy-dom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';
import { NamesPanel } from '@/app/components/person-form/NamesPanel';

vi.mock('@/app/components/LanguageProvider', () => ({ useLanguage: () => ({ language: 'en', setLanguage: vi.fn() }) }));
import type { PersonWithRelations } from '@/lib/db/schema';

function renderPanel() {
    return render(
        <NextIntlClientProvider locale="en" messages={en}>
            <NamesPanel
                person={{ Id: 3, FirstName: 'Ada', LastName: 'Lovelace', DeathDate: null } as PersonWithRelations}
                variants={[]}
                renderCitePin={() => null}
                canEdit
                canDelete
                onAdd={vi.fn(async () => {})}
                onRename={vi.fn(async () => {})}
                onRemove={vi.fn(async () => {})}
                onSetPrimary={vi.fn(async () => {})}
            />
        </NextIntlClientProvider>,
    );
}

function renderContributorPanel() {
    const onRename = vi.fn(async () => {});
    render(
        <NextIntlClientProvider locale="en" messages={en}>
            <NamesPanel
                person={{ Id: 3, FirstName: 'Ada', LastName: 'Lovelace', DeathDate: null } as PersonWithRelations}
                variants={[{ Id: 4, PersonId: 3, Type: 'Alias', Name: 'Augusta', FromDate: null, ToDate: null }]}
                renderCitePin={() => null}
                canEdit
                canDelete={false}
                onAdd={vi.fn(async () => {})}
                onRename={onRename}
                onRemove={vi.fn(async () => {})}
                onSetPrimary={vi.fn(async () => {})}
            />
        </NextIntlClientProvider>,
    );
    return { onRename };
}

describe('NamesPanel collections pattern (#760)', () => {
    it('ends with an Add name row that opens the add panel with a named value field', () => {
        renderPanel();
        expect(screen.queryByRole('textbox')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: en.personDetail.add_name }));
        expect(document.querySelector('select')).toBeNull();
        expect(screen.getByRole('button', { name: new RegExp(en.personDetail.col_type) })).toBeTruthy();
        const field = screen.getByRole('textbox', { name: en.personDetail.variant_add_name });
        expect(field.getAttribute('name')).toBe('name-variant-value');
    });

    it('adds the typed name with the chosen type, then closes the panel', () => {
        const onAdd = vi.fn(async () => {});
        render(
            <NextIntlClientProvider locale="en" messages={en}>
                <NamesPanel
                    person={{ Id: 3, FirstName: 'Ada', LastName: 'Lovelace', DeathDate: null } as PersonWithRelations}
                    variants={[]}
                    renderCitePin={() => null}
                    canEdit
                    canDelete
                    onAdd={onAdd}
                    onRename={vi.fn(async () => {})}
                    onRemove={vi.fn(async () => {})}
                    onSetPrimary={vi.fn(async () => {})}
                />
            </NextIntlClientProvider>,
        );
        fireEvent.click(screen.getByRole('button', { name: en.personDetail.add_name }));
        fireEvent.change(screen.getByRole('textbox', { name: en.personDetail.variant_add_name }), { target: { value: 'Byron' } });
        fireEvent.click(screen.getByRole('button', { name: new RegExp(en.personDetail.col_type) }));
        fireEvent.click(screen.getByRole('option', { name: en.personDetail.vtype_maiden }));
        fireEvent.click(screen.getAllByRole('button', { name: en.personDetail.add_name })[0]);
        expect(onAdd).toHaveBeenCalledWith('Maiden', 'Byron', { FromDate: null, ToDate: null });
        expect(screen.queryByRole('textbox')).toBeNull();
    });

    it('keeps contributor rename/add/primary controls but hides variant removal', () => {
        const { onRename } = renderContributorPanel();
        fireEvent.click(screen.getByRole('button', { name: en.common.edit_named.replace('{name}', 'Augusta') }));
        const field = screen.getByRole('textbox', { name: en.personDetail.variant_edit_name });
        fireEvent.change(field, { target: { value: 'Augusta Ada' } });
        fireEvent.click(screen.getByRole('button', { name: en.common.save_changes }));
        expect(onRename).toHaveBeenCalledWith(4, 'Augusta Ada', { FromDate: null, ToDate: null });
        expect(screen.getByRole('button', { name: en.personDetail.add_name })).toBeTruthy();
        expect(screen.queryByRole('button', { name: en.common.remove_named.replace('{name}', 'Augusta') })).toBeNull();
    });

    it('edits a variant\'s "dates used" range (#898)', () => {
        const { onRename } = renderContributorPanel();
        fireEvent.click(screen.getByRole('button', { name: en.common.edit_named.replace('{name}', 'Augusta') }));
        const from = screen.getByLabelText(en.personDetail.variant_used_from);
        fireEvent.change(from, { target: { value: '1890' } });
        fireEvent.blur(from);
        fireEvent.click(screen.getByRole('button', { name: en.common.save_changes }));
        expect(onRename).toHaveBeenCalledWith(4, 'Augusta', { FromDate: '1890', ToDate: null });
    });
});

describe('NamesPanel display (#898)', () => {
    function renderRead(variants: Array<{ FromDate: string | null; ToDate: string | null }>) {
        render(
            <NextIntlClientProvider locale="en" messages={en}>
                <NamesPanel
                    person={{ Id: 3, FirstName: 'Ada', LastName: 'Lovelace', DeathDate: null } as PersonWithRelations}
                    variants={variants.map((d, i) => ({ Id: 10 + i, PersonId: 3, Type: 'Alias' as const, Name: `Alias ${i}`, ...d }))}
                    renderCitePin={(table, id) => <button type="button">{`pin ${table} ${id}`}</button>}
                    canEdit={false}
                    canDelete={false}
                    onAdd={vi.fn(async () => {})}
                    onRename={vi.fn(async () => {})}
                    onRemove={vi.fn(async () => {})}
                    onSetPrimary={vi.fn(async () => {})}
                />
            </NextIntlClientProvider>,
        );
    }

    it('formats stored dates, never showing raw GEDCOM', () => {
        renderRead([
            { FromDate: 'ABT 1890', ToDate: '1902' },
            { FromDate: '1890-03', ToDate: null },
            { FromDate: null, ToDate: null },
        ]);
        expect(screen.queryByText(/ABT/)).toBeNull();
        expect(screen.getByText(/1890 – 1902/)).toBeTruthy();
        expect(screen.getByText(en.personDetail.dates_from.replace('{date}', 'Mar 1890'))).toBeTruthy();
        expect(screen.getByText(en.personDetail.throughout_life)).toBeTruthy();
    });

    it('puts each cite pin beside its name and has no Source column', () => {
        renderRead([{ FromDate: null, ToDate: null }]);
        expect(screen.getAllByRole('columnheader').map((th) => th.textContent)).not.toContain('Source');
        const pin = screen.getByRole('button', { name: /pin NameVariant 10/ });
        expect(pin.closest('td')?.textContent).toContain('Alias 0');
    });
});
