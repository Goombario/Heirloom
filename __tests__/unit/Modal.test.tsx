/** @vitest-environment happy-dom */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import Modal from '@/app/components/Modal';

function Card() {
  return <div data-testid="card">card content</div>;
}

describe('Modal', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.removeAttribute('style');
    document.documentElement.removeAttribute('style');
  });

  it('renders nothing when closed', () => {
    const { container } = render(
      <Modal open={false} onClose={vi.fn()}><Card /></Modal>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('sets role=dialog and aria-modal when open', () => {
    render(<Modal open onClose={vi.fn()} labelledBy="h"><Card /></Modal>);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'h');
  });

  it('captures and restores document scroll when closed', () => {
    vi.spyOn(window, 'scrollX', 'get').mockReturnValue(40);
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(600);
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    const { rerender } = render(<Modal open onClose={vi.fn()}><Card /></Modal>);

    expect(document.body.style.position).toBe('fixed');
    expect(document.body.style.top).toBe('-600px');
    expect(document.body.style.left).toBe('-40px');
    expect(document.body.style.overflow).not.toBe('hidden');

    rerender(<Modal open={false} onClose={vi.fn()}><Card /></Modal>);

    expect(document.body.style.position).toBe('');
    expect(window.scrollTo).toHaveBeenCalledWith(40, 600);
  });

  it('calls onClose on Escape', () => {
    const onClose = vi.fn();
    render(<Modal open onClose={onClose}><Card /></Modal>);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose on backdrop click but not on card click', () => {
    const onClose = vi.fn();
    render(<Modal open onClose={onClose}><Card /></Modal>);
    fireEvent.click(screen.getByTestId('card'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('is inert when disableClose: Escape and backdrop do nothing', () => {
    const onClose = vi.fn();
    render(<Modal open disableClose onClose={onClose}><Card /></Modal>);
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
  });
});
