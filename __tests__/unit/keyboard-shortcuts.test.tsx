/** @vitest-environment happy-dom */
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { CREATE_SHORTCUTS, GO_SHORTCUTS, cheatsheet, isTypingTarget, letterOf, writeLetterShortcuts } from '@/lib/keyboard/shortcuts';

// Keyboard shortcuts (#32): g/n sequences on physical keys, ? and Ctrl/⌘ + /,
// the Options switch, and nothing while typing.

const h = vi.hoisted(() => ({ push: vi.fn(), guard: vi.fn(() => true), quickAdd: vi.fn(), permission: 'owner' as string }));

vi.mock('next-intl', () => ({
  useTranslations: () => Object.assign((key: string) => key, { rich: (key: string) => key }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: h.push }) }));
vi.mock('@/app/components/UnsavedChangesProvider', () => ({ useUnsavedChangesGuard: () => ({ guardNavigation: h.guard }) }));
vi.mock('@/app/components/QuickAddHost', () => ({ openQuickAdd: h.quickAdd }));
vi.mock('@/app/contexts/TreeContext', () => ({ useTree: () => ({ activePermission: h.permission }) }));
vi.mock('@/app/components/GuardedLink', () => ({
  default: ({ href, children, onNavigate: _n, ...rest }: { href: string; children: React.ReactNode; onNavigate?: () => void }) => <a href={href} {...rest}>{children}</a>,
}));

import KeyboardShortcuts from '@/app/components/keyboard/KeyboardShortcuts';

const press = (code: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) =>
  act(() => { target.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true, ...init })); });

describe('shortcuts registry (#32)', () => {
  it('has the locked letter map, each letter once', () => {
    expect(GO_SHORTCUTS.map((s) => `${s.letter}:${s.href}`)).toEqual([
      'h:/', 'p:/people', 'f:/families', 't:/tree', 'm:/places', 'l:/library', 'r:/cases',
      'c:/relationship', 'i:/import-export', 'd:/data-checks', 'a:/audit', 'o:/options',
    ]);
    expect(new Set(GO_SHORTCUTS.map((s) => s.letter)).size).toBe(GO_SHORTCUTS.length);
    expect(CREATE_SHORTCUTS.map((s) => s.letter)).toEqual(['p', 'f', 's']);
  });

  it('reads physical keys and knows a field from the page', () => {
    expect(letterOf('KeyG')).toBe('g');
    expect(letterOf('Digit1')).toBeNull();
    const input = document.createElement('input');
    const combo = document.createElement('div');
    combo.setAttribute('role', 'combobox');
    expect(isTypingTarget(input)).toBe(true);
    expect(isTypingTarget(combo)).toBe(true);
    expect(isTypingTarget(document.body)).toBe(false);
  });

  it('shows ⌘ on a Mac and Ctrl elsewhere', () => {
    const anywhere = (mac: boolean) => cheatsheet(mac).find((g) => g.id === 'anywhere')!.rows[0].keys;
    expect(anywhere(true)).toContainEqual({ key: '⌘' });
    expect(anywhere(false)).toContainEqual({ key: 'Ctrl' });
  });
});

describe('KeyboardShortcuts (#32)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    h.push.mockReset(); h.quickAdd.mockReset(); h.guard.mockReset(); h.guard.mockReturnValue(true);
    h.permission = 'owner';
    localStorage.clear();
  });
  afterEach(() => { vi.useRealTimers(); });

  it('g then p goes to People through the unsaved-changes guard, with the next-key card between', () => {
    render(<KeyboardShortcuts />);
    press('KeyG');
    expect(screen.getByRole('status')).toHaveTextContent('hint_go');
    press('KeyP');
    expect(h.guard).toHaveBeenCalled();
    expect(h.push).toHaveBeenCalledWith('/people');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('does not leave the page when the guard says stay', () => {
    h.guard.mockReturnValue(false);
    render(<KeyboardShortcuts />);
    press('KeyG'); press('KeyT');
    expect(h.push).not.toHaveBeenCalled();
  });

  it('n then p and n then f open the quick-add forms; n then s opens a new source', () => {
    render(<KeyboardShortcuts />);
    press('KeyN'); press('KeyP');
    press('KeyN'); press('KeyF');
    press('KeyN'); press('KeyS');
    expect(h.quickAdd.mock.calls).toEqual([['person'], ['family']]);
    expect(h.push).toHaveBeenCalledWith('/library/new');
  });

  it('creates nothing for a viewer', () => {
    h.permission = 'view';
    render(<KeyboardShortcuts />);
    press('KeyN'); press('KeyP');
    expect(h.quickAdd).not.toHaveBeenCalled();
  });

  it('lets the sequence lapse after a moment, and Esc cancels it', () => {
    render(<KeyboardShortcuts />);
    press('KeyG');
    act(() => { vi.advanceTimersByTime(1600); });
    press('KeyP');
    expect(h.push).not.toHaveBeenCalled();
    press('KeyG'); press('Escape', { key: 'Escape' }); press('KeyP');
    expect(h.push).not.toHaveBeenCalled();
  });

  it('keeps the next-key card open while the pointer is over it (#243)', () => {
    render(<KeyboardShortcuts />);
    press('KeyG');
    const card = screen.getByRole('status');
    fireEvent.pointerEnter(card);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(screen.getByRole('status')).toBeInTheDocument();
    // Pressing a letter while hovered still runs the command.
    press('KeyP');
    expect(h.push).toHaveBeenCalledWith('/people');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('resumes a short countdown when the pointer leaves the card (#243)', () => {
    render(<KeyboardShortcuts />);
    press('KeyG');
    act(() => { vi.advanceTimersByTime(1400); });
    fireEvent.pointerEnter(screen.getByRole('status'));
    act(() => { vi.advanceTimersByTime(2000); });
    fireEvent.pointerLeave(screen.getByRole('status'));
    act(() => { vi.advanceTimersByTime(700); });
    expect(screen.getByRole('status')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('Esc closes the card while it is hovered (#243)', () => {
    render(<KeyboardShortcuts />);
    press('KeyG');
    fireEvent.pointerEnter(screen.getByRole('status'));
    press('Escape', { key: 'Escape' });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('ignores keys typed in a field', () => {
    render(<><KeyboardShortcuts /><input aria-label="field" /></>);
    const input = screen.getByLabelText('field');
    press('KeyG', {}, input); press('KeyP', {}, input);
    expect(h.push).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('opens the list on ? and on Ctrl + /', () => {
    render(<KeyboardShortcuts />);
    press('Slash', { shiftKey: true, key: '?' });
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('footer_on')).toBeTruthy();
  });

  it('turns letter shortcuts off from Options, while Ctrl + / still opens the list', () => {
    render(<KeyboardShortcuts />);
    act(() => { writeLetterShortcuts(false); });
    press('KeyG'); press('KeyP');
    press('Slash', { shiftKey: true, key: '?' });
    expect(h.push).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    press('Slash', { ctrlKey: true, key: '/' });
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('footer_off')).toBeTruthy();
  });

  it('works on another layout: the physical key counts, not the character', () => {
    render(<KeyboardShortcuts />);
    press('KeyG', { key: 'п' }); press('KeyP', { key: 'з' });
    expect(h.push).toHaveBeenCalledWith('/people');
  });
});
