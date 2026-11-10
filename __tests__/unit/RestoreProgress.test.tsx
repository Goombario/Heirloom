/** @vitest-environment happy-dom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

import RestoreProgress from '@/app/components/backup/RestoreProgress';

afterEach(() => vi.useRealTimers());

// A large restore showed only a busy button and felt like a hang (#282).
describe('RestoreProgress (#282)', () => {
  it('shows nothing when no restore step is running', () => {
    render(<RestoreProgress phase={null} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('waits a moment while reading, so a small backup does not flash it', () => {
    vi.useFakeTimers();
    render(<RestoreProgress phase="reading" />);
    act(() => { vi.advanceTimersByTime(100); });
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => { vi.advanceTimersByTime(400); });
    expect(screen.getByRole('dialog')).toHaveAccessibleName('restore_progress_reading_title');
  });

  it('shows at once while restoring, since it replaces the confirm dialog', () => {
    vi.useFakeTimers();
    render(<RestoreProgress phase="restoring" />);
    act(() => { vi.advanceTimersByTime(0); });
    expect(screen.getByRole('dialog')).toHaveAccessibleName('restore_progress_title');
    expect(screen.getByRole('status')).toHaveTextContent('restore_progress_body');
  });

  it('has no close button, since a running restore cannot be called back', () => {
    vi.useFakeTimers();
    render(<RestoreProgress phase="restoring" />);
    act(() => { vi.advanceTimersByTime(500); });
    expect(screen.queryByRole('button')).toBeNull();
  });
});
