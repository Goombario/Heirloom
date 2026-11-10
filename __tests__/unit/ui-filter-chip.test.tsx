/** @vitest-environment happy-dom */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

import { FilterChip } from '@/app/components/ui/FilterChip';

describe('FilterChip dismiss', () => {
    it('calls onDismiss, not onClick, when the ✕ is used', () => {
        const onClick = vi.fn();
        const onDismiss = vi.fn();
        render(<FilterChip label="Male" active dismissible dismissLabel="Clear filter" onClick={onClick} onDismiss={onDismiss} />);

        fireEvent.click(screen.getByRole('button', { name: /clear/i }));

        expect(onDismiss).toHaveBeenCalledTimes(1);
        expect(onClick).not.toHaveBeenCalled();
    });

    it('still fires onClick when the chip body is used', () => {
        const onClick = vi.fn();
        const onDismiss = vi.fn();
        render(<FilterChip label="Male" active dismissible dismissLabel="Clear filter" onClick={onClick} onDismiss={onDismiss} />);

        fireEvent.click(screen.getByRole('button', { name: 'Male' }));

        expect(onClick).toHaveBeenCalledTimes(1);
        expect(onDismiss).not.toHaveBeenCalled();
    });

    it('renders no dismiss control when inactive', () => {
        render(<FilterChip label="Male" dismissible dismissLabel="Clear filter" onClick={() => {}} onDismiss={() => {}} />);
        expect(screen.queryByRole('button', { name: /clear/i })).toBeNull();
    });

    it('does not nest a button inside a button', () => {
        const { container } = render(
            <FilterChip label="Male" active dismissible dismissLabel="Clear filter" onClick={() => {}} onDismiss={() => {}} />,
        );
        expect(container.querySelector('button button')).toBeNull();
    });

    it('keeps aria-pressed on the chip body, reflecting active', () => {
        render(<FilterChip label="Male" active dismissible dismissLabel="Clear filter" onClick={() => {}} onDismiss={() => {}} />);
        expect(screen.getByRole('button', { name: 'Male' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('renders a plain single button when not dismissible', () => {
        const { container } = render(<FilterChip label="Male" active onClick={() => {}} />);
        expect(container.querySelectorAll('button')).toHaveLength(1);
    });

    // Switching the ROOT element between <button> and <span> as `active` flips
    // would remount the chip and drop focus on every press, so a keyboard user
    // could not cycle a tri-state chip without tabbing back to it each time.
    it('keeps the same chip-body node when active flips', () => {
        const props = { label: 'Male', dismissible: true as const, dismissLabel: 'Clear filter', onClick: () => {}, onDismiss: () => {} };
        const { container, rerender } = render(<FilterChip {...props} />);
        const before = container.querySelector('button');
        rerender(<FilterChip {...props} active />);
        expect(container.querySelector('button')).toBe(before);
        expect(before?.isConnected).toBe(true);
    });

    it('returns focus to the chip body after the ✕ clears', () => {
        function Host() {
            const [active, setActive] = React.useState(true);
            return <FilterChip label="Male" active={active} dismissible dismissLabel="Clear filter" onClick={() => {}} onDismiss={() => setActive(false)} />;
        }
        render(<Host />);
        fireEvent.click(screen.getByRole('button', { name: /clear/i }));

        expect(screen.queryByRole('button', { name: /clear/i })).toBeNull();
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Male' }));
    });
});

describe('FilterChip shape (CT-2)', () => {
    it('renders one fixed height for plain and dismissible chips', () => {
        const { container } = render(<>
            <FilterChip label="All" />
            <FilterChip label="Has parents" dismissible dismissLabel="Clear" onDismiss={() => {}} />
        </>);
        const shells = Array.from(container.children);
        expect(shells).toHaveLength(2);
        for (const el of shells) expect(el.className).toMatch(/\bh-7\b/);
    });

    it('puts the icon ahead of the label and keeps it out of the accessible name', () => {
        render(<FilterChip label="Add surname" icon={<svg data-testid="plus" aria-hidden="true" />} />);
        const chip = screen.getByRole('button', { name: 'Add surname' });
        expect(chip.firstElementChild).toBe(screen.getByTestId('plus'));
    });
});
