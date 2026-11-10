/** @vitest-environment happy-dom */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';
import { PlaceInUseHint, placeUnused } from '@/app/places/view/PlaceInUse';

const show = (uses: { records: number; places: number; notes: number; media: number }) => render(
    <NextIntlClientProvider locale="en" messages={en}>
        <PlaceInUseHint place="Lviv" uses={uses} />
    </NextIntlClientProvider>,
);

// #1229: a place can be deleted only when nothing uses it; otherwise it says what does.
describe('PlaceInUseHint', () => {
    it('lists what uses the place and points at Move records', () => {
        show({ records: 2, places: 1, notes: 0, media: 1 });
        expect(screen.getByText(
            `Lviv can't be deleted while it still has 2 records, 1 place within it, and 1 photo or file. ${en.places.delete_place_move_first}`,
        )).toBeInTheDocument();
    });

    it('leaves Move records out when no records use it', () => {
        show({ records: 0, places: 3, notes: 0, media: 0 });
        expect(screen.getByText("Lviv can't be deleted while it still has 3 places within it.")).toBeInTheDocument();
    });

    it('counts a place nothing uses as unused', () => {
        expect(placeUnused({ records: 0, places: 0, notes: 0, media: 0 })).toBe(true);
        expect(placeUnused({ records: 0, places: 0, notes: 1, media: 0 })).toBe(false);
    });
});
