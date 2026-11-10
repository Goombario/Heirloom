/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import React, { useState } from 'react';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

// Control the mobile gate per-test.
const isMobile = vi.fn<(below?: 'md' | 'lg') => boolean>();
vi.mock('@/app/hooks/useIsMobile', () => ({
  useIsMobile: (below?: 'md' | 'lg') => isMobile(below),
}));

import { Sheet } from '@/app/components/ui/Sheet';
import { sheetsTakeBack } from '@/app/components/ui/sheetStack';

describe('Sheet (desktop gate)', () => {
  beforeEach(() => { isMobile.mockReset(); });

  it('renders nothing on desktop, even when open', () => {
    isMobile.mockReturnValue(false);
    const { container } = render(
      <Sheet open onClose={vi.fn()} title="Switch tree">
        <div>row content</div>
      </Sheet>,
    );
    // Component returns null; nothing in its container and no portaled dialog.
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('row content')).not.toBeInTheDocument();
  });

  it('renders the sheet with its content on mobile when open', () => {
    isMobile.mockReturnValue(true);
    render(
      <Sheet open onClose={vi.fn()} title="Switch tree">
        <div>row content</div>
      </Sheet>,
    );
    expect(screen.getByText('row content')).toBeInTheDocument();
    // title backs the Drawer.Title, which is the dialog's accessible name
    // (via aria-labelledby — there is no aria-label on the content).
    expect(screen.getByRole('dialog', { name: 'Switch tree' })).toBeInTheDocument();
  });

  it('renders nothing on mobile when closed', () => {
    isMobile.mockReturnValue(true);
    render(
      <Sheet open={false} onClose={vi.fn()} title="Switch tree">
        <div>row content</div>
      </Sheet>,
    );
    expect(screen.queryByText('row content')).not.toBeInTheDocument();
  });

  it('gates on the lg breakpoint when asked, for a sheet that replaces a rail (#936)', () => {
    isMobile.mockImplementation((below) => below === 'lg');
    render(
      <Sheet open onClose={vi.fn()} title="Tree display" below="lg">
        <div>row content</div>
      </Sheet>,
    );
    expect(screen.getByText('row content')).toBeInTheDocument();
  });
});

/** An opener button and a typing sheet with one field, dirty once typed in. */
function TypingSheet({ onClose = vi.fn(), onSave = vi.fn() }: { onClose?: () => void; onSave?: () => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>open</button>
      {/* Unmounted when closed: happy-dom never ends Vaul's close animation. */}
      {open && <Sheet
        open
        onClose={() => { onClose(); setOpen(false); setValue(''); }}
        title="Edit birth"
        size="full"
        dirty={value !== ''}
        onSave={onSave}
      >
        <input aria-label="Date" value={value} onChange={(e) => setValue(e.target.value)} />
        <input aria-label="Place" />
        <textarea aria-label="Note" />
      </Sheet>}
    </>
  );
}

describe('Sheet v2 (#1042, #854)', () => {
  beforeEach(() => { isMobile.mockReset(); isMobile.mockReturnValue(true); });

  it('moves focus into the header on open and back to the opener on close, never to a field', async () => {
    const user = userEvent.setup();
    render(<TypingSheet />);
    await user.click(screen.getByRole('button', { name: 'open' }));
    const sheet = await screen.findByRole('dialog', { name: 'Edit birth' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'cancel' })).toHaveFocus());
    for (let i = 0; i < 4; i++) {
      await user.tab();
      expect(sheet.contains(document.activeElement)).toBe(true);
    }
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('button', { name: 'open' })).toHaveFocus();
  });

  it('keeps Save dim until something changes', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<TypingSheet onSave={onSave} />);
    await user.click(screen.getByRole('button', { name: 'open' }));
    expect(await screen.findByRole('button', { name: 'save' })).toBeDisabled();
    await user.type(screen.getByLabelText('Date'), '1874');
    await user.click(screen.getByRole('button', { name: 'save' }));
    expect(onSave).toHaveBeenCalledOnce();
  });

  it('reads Saving… while a save promise runs, and takes no second tap (#1215)', async () => {
    const user = userEvent.setup();
    let finish: () => void = () => {};
    const onSave = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    render(<TypingSheet onSave={onSave} />);
    await user.click(screen.getByRole('button', { name: 'open' }));
    await user.type(await screen.findByLabelText('Date'), '1874');
    await user.click(screen.getByRole('button', { name: 'save' }));
    const pill = screen.getByRole('button', { name: 'saving' });
    expect(pill).toBeDisabled();
    expect(pill).toHaveAttribute('aria-busy', 'true');
    await user.click(pill);
    expect(onSave).toHaveBeenCalledOnce();
    finish();
    // A save that leaves the sheet open (it failed) gives Save back.
    expect(await screen.findByRole('button', { name: 'save' })).toBeEnabled();
  });

  it('gives Save back after a save promise rejects', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(() => Promise.reject(new Error('flush failed')));
    render(<TypingSheet onSave={onSave} />);
    await user.click(screen.getByRole('button', { name: 'open' }));
    await user.type(await screen.findByLabelText('Date'), '1874');
    await user.click(screen.getByRole('button', { name: 'save' }));
    expect(await screen.findByRole('button', { name: 'save' })).toBeEnabled();
  });

  it('keeps a typing sheet above the keyboard and in view when the page scrolls under it', async () => {
    // A phone with the keyboard up: 844px tall, 500px visible, scrolled 120px down to the caret.
    const vv = Object.assign(new EventTarget(), { height: 500, offsetTop: 120, scale: 1 });
    Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true });
    try {
      render(<Sheet open onClose={vi.fn()} title="Biography" size="full" onSave={vi.fn()}><textarea aria-label="Text" /></Sheet>);
      const sheet = await screen.findByRole('dialog', { name: 'Biography' });
      await waitFor(() => expect(sheet.style.bottom).toBe('224px'));
      // (happy-dom drops the calc() height, so only the bottom edge is checked here.)
      Object.assign(vv, { height: 844, offsetTop: 0 });
      vv.dispatchEvent(new Event('resize'));
      await waitFor(() => expect(sheet.style.bottom).toBe('0px'));
    } finally {
      Object.defineProperty(window, 'visualViewport', { value: undefined, configurable: true });
    }
  });

  it('closes a clean sheet at once', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<TypingSheet onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: 'open' }));
    await user.click(await screen.findByRole('button', { name: 'cancel' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('asks before closing a dirty sheet, from Cancel, Escape and Back alike', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<TypingSheet onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: 'open' }));
    await user.type(await screen.findByLabelText('Date'), '1874');

    await user.click(screen.getByRole('button', { name: 'cancel' }));
    expect(screen.getByRole('alertdialog', { name: 'discard_changes_title' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'keep_editing' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'keep_editing' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByLabelText('Date')).toHaveValue('1874');

    fireEvent.keyDown(screen.getByLabelText('Date'), { key: 'Escape' });
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    // Escape again backs out of the question, not out of the sheet.
    fireEvent.keyDown(screen.getByRole('button', { name: 'keep_editing' }), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(onClose).not.toHaveBeenCalled();

    // The phone's Back reaches the top sheet through the sheet stack.
    expect(sheetsTakeBack()).toBe(true);
    await user.click(await screen.findByRole('button', { name: 'discard_changes' }));
    expect(onClose).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(sheetsTakeBack()).toBeNull();
  });

  it('moves Return to the next field and leaves the last one alone', async () => {
    const user = userEvent.setup();
    render(<TypingSheet />);
    await user.click(screen.getByRole('button', { name: 'open' }));
    await user.click(await screen.findByLabelText('Date'));
    expect(screen.getByLabelText('Date')).toHaveAttribute('enterkeyhint', 'next');
    await user.keyboard('{Enter}');
    expect(screen.getByLabelText('Place')).toHaveFocus();
    // A textarea is the last field: Return types a line break there.
    await user.keyboard('{Enter}');
    expect(screen.getByLabelText('Note')).toHaveFocus();
  });

  it('asks before stepping Back inside a dirty sheet, and steps without asking when clean', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    function Stepped() {
      const [v, setV] = useState('');
      return (
        <Sheet open onClose={vi.fn()} title="New person" size="full" dirty={v !== ''} onBack={onBack}>
          <input aria-label="First name" value={v} onChange={(e) => setV(e.target.value)} />
        </Sheet>
      );
    }
    render(<Stepped />);
    await user.click(await screen.findByRole('button', { name: 'back' }));
    expect(onBack).toHaveBeenCalledOnce();
    await user.type(screen.getByLabelText('First name'), 'Karl');
    await user.click(screen.getByRole('button', { name: 'back' }));
    expect(onBack).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'discard_changes' }));
    expect(onBack).toHaveBeenCalledTimes(2);
  });

  it('lets a made choice save while clean, and steps Back without asking when the step keeps it (#1049)', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    const onSave = vi.fn();
    const sheet = (dirty: boolean) => (
      <Sheet open onClose={vi.fn()} title="Cite source" size="full" dirty={dirty} onSave={onSave} saveLabel="Attach" saveWhenClean backKeepsChanges onBack={onBack}>
        <input aria-label="Page" />
      </Sheet>
    );
    const { rerender } = render(sheet(false));
    await user.click(await screen.findByRole('button', { name: 'Attach' }));
    expect(onSave).toHaveBeenCalledOnce();
    rerender(sheet(true));
    await user.click(screen.getByRole('button', { name: 'back' }));
    expect(onBack).toHaveBeenCalledOnce();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('gives a small sheet a close button instead of Cancel and Save', async () => {
    render(<Sheet open onClose={vi.fn()} title="Sort by"><div>rows</div></Sheet>);
    expect(await screen.findByRole('button', { name: 'close' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'cancel' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'save' })).toBeNull();
  });
});
