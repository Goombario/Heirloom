/** @vitest-environment happy-dom */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SourcingMeter, StatusMark } from '@/app/components/ui';

describe('StatusMark', () => {
  it('draws † (U+2020) for deceased and ? for unknown, and a plain dot for living', () => {
    const { container, rerender } = render(<StatusMark status="deceased" />);
    expect(container.querySelector('.status-dagger')?.textContent).toBe('\u2020');

    rerender(<StatusMark status="living" />);
    expect(container.querySelector('.status-mark')).toHaveAttribute('data-status', 'living');
    expect(container.querySelector('.status-mark')).toBeEmptyDOMElement();

    rerender(<StatusMark status="unknown" />);
    expect(container.querySelector('.status-mark')).toHaveAttribute('data-status', 'unknown');
    expect(container.querySelector('.status-mark svg')).not.toBeNull();
  });

  it('is hidden from screen readers when a visible word carries the meaning', () => {
    const { container } = render(<StatusMark status="living" />);
    expect(container.querySelector('.status-mark')).toHaveAttribute('aria-hidden', 'true');
  });

  it('is a labelled image when it stands alone, e.g. on an avatar corner', () => {
    render(<StatusMark status="deceased" corner size="md" label="Deceased" />);
    const mark = screen.getByRole('img', { name: 'Deceased' });
    expect(mark).toHaveClass('status-corner');
    expect(mark).toHaveAttribute('data-size', 'md');
  });
});

describe('SourcingMeter', () => {
  it('draws one segment per fact up to 8, filled for sourced facts, followed by its label', () => {
    const { container } = render(<SourcingMeter sourced={2} total={4} label="2/4 facts sourced" />);
    expect(container.querySelectorAll('.sm-track > i')).toHaveLength(4);
    expect(container.querySelectorAll('.sm-track > i[data-on]')).toHaveLength(2);
    expect(screen.getByText('2/4 facts sourced')).toBeInTheDocument();
    expect(container.querySelector('.sourcing-meter')).toHaveAttribute('data-complete', 'false');
  });

  it('switches to a continuous bar above 8 facts', () => {
    const { container } = render(<SourcingMeter sourced={9} total={16} label="9/16 facts sourced" />);
    expect(container.querySelector('.sm-track')).toBeNull();
    expect(container.querySelector('.sm-bar > i')).toHaveStyle({ width: '56.25%' });
  });

  it('marks a fully sourced record complete', () => {
    const { container } = render(<SourcingMeter sourced={3} total={3} label="3/3 facts sourced" />);
    expect(container.querySelector('.sourcing-meter')).toHaveAttribute('data-complete', 'true');
  });

  it('renders nothing for a record with no facts', () => {
    const { container } = render(<SourcingMeter sourced={0} total={0} label="" />);
    expect(container).toBeEmptyDOMElement();
  });
});
