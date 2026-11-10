// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AvatarStack } from '@/app/components/ui/AvatarStack';

const PEOPLE = [
  { id: 1, name: 'Arthur Fixture', sex: 'M', src: null },
  { id: 2, name: 'Mary Sample', sex: 'F', src: '/photo-mary.jpg' },
  { id: 3, name: 'Cecilia Anderson', sex: 'F', src: null },
  { id: 4, name: 'Harold Test', sex: 'M', src: '/photo-harold.jpg' },
];

describe('AvatarStack', () => {
  it('sorts people with photos first, preserving order within each group', () => {
    render(<AvatarStack people={PEOPLE} />);
    const imgs = screen.getAllByRole('img');
    expect(imgs.map(i => i.getAttribute('alt'))).toEqual(['Mary Sample', 'Harold Test']);
  });

  it('collapses the overflow into a +N disc', () => {
    render(<AvatarStack people={PEOPLE} max={2} />);
    expect(screen.getByText('+2')).toBeTruthy();
  });

  it('does not render a +N disc when everyone fits', () => {
    render(<AvatarStack people={PEOPLE} max={4} />);
    expect(screen.queryByText(/^\+/)).toBeNull();
  });

  it('renders nothing for an empty list', () => {
    const { container } = render(<AvatarStack people={[]} />);
    expect(container.firstElementChild).toBeNull();
  });

  it('labels the group for assistive tech', () => {
    render(<AvatarStack people={PEOPLE} max={2} />);
    const group = screen.getByRole('group');
    expect(group.getAttribute('aria-label')).toContain('Mary Sample');
  });
});
