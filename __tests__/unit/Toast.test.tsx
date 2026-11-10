/** @vitest-environment happy-dom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

import { AppToaster, showErrorToast } from '@/app/components/ui/Toast';
import { showChangeToast } from '@/app/components/ui';

describe('AppToaster', () => {
  // Sonner announces through a polite live region; this asserts the message renders,
  // not its ARIA role. Escalating the error tone to assertive is a separate follow-up.
  it('renders the error message after showErrorToast', async () => {
    render(<AppToaster />);
    act(() => { showErrorToast('Something went wrong.'); });
    expect(await screen.findByText('Something went wrong.')).toBeInTheDocument();
  });

  it('tints the error toast from the app tokens, not sonner\'s shadowed aliases', async () => {
    render(<AppToaster />);
    act(() => { showErrorToast('Something went wrong.'); });
    const toast = (await screen.findByText('Something went wrong.')).closest('[data-sonner-toast]');
    const cls = toast?.className ?? '';
    // sonner sets its own --error-bg on [data-sonner-toaster], which shadows ours
    // inside the portal and stranded the toast on a light background in dark theme.
    expect(cls).toContain('var(--color-error-bg)');
    expect(cls).not.toContain('var(--error-bg)');
  });

  // Regression: `offset`/`mobileOffset` were passed as strings, and sonner's
  // `assignOffset` assigns a bare string to ALL FOUR sides. On mobile the toast width
  // is `calc(100% - var(--mobile-offset-left) * 2)`, so the horizontal inset became the
  // nav height — a ~136px sliver on a notched 390px viewport. Only the TOP offset may
  // carry the nav clearance.
  it('offsets only the top, leaving the horizontal insets at sonner\'s defaults', async () => {
    render(<AppToaster />);
    // sonner mounts its container lazily — there is no [data-sonner-toaster] until a
    // toast exists.
    act(() => { showErrorToast('Something went wrong.'); });
    await screen.findByText('Something went wrong.');
    const toaster = document.querySelector('[data-sonner-toaster]') as HTMLElement;
    expect(toaster).toBeTruthy();
    expect(toaster.style.getPropertyValue('--mobile-offset-top')).toContain('--nav-h');
    expect(toaster.style.getPropertyValue('--offset-top')).toContain('--nav-h');
    for (const side of ['left', 'right', 'bottom']) {
      expect(toaster.style.getPropertyValue(`--mobile-offset-${side}`)).toBe('16px');
      expect(toaster.style.getPropertyValue(`--offset-${side}`)).toBe('24px');
    }
  });

  it('labels the toast region for screen readers', () => {
    render(<AppToaster />);
    // sonner's Toaster appends its keyboard-shortcut hint (e.g. " alt+T") to the
    // aria-label it renders, so the actual DOM label is not an exact match for the
    // translated string we pass in — match by substring instead.
    expect(screen.getByLabelText(/error_toasts_label/)).toBeInTheDocument();
  });
});

describe('change toast (#1043)', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('shows what changed, what it was, and an Undo that takes it back', async () => {
    const onUndo = vi.fn();
    render(<AppToaster />);
    act(() => { showChangeToast({ message: 'Birth deleted', detail: '1900 · Duluth', onUndo }); });
    expect(await screen.findByText('Birth deleted')).toBeInTheDocument();
    expect(screen.getByText('1900 · Duluth')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'undo' }));
    expect(onUndo).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByText('Birth deleted')).toBeNull());
  });

  it('shows one at a time: a new change replaces the old without undoing it', async () => {
    const first = vi.fn();
    render(<AppToaster />);
    act(() => { showChangeToast({ message: 'Name deleted', onUndo: first }); });
    expect(await screen.findByText('Name deleted')).toBeInTheDocument();
    act(() => { showChangeToast({ message: 'Note deleted', onUndo: vi.fn() }); });
    expect(await screen.findByText('Note deleted')).toBeInTheDocument();
    expect(screen.queryByText('Name deleted')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'undo' })).toHaveLength(1);
    expect(first).not.toHaveBeenCalled();
  });

  it('gives a plain confirmation a tick, no Undo, and two seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<AppToaster />);
    act(() => { showChangeToast({ message: 'Changes saved' }); });
    expect(await screen.findByText('Changes saved')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'undo' })).toBeNull();
    act(() => { vi.advanceTimersByTime(2500); });
    await waitFor(() => expect(screen.queryByText('Changes saved')).toBeNull());
  });

  it('holds while a finger rests on it, then runs out the time that was left', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<AppToaster />);
    act(() => { showChangeToast({ message: 'Event deleted', onUndo: vi.fn() }); });
    const text = await screen.findByText('Event deleted');
    const card = text.closest('.change-toast') as HTMLElement;
    act(() => { vi.advanceTimersByTime(1000); });
    fireEvent.pointerDown(card);
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(screen.getByText('Event deleted')).toBeInTheDocument();
    expect(card.querySelector('.change-toast-bar')).toHaveStyle({ animationPlayState: 'paused' });
    fireEvent.pointerUp(card);
    act(() => { vi.advanceTimersByTime(4000); });
    expect(screen.getByText('Event deleted')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1500); });
    await waitFor(() => expect(screen.queryByText('Event deleted')).toBeNull());
  });
});
