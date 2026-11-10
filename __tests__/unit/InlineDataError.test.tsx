/** @vitest-environment happy-dom */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InlineDataError } from '@/app/components/ui/InlineDataError';

describe('InlineDataError', () => {
  it('renders caller-supplied translated copy and invokes the local retry action', () => {
    const onRetry = vi.fn();
    render(
      <InlineDataError
        message="common.error_generic"
        retryLabel="common.retry"
        onRetry={onRetry}
      />,
    );

    const banner = screen.getByRole('alert');
    expect(banner.textContent).toContain('common.error_generic');
    expect(screen.getByRole('button', { name: 'common.retry' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'common.retry' }).classList.contains('[@media(pointer:coarse)]:min-h-11')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'common.retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
