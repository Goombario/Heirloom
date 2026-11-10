/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { EntityLabelText } from '@/app/components/EntityLabelText';

const bold = (c: HTMLElement) => Array.from(c.querySelectorAll('.font-semibold')).map(n => n.textContent);

describe('EntityLabelText', () => {
    it('emphasises only the name in "Citation — Name · fact"', () => {
        const { container } = render(<EntityLabelText label="Citation — Hazel Bracken · birth" />);
        expect(container.textContent).toBe('Citation — Hazel Bracken · birth');
        expect(bold(container)).toEqual(['Hazel Bracken']);
    });

    it('keeps a "·" inside a name when there is no type prefix', () => {
        const { container } = render(<EntityLabelText label="Aster · Lumen" />);
        expect(bold(container)).toEqual(['Aster · Lumen']);
    });

    it('splits "Type — Name" without a suffix', () => {
        const { container } = render(<EntityLabelText label="Adoption — Cecilia Rose" />);
        expect(bold(container)).toEqual(['Cecilia Rose']);
    });
});
