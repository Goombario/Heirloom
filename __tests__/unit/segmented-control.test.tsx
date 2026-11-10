/** @vitest-environment jsdom */
// Kept on jsdom while the rest of the suite runs happy-dom: the "does not call
// document.querySelectorAll" test below spies on the global querySelectorAll and
// asserts it is never called; happy-dom's own internals invoke it, failing the
// assertion. jsdom does not, so the spy stays honest here.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { SegmentedControl } from '@/app/components/ui';

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const OPTIONS = [
    { v: '', l: 'Unknown' },
    { v: 'M', l: 'Male' },
    { v: 'F', l: 'Female' },
];

afterEach(() => {
    vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe('SegmentedControl — rendering', () => {
    it('renders all options as radio buttons inside a radiogroup', () => {
        render(<SegmentedControl value="" options={OPTIONS} onChange={vi.fn()} />);
        expect(screen.getByRole('radiogroup')).toBeInTheDocument();
        expect(screen.getAllByRole('radio')).toHaveLength(3);
    });

    it('sets aria-checked=true only on the active option', () => {
        render(<SegmentedControl value="M" options={OPTIONS} onChange={vi.fn()} />);
        expect(screen.getByRole('radio', { name: 'Male' })).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByRole('radio', { name: 'Unknown' })).toHaveAttribute('aria-checked', 'false');
        expect(screen.getByRole('radio', { name: 'Female' })).toHaveAttribute('aria-checked', 'false');
    });

    it('gives tabIndex=0 to the active option and -1 to the others', () => {
        render(<SegmentedControl value="F" options={OPTIONS} onChange={vi.fn()} />);
        expect(screen.getByRole('radio', { name: 'Female' })).toHaveAttribute('tabIndex', '0');
        expect(screen.getByRole('radio', { name: 'Unknown' })).toHaveAttribute('tabIndex', '-1');
        expect(screen.getByRole('radio', { name: 'Male' })).toHaveAttribute('tabIndex', '-1');
    });

    it('gives tabIndex=0 to the first option when no value is selected', () => {
        render(<SegmentedControl value="UNSET" options={OPTIONS} onChange={vi.fn()} />);
        expect(screen.getByRole('radio', { name: 'Unknown' })).toHaveAttribute('tabIndex', '0');
    });

    it('each button carries the 44px touch-target class', () => {
        // The touch target is now a Tailwind utility (min-h-[44px]) rather than an
        // inline style, so assert the class (jsdom applies no CSS to compute height).
        render(<SegmentedControl value="" options={OPTIONS} onChange={vi.fn()} />);
        screen.getAllByRole('radio').forEach((btn) => {
            expect((btn as HTMLElement).className).toContain('min-h-[44px]');
        });
    });
});

// ---------------------------------------------------------------------------
// Click selection
// ---------------------------------------------------------------------------

describe('SegmentedControl — click', () => {
    it('calls onChange with the option value when a button is clicked', () => {
        const onChange = vi.fn();
        render(<SegmentedControl value="" options={OPTIONS} onChange={onChange} />);
        fireEvent.click(screen.getByRole('radio', { name: 'Male' }));
        expect(onChange).toHaveBeenCalledOnce();
        expect(onChange).toHaveBeenCalledWith('M');
    });

    it('calls onChange even when clicking the currently active option', () => {
        const onChange = vi.fn();
        render(<SegmentedControl value="F" options={OPTIONS} onChange={onChange} />);
        fireEvent.click(screen.getByRole('radio', { name: 'Female' }));
        expect(onChange).toHaveBeenCalledWith('F');
    });
});

// ---------------------------------------------------------------------------
// Keyboard — Space / Enter
// ---------------------------------------------------------------------------

describe('SegmentedControl — Space / Enter', () => {
    it('Space selects the button that received the event', () => {
        const onChange = vi.fn();
        render(<SegmentedControl value="M" options={OPTIONS} onChange={onChange} />);
        fireEvent.keyDown(screen.getByRole('radio', { name: 'Male' }), { key: ' ' });
        expect(onChange).toHaveBeenCalledWith('M');
    });

    it('Enter selects the button that received the event', () => {
        const onChange = vi.fn();
        render(<SegmentedControl value="F" options={OPTIONS} onChange={onChange} />);
        fireEvent.keyDown(screen.getByRole('radio', { name: 'Female' }), { key: 'Enter' });
        expect(onChange).toHaveBeenCalledWith('F');
    });

    it('Space on a non-active button still calls onChange (pre-committed selection move)', () => {
        const onChange = vi.fn();
        render(<SegmentedControl value="" options={OPTIONS} onChange={onChange} />);
        fireEvent.keyDown(screen.getByRole('radio', { name: 'Female' }), { key: ' ' });
        expect(onChange).toHaveBeenCalledWith('F');
    });
});

// ---------------------------------------------------------------------------
// Keyboard — Arrow navigation
// ---------------------------------------------------------------------------

describe('SegmentedControl — Arrow navigation', () => {
    it('ArrowRight from index 0 calls onChange with index 1', () => {
        const onChange = vi.fn();
        render(<SegmentedControl value="" options={OPTIONS} onChange={onChange} />);
        fireEvent.keyDown(screen.getByRole('radio', { name: 'Unknown' }), { key: 'ArrowRight' });
        expect(onChange).toHaveBeenCalledWith('M');
    });

    it('ArrowDown behaves identically to ArrowRight', () => {
        const onChange = vi.fn();
        render(<SegmentedControl value="" options={OPTIONS} onChange={onChange} />);
        fireEvent.keyDown(screen.getByRole('radio', { name: 'Unknown' }), { key: 'ArrowDown' });
        expect(onChange).toHaveBeenCalledWith('M');
    });

    it('ArrowLeft from index 0 wraps to the last option', () => {
        const onChange = vi.fn();
        render(<SegmentedControl value="" options={OPTIONS} onChange={onChange} />);
        fireEvent.keyDown(screen.getByRole('radio', { name: 'Unknown' }), { key: 'ArrowLeft' });
        expect(onChange).toHaveBeenCalledWith('F');
    });

    it('ArrowUp behaves identically to ArrowLeft', () => {
        const onChange = vi.fn();
        render(<SegmentedControl value="" options={OPTIONS} onChange={onChange} />);
        fireEvent.keyDown(screen.getByRole('radio', { name: 'Unknown' }), { key: 'ArrowUp' });
        expect(onChange).toHaveBeenCalledWith('F');
    });

    it('ArrowRight from last index wraps to index 0', () => {
        const onChange = vi.fn();
        render(<SegmentedControl value="F" options={OPTIONS} onChange={onChange} />);
        fireEvent.keyDown(screen.getByRole('radio', { name: 'Female' }), { key: 'ArrowRight' });
        expect(onChange).toHaveBeenCalledWith('');
    });

    it('ArrowRight from middle index advances one step', () => {
        const onChange = vi.fn();
        render(<SegmentedControl value="M" options={OPTIONS} onChange={onChange} />);
        fireEvent.keyDown(screen.getByRole('radio', { name: 'Male' }), { key: 'ArrowRight' });
        expect(onChange).toHaveBeenCalledWith('F');
    });
});

// ---------------------------------------------------------------------------
// Keyboard — first-letter jump
// ---------------------------------------------------------------------------

describe('SegmentedControl — first-letter jump', () => {
    it('pressing "m" selects the option whose label starts with M', () => {
        const onChange = vi.fn();
        render(<SegmentedControl value="" options={OPTIONS} onChange={onChange} />);
        fireEvent.keyDown(screen.getByRole('radio', { name: 'Unknown' }), { key: 'm' });
        expect(onChange).toHaveBeenCalledWith('M');
    });

    it('pressing "f" selects the option whose label starts with F', () => {
        const onChange = vi.fn();
        render(<SegmentedControl value="" options={OPTIONS} onChange={onChange} />);
        fireEvent.keyDown(screen.getByRole('radio', { name: 'Unknown' }), { key: 'f' });
        expect(onChange).toHaveBeenCalledWith('F');
    });

    it('pressing a key with no matching label does nothing', () => {
        const onChange = vi.fn();
        render(<SegmentedControl value="" options={OPTIONS} onChange={onChange} />);
        fireEvent.keyDown(screen.getByRole('radio', { name: 'Unknown' }), { key: 'z' });
        expect(onChange).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// Ref-array nav — no document.* access
// ---------------------------------------------------------------------------

describe('SegmentedControl — ref-array nav (no document.* access)', () => {
    it('all keyboard paths call onChange without any document.activeElement lookup', () => {
        // Note: we cannot spy on document.activeElement to prove the component
        // doesn't read it, because jsdom's own el.focus() internally accesses
        // document.activeElement to dispatch blur/focus events — that would be a
        // false positive. Instead we verify behaviour: onChange is correctly driven
        // by the index passed through the ref-array onKeyDown, NOT by a live DOM
        // query. The companion querySelectorAll spy test (below) also passes,
        // confirming no generic DOM queries are made.
        const onChange = vi.fn();
        render(<SegmentedControl value="" options={OPTIONS} onChange={onChange} />);

        const unknownBtn = screen.getByRole('radio', { name: 'Unknown' });
        const maleBtn    = screen.getByRole('radio', { name: 'Male' });
        const femaleBtn  = screen.getByRole('radio', { name: 'Female' });

        // Each key event uses the button's own index, not document.activeElement:
        fireEvent.keyDown(unknownBtn, { key: 'ArrowRight' }); // idx=0 → calls onChange('M')
        fireEvent.keyDown(maleBtn,    { key: ' ' });           // idx=1 → calls onChange('M')
        fireEvent.keyDown(femaleBtn,  { key: 'Enter' });       // idx=2 → calls onChange('F')
        fireEvent.keyDown(unknownBtn, { key: 'm' });           // letter jump → calls onChange('M')

        expect(onChange).toHaveBeenNthCalledWith(1, 'M');
        expect(onChange).toHaveBeenNthCalledWith(2, 'M');
        expect(onChange).toHaveBeenNthCalledWith(3, 'F');
        expect(onChange).toHaveBeenNthCalledWith(4, 'M');
    });

    it('keyboard navigation does not call document.querySelectorAll', () => {
        const spy = vi.spyOn(document, 'querySelectorAll');

        const onChange = vi.fn();
        render(<SegmentedControl value="" options={OPTIONS} onChange={onChange} />);
        spy.mockClear(); // clear any calls from render

        const unknownBtn = screen.getByRole('radio', { name: 'Unknown' });
        fireEvent.keyDown(unknownBtn, { key: 'ArrowRight' });
        fireEvent.keyDown(unknownBtn, { key: ' ' });

        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });
});

// ---------------------------------------------------------------------------
// Selection style and disabled options (#691)
// ---------------------------------------------------------------------------

describe('SegmentedControl — selection and disabled options', () => {
    it('marks the selected segment with the neutral ink fill', () => {
        render(<SegmentedControl value="M" options={OPTIONS} onChange={vi.fn()} />);
        expect(screen.getByRole('radio', { name: 'Male' })).toHaveClass('bg-segment-on', 'text-on-segment');
        expect(screen.getByRole('radio', { name: 'Female' })).not.toHaveClass('bg-segment-on');
    });

    it('skips a disabled option with the arrow keys and ignores clicks on it', () => {
        const onChange = vi.fn();
        const options = [OPTIONS[0], { ...OPTIONS[1], disabled: true }, OPTIONS[2]];
        render(<SegmentedControl value="" options={options} onChange={onChange} />);
        fireEvent.keyDown(screen.getByRole('radio', { name: 'Unknown' }), { key: 'ArrowRight' });
        expect(onChange).toHaveBeenLastCalledWith('F');
        onChange.mockClear();
        fireEvent.click(screen.getByRole('radio', { name: 'Male' }));
        expect(onChange).not.toHaveBeenCalled();
    });

    it('keeps the selection marked when the whole control is disabled', () => {
        const onChange = vi.fn();
        render(<SegmentedControl value="M" options={OPTIONS} onChange={onChange} disabled />);
        expect(screen.getByRole('radio', { name: 'Male' })).toHaveAttribute('aria-checked', 'true');
        fireEvent.keyDown(screen.getByRole('radio', { name: 'Male' }), { key: 'ArrowRight' });
        expect(onChange).not.toHaveBeenCalled();
    });
});
