/**
 * @vitest-environment happy-dom
 *
 * #897: the age track only renders when some item has an age, so a family
 * timeline doesn't reserve an empty 42px column.
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Timeline } from '@/app/components/Timeline';

const base = { icon: null, title: 'Event' };

describe('Timeline age track (#897)', () => {
    it('drops the age column when no item has an age', () => {
        const { container } = render(<Timeline items={[{ ...base, key: 'a' }, { ...base, key: 'b' }]} />);
        expect(container.querySelector('.tl-med')).toHaveProperty('className', 'tl-med tl-med--no-age');
        expect(container.querySelector('.tl-med-age')).toBeNull();
    });

    it('keeps it on every row when any item has an age', () => {
        const { container } = render(<Timeline items={[{ ...base, key: 'a', ageLabel: '27' }, { ...base, key: 'b' }]} />);
        expect(container.querySelector('.tl-med')).toHaveProperty('className', 'tl-med');
        expect(container.querySelectorAll('.tl-med-age')).toHaveLength(2);
    });
});
