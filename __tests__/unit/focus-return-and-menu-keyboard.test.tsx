/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React, { useCallback, useRef, useState } from 'react';
import { useMenuKeyboard } from '@/app/components/ui/useMenuKeyboard';
import { useReturnFocus } from '@/app/hooks/useReturnFocus';

function Menu({ checked }: { checked?: number }) {
    const [open, setOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const onClose = useCallback((returnFocus: boolean) => {
        setOpen(false);
        if (returnFocus) triggerRef.current?.focus();
    }, []);
    const onKeyDown = useMenuKeyboard({ open, menuRef, onClose });
    const role = checked === undefined ? 'menuitem' : 'menuitemradio';
    return (
        <>
            <button ref={triggerRef} onClick={() => setOpen(true)}>trigger</button>
            {open && (
                <div ref={menuRef} role="menu" onKeyDown={onKeyDown}>
                    {['One', 'Two', 'Three'].map((label, i) => (
                        <button key={label} role={role} tabIndex={-1} aria-checked={checked === undefined ? undefined : checked === i}>{label}</button>
                    ))}
                </div>
            )}
        </>
    );
}

describe('useMenuKeyboard (#690)', () => {
    it('focuses the first item on open and walks the items with wrapping arrows', () => {
        render(<Menu />);
        fireEvent.click(screen.getByText('trigger'));
        const menu = screen.getByRole('menu');
        expect(screen.getByText('One')).toHaveFocus();
        fireEvent.keyDown(menu, { key: 'ArrowUp' });
        expect(screen.getByText('Three')).toHaveFocus();
        fireEvent.keyDown(menu, { key: 'ArrowDown' });
        expect(screen.getByText('One')).toHaveFocus();
        fireEvent.keyDown(menu, { key: 'End' });
        expect(screen.getByText('Three')).toHaveFocus();
        fireEvent.keyDown(menu, { key: 'Home' });
        expect(screen.getByText('One')).toHaveFocus();
    });

    it('focuses the checked item of a radio menu on open', () => {
        render(<Menu checked={1} />);
        fireEvent.click(screen.getByText('trigger'));
        expect(screen.getByText('Two')).toHaveFocus();
    });

    it.each(['Escape', 'Tab'])('%s closes the menu and returns focus to the trigger', (key) => {
        render(<Menu />);
        fireEvent.click(screen.getByText('trigger'));
        fireEvent.keyDown(screen.getByRole('menu'), { key });
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
        expect(screen.getByText('trigger')).toHaveFocus();
    });
});

function InlinePanel() {
    const [open, setOpen] = useState(false);
    const triggerRef = useReturnFocus(open);
    return open ? (
        <button onClick={() => setOpen(false)}>cancel</button>
    ) : (
        <button ref={triggerRef} onClick={() => setOpen(true)}>add</button>
    );
}

describe('useReturnFocus (#690)', () => {
    it('refocuses a trigger that was unmounted while its panel was open', () => {
        render(<InlinePanel />);
        fireEvent.click(screen.getByText('add'));
        screen.getByText('cancel').focus();
        fireEvent.click(screen.getByText('cancel'));
        expect(screen.getByText('add')).toHaveFocus();
    });

    it('does not steal focus on first render', () => {
        render(<><input aria-label="elsewhere" autoFocus /><InlinePanel /></>);
        expect(screen.getByLabelText('elsewhere')).toHaveFocus();
    });
});
