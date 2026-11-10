/** @vitest-environment happy-dom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';
import VitalsSection from '@/app/components/person-form/VitalsSection';
import type { UsePersonForm } from '@/app/components/person-form/usePersonForm';
import { FormSection } from '@/app/components/ui';

vi.mock('@/app/components/DateInput', () => ({ default: () => <input aria-label="date" /> }));
vi.mock('@/app/components/LocationField', () => ({ default: () => <input aria-label="place" /> }));

// #548: citations are fact-scoped, so a fact's date, place and cause share one
// pin, placed on the fact's heading rather than repeated on every field.
describe('form citation pins, one per fact', () => {
    it('puts one Birth and one Death pin on the group headings', () => {
        const cite = vi.fn((fact: string) => <span data-testid={`pin-${fact}`} />);
        const fm = {
            form: { BirthDate: '', BirthPlace: '', DeathDate: '', DeathPlace: '', DeathCause: '' },
            setField: vi.fn(), cite,
            setBirthPlaceResolution: vi.fn(), placeIds: { birth: null, death: null, marriage: null }, setPlaceId: vi.fn(), setDeathPlaceResolution: vi.fn(),
            birthPlaceInitialChain: null, deathPlaceInitialChain: null,
        } as unknown as UsePersonForm;
        render(
            <NextIntlClientProvider locale="en" messages={en}>
                <VitalsSection fm={fm} treeId={1} />
            </NextIntlClientProvider>,
        );

        expect(cite.mock.calls.map(([fact]) => fact)).toEqual(['Birth', 'Death']);
        expect(screen.getByTestId('pin-Birth').parentElement?.textContent).toBe(en.editPerson.section_birth);
        expect(screen.getByTestId('pin-Death').parentElement?.textContent).toBe(en.editPerson.section_death);
    });

    it('renders a section-level pin beside the section title', () => {
        render(<FormSection title="Started" cite={<span data-testid="pin" />}><input /></FormSection>);
        expect(screen.getByTestId('pin').previousElementSibling?.textContent).toBe('Started');
    });
});

// #896: an editor's empty pin is the add-source cue and always shows. A viewer's
// search-only pin (#1028) stays out of sight on read views until its row is
// hovered or focused, and stays in the tab order. Forms never hide pins.
describe('unsourced pins', () => {
    it('keeps an editor\'s empty pin shown and focusable', async () => {
        const { default: Cite } = await import('@/app/components/Cite');
        render(
            <NextIntlClientProvider locale="en" messages={en}>
                <Cite empty factLabel="Birth" onClick={vi.fn()} />
            </NextIntlClientProvider>,
        );
        const pin = screen.getByRole('button', { name: 'Attach source for birth' });
        expect(pin.classList.contains('cite-hover-pin')).toBe(false);
        expect(pin.tabIndex).toBe(0);
    });

    it('marks a viewer\'s search pin for the reveal rule', async () => {
        const { default: Cite } = await import('@/app/components/Cite');
        render(
            <NextIntlClientProvider locale="en" messages={en}>
                <Cite empty searchOnly factLabel="Birth" onClick={vi.fn()} />
            </NextIntlClientProvider>,
        );
        const pin = screen.getByRole('button', { name: 'Search records for birth' });
        expect(pin.classList.contains('cite-hover-pin')).toBe(true);
        expect(pin.tabIndex).toBe(0);
    });

    it('names the "+" after cited chips as another source and hides it on touch (#900)', async () => {
        const { default: Cite } = await import('@/app/components/Cite');
        render(
            <NextIntlClientProvider locale="en" messages={en}>
                <Cite more factLabel="Birth" onClick={vi.fn()} />
            </NextIntlClientProvider>,
        );
        const pin = screen.getByRole('button', { name: 'Attach another source for birth' });
        expect(pin.classList.contains('cite-hover-pin')).toBe(true);
        expect(pin.classList.contains('cite-more-pin')).toBe(true);
        const { readFileSync } = await import('node:fs');
        expect(readFileSync('app/globals.css', 'utf8')).toMatch(/@media \(hover: none\), \(pointer: coarse\) \{\s*\.cite-more-pin \{ display: none; \}/);
    });

    it('hides revealed pins at rest only in read-view fact rows, never on forms', async () => {
        const { readFileSync } = await import('node:fs');
        const css = readFileSync('app/globals.css', 'utf8');
        expect(css).toContain(':is(.tl-med-ev, tr) .cite-hover-pin { opacity: 0; }');
        expect(css).toContain(':is(.tl-med-ev, tr):is(:hover, :focus-within) .cite-hover-pin');
        expect(css).not.toContain('sources-cited-empty');
        expect(readFileSync('app/components/ui/FormField.tsx', 'utf8')).not.toContain('cite-reveal');
    });
});
