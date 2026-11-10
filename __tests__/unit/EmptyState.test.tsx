/** @vitest-environment happy-dom */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EmptyState } from '@/app/components/ui/EmptyState';

describe('EmptyState', () => {
  it('empty variant explains what goes here and renders the caller-supplied create action', () => {
    const { container } = render(
      <EmptyState
        variant="empty"
        title="people.no_people_yet"
        message="people.hint_add_first"
        action={<button type="button">people.add_person_outline</button>}
      />,
    );

    expect(container.firstElementChild?.getAttribute('data-variant')).toBe('empty');
    expect(screen.getByText('people.no_people_yet')).toBeTruthy();
    expect(screen.getByText('people.hint_add_first')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'people.add_person_outline' })).toBeTruthy();
  });

  it('filtered variant always offers the one reset and calls it', () => {
    const onClear = vi.fn();
    const { container } = render(
      <EmptyState
        variant="filtered"
        message="families.no_match"
        clearLabel="common.clear_filters"
        onClear={onClear}
      />,
    );

    expect(container.firstElementChild?.getAttribute('data-variant')).toBe('filtered');
    fireEvent.click(screen.getByRole('button', { name: 'common.clear_filters' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('inset drops its own card when it already sits in a container (#1175)', () => {
    const { container } = render(<EmptyState variant="empty" inset message="library.empty_no_photos" />);
    const root = container.firstElementChild!;
    expect(root.getAttribute('data-variant')).toBe('empty');
    expect(root.className).not.toContain('bg-card');
    expect(root.className).not.toContain('border');
    expect(screen.getByText('library.empty_no_photos')).toBeTruthy();
  });
});
