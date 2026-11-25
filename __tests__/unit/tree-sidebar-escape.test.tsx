/**
 * @vitest-environment happy-dom
 *
 * Escape closes the tree's person sidebar (#255), but an Escape that closes an open
 * dropdown or popover inside it closes only that. With edits, closing asks in the
 * app with Save, Discard and Keep editing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';

const h = vi.hoisted(() => ({ editor: {} as Record<string, unknown>, listOpen: false }));

vi.mock('@/app/components/tree/person-sidebar/useTreePersonEditor', () => ({ useTreePersonEditor: () => h.editor }));
vi.mock('@/app/components/tree/person-sidebar/SidebarContent', () => ({
  SidebarContent: () => (
    <div>
      <input aria-label="Birth place" aria-expanded={h.listOpen} role="combobox" />
      <input aria-label="First name" />
    </div>
  ),
}));
vi.mock('@/app/hooks/useIsMobile', () => ({ useIsMobile: () => false }));

import PersonSidebar from '@/app/components/tree/PersonSidebar';

function setup(overrides: Record<string, unknown> = {}, listOpen = false) {
  h.listOpen = listOpen;
  h.editor = {
    person: { Id: 1 }, loading: false, loadError: null, retryLoad: vi.fn(), mediaError: null, retryMedia: vi.fn(),
    visible: true, isMobile: false, showLoadingOverlay: false, displayName: 'Ada Byron', saving: false,
    handleClose: vi.fn(), closePrompt: false,
    handlePromptSave: vi.fn(), handlePromptDiscard: vi.fn(), handlePromptKeepEditing: vi.fn(),
    ...overrides,
  };
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <PersonSidebar personId={1} onClose={vi.fn()} onFocusPerson={vi.fn()} />
    </NextIntlClientProvider>,
  );
  return h.editor;
}

const esc = (target: Element) => act(() => { target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });

describe('tree person sidebar Escape (#255)', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('closes on Escape from the page or a plain field', () => {
    const editor = setup();
    esc(document.body);
    esc(screen.getByLabelText('First name'));
    expect(editor.handleClose).toHaveBeenCalledTimes(2);
  });

  it('leaves the sidebar open when Escape closes an open dropdown', () => {
    const editor = setup({}, true);
    esc(screen.getByLabelText('Birth place'));
    expect(editor.handleClose).not.toHaveBeenCalled();
  });

  it('leaves the sidebar open when another widget already handled Escape', () => {
    const editor = setup();
    const field = screen.getByLabelText('First name');
    field.addEventListener('keydown', (e) => e.preventDefault());
    esc(field);
    expect(editor.handleClose).not.toHaveBeenCalled();
  });

  it('asks with Save, Discard and Keep editing when there are edits', () => {
    const editor = setup({ closePrompt: true });
    expect(screen.getByText(en.treeSidebar.close_prompt_title)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: en.common.save }));
    fireEvent.click(screen.getByRole('button', { name: en.treeSidebar.discard }));
    fireEvent.click(screen.getByRole('button', { name: en.common.keep_editing }));
    expect(editor.handlePromptSave).toHaveBeenCalledTimes(1);
    expect(editor.handlePromptDiscard).toHaveBeenCalledTimes(1);
    expect(editor.handlePromptKeepEditing).toHaveBeenCalledTimes(1);
  });
});
