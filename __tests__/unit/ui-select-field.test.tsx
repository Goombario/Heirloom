/** @vitest-environment happy-dom */
import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

import { SelectField } from '@/app/components/ui/Select';

const OPTIONS = [
    { value: 'MDY', label: 'Month first' },
    { value: 'DMY', label: 'Day first' },
    { value: 'YMD', label: 'Year first' },
] as const;
type V = typeof OPTIONS[number]['value'];

function Harness({ onChange = () => {}, disabled = false }: { onChange?: (v: V) => void; disabled?: boolean }) {
    const [value, setValue] = useState<V>('DMY');
    return (
        <>
            <label htmlFor="fmt">Date format</label>
            <SelectField<V> id="fmt" value={value} options={OPTIONS} disabled={disabled}
                onChange={(v) => { setValue(v); onChange(v); }} />
        </>
    );
}

const trigger = () => screen.getByRole('combobox', { name: /date format/i });

describe('SelectField', () => {
    it('is named by its label and shows the selected option', () => {
        render(<Harness />);
        expect(trigger()).toHaveTextContent('Day first');
        expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    });

    it('opens on click with the selected option marked, and picks by click', () => {
        const onChange = vi.fn();
        render(<Harness onChange={onChange} />);
        fireEvent.click(trigger());
        expect(screen.getByRole('listbox')).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Day first' })).toHaveAttribute('aria-selected', 'true');
        fireEvent.click(screen.getByRole('option', { name: 'Year first' }));
        expect(onChange).toHaveBeenCalledWith('YMD');
        expect(screen.queryByRole('listbox')).toBeNull();
        expect(trigger()).toHaveTextContent('Year first');
    });

    it('walks with the arrow keys and chooses with Enter', () => {
        const onChange = vi.fn();
        render(<Harness onChange={onChange} />);
        fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
        const active = () => trigger().getAttribute('aria-activedescendant');
        expect(document.getElementById(active()!)).toHaveTextContent('Day first');
        fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
        expect(document.getElementById(active()!)).toHaveTextContent('Year first');
        fireEvent.keyDown(trigger(), { key: 'Home' });
        fireEvent.keyDown(trigger(), { key: 'Enter' });
        expect(onChange).toHaveBeenCalledWith('MDY');
    });

    it('closes on Escape without choosing, and keeps the Escape from bubbling', () => {
        const onChange = vi.fn();
        const outer = vi.fn();
        const onDoc = (e: KeyboardEvent) => { if (e.key === 'Escape') outer(); };
        document.addEventListener('keydown', onDoc);
        render(<Harness onChange={onChange} />);
        fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
        fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
        fireEvent.keyDown(trigger(), { key: 'Escape' });
        document.removeEventListener('keydown', onDoc);
        expect(screen.queryByRole('listbox')).toBeNull();
        expect(onChange).not.toHaveBeenCalled();
        expect(outer).not.toHaveBeenCalled();
    });

    it('jumps by typed prefix', () => {
        const onChange = vi.fn();
        render(<Harness onChange={onChange} />);
        fireEvent.keyDown(trigger(), { key: 'y' });
        fireEvent.keyDown(trigger(), { key: 'Enter' });
        expect(onChange).toHaveBeenCalledWith('YMD');
    });

    it('does not open when disabled', () => {
        render(<Harness disabled />);
        expect(trigger()).toBeDisabled();
        fireEvent.click(trigger());
        expect(screen.queryByRole('listbox')).toBeNull();
    });

    it('renders group headings for grouped options', () => {
        render(<SelectField value="a" onChange={() => {}} aria-label="Zone"
            groups={[{ key: 'eu', label: 'Europe', options: [{ value: 'a', label: 'Paris' }] }, { key: 'as', label: 'Asia', options: [{ value: 'b', label: 'Tokyo' }] }]} />);
        fireEvent.click(screen.getByRole('combobox', { name: 'Zone' }));
        expect(screen.getByRole('group', { name: 'Asia' })).toContainElement(screen.getByRole('option', { name: 'Tokyo' }));
    });
});
