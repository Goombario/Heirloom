/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Lifespan, PersonIdentity } from '@/app/components/ui';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/app/components/ProfileImage', () => ({
  // eslint-disable-next-line @next/next/no-img-element -- lightweight test double
  default: ({ alt }: { alt: string }) => <img alt={alt} />,
}));

/**
 * The avatar + name + mono lifespan row. Lived privately inside
 * `PersonPicker` as `ResultRow`'s body while roughly a dozen other screens
 * hand-rolled their own copy; extracted so the faces queue's ambiguity chips
 * reuse it rather than adding a thirteenth.
 */
describe('PersonIdentity', () => {
  it('renders the name in sans (TYPE-5: names in lists are sans) and the lifespan in mono', () => {
    render(<PersonIdentity name="Rosa Lombardi" initials="RL" lifespan={<Lifespan birth="1902" death="1988" />} />);

    const name = screen.getByText('Rosa Lombardi');
    expect(name).toHaveClass('font-semibold');
    expect(name).not.toHaveClass('serif');
    const lifespan = screen.getByText('1902 – 1988');
    expect(lifespan).toHaveClass('date-mono');
  });

  it('omits the meta line entirely when there is nothing to put in it', () => {
    const { container } = render(<PersonIdentity name="Rex Pike" initials="RP" />);

    expect(screen.getByText('Rex Pike')).toBeInTheDocument();
    expect(container.querySelectorAll('.font-mono')).toHaveLength(0);
  });

  it('separates supplementary meta from the lifespan', () => {
    render(<PersonIdentity name="Rosa Lombardi" initials="RL" meta="Female" lifespan="1902 – 1988" />);

    expect(screen.getByText('Female')).toBeInTheDocument();
    expect(screen.getByText('1902 – 1988')).toBeInTheDocument();
  });

  it('renders phrasing-safe elements when asked, so it can sit inside a button', () => {
    // A <div> inside a <button> is invalid HTML; every wrapper must follow `as`.
    const { container } = render(
      <button type="button">
        <PersonIdentity as="span" name="Rosa Lombardi" initials="RL" lifespan="1902 – 1988" />
      </button>,
    );

    expect(container.querySelector('button div')).toBeNull();
  });

  it('falls back to the initials disc when no photo is available', () => {
    render(<PersonIdentity name="Rosa Lombardi" initials="RL" />);
    expect(screen.getByText('RL')).toBeInTheDocument();
  });
});
