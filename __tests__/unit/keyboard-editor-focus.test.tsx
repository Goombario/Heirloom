/** @vitest-environment happy-dom */
/**
 * #798 (KB-2, KB-3, KB-4), keyboard: opening an inline editor focuses its first
 * field, and Cancel or Escape closes it and returns focus to the button that
 * opened it. Covers the hero editor, the timeline-style row editors (through the
 * shared hook) and Add child. The citation popover's Tab-out (KB-4) is tested
 * next to it, in citation-workflow-ui.test.tsx.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React, { useRef, useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';

vi.mock('@/app/contexts/TreeContext', () => ({ useTree: () => ({ activeTreeId: 1 }) }));
vi.mock('@/lib/data', () => ({ getDataClient: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/app/components/PersonPicker', async () => {
    const R = await import('react');
    const Picker = R.forwardRef<{ focus: () => void }, { placeholder?: string }>(function Picker({ placeholder }, ref) {
        const input = R.useRef<HTMLInputElement>(null);
        R.useImperativeHandle(ref, () => ({ focus: () => input.current?.focus() }));
        return <input ref={input} aria-label={placeholder} />;
    });
    return { default: Picker };
});

import { ChildrenList } from '@/app/families/view/sections';
import { HeroEditorPanel } from '@/app/components/ui';
import { UnsavedChangesProvider } from '@/app/components/UnsavedChangesProvider';
import { escapeToCancel, useEditorFocusReturn } from '@/app/hooks/useEditorFocusReturn';
import type { PartnerPerson } from '@/app/families/view/useFamilyDetail';

function wrap(ui: React.ReactNode) {
    return render(<NextIntlClientProvider locale="en" messages={en}>{ui}</NextIntlClientProvider>);
}

/** Focus a button, then activate it the way Enter would. */
function activate(el: HTMLElement) {
    act(() => el.focus());
    fireEvent.click(el);
}

const escape = (el: Element) => fireEvent.keyDown(el, { key: 'Escape' });

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Add child (#798, KB-2)', () => {
    const kid = { Id: 5, FirstName: 'Kid', LastName: 'One', Sex: null, BirthDate: '1880', DeathDate: null, BirthPlace: null, DeathPlace: null } as PartnerPerson;

    it('focuses the search when it opens, and Escape returns focus to Add child', () => {
        wrap(<ChildrenList childList={[kid]} treeId={1} familyId={1} canEdit canDelete onChanged={() => {}} />);
        activate(screen.getByRole('button', { name: en.editFamily.add_child }));
        const search = screen.getByRole('textbox', { name: en.editFamily.search_child_placeholder });
        expect(search).toHaveFocus();

        escape(search);
        expect(screen.getByRole('button', { name: en.editFamily.add_child })).toHaveFocus();
    });

    it('returns focus to the row’s Edit after its panel closes with Escape', () => {
        wrap(<ChildrenList childList={[kid]} treeId={1} familyId={1} canEdit canDelete onChanged={() => {}} />);
        const editName = en.common.edit_named.replace('{name}', 'Kid One');
        activate(screen.getByRole('button', { name: editName }));
        escape(screen.getByRole('group', { name: editName }));
        expect(screen.queryByRole('group', { name: editName })).toBeNull();
        // The row re-mounted its actions; focus finds the new Edit by its name.
        expect(screen.getByRole('button', { name: editName })).toHaveFocus();
    });
});

describe('useEditorFocusReturn (#798, KB-2)', () => {
    /** A timeline stand-in: a row's Edit swaps the row for an editor, as LifeEventsPanel does. */
    function Rows({ deleteOnSave = false }: { deleteOnSave?: boolean }) {
        const [rows, setRows] = useState(['Birth', 'Death']);
        const [editing, setEditing] = useState<string | null>(null);
        const scope = useRef<HTMLDivElement>(null);
        const remember = useEditorFocusReturn(editing !== null, scope);
        return (
            <div ref={scope} tabIndex={-1} data-testid="scope">
                {rows.map((r) => editing === r ? (
                    <div key={r} role="group" aria-label={`editing ${r}`} onKeyDown={escapeToCancel(() => setEditing(null))}>
                        <input aria-label="date" autoFocus />
                        <button type="button" onClick={() => { if (deleteOnSave) setRows((x) => x.filter((y) => y !== r)); setEditing(null); }}>save</button>
                        <button type="button" aria-expanded="true" aria-label="open list">list</button>
                    </div>
                ) : (
                    <button key={r} type="button" aria-label={`Edit ${r}`} onClick={() => { remember(); setEditing(r); }}>Edit</button>
                ))}
            </div>
        );
    }

    it('focuses the editor’s field, and Escape returns focus to the re-mounted Edit', () => {
        render(<Rows />);
        activate(screen.getByRole('button', { name: 'Edit Death' }));
        expect(screen.getByRole('textbox', { name: 'date' })).toHaveFocus();
        escape(screen.getByRole('textbox', { name: 'date' }));
        expect(screen.getByRole('button', { name: 'Edit Death' })).toHaveFocus();
    });

    it('leaves Escape to an open list inside the editor', () => {
        render(<Rows />);
        activate(screen.getByRole('button', { name: 'Edit Birth' }));
        escape(screen.getByRole('button', { name: 'open list' }));
        expect(screen.getByRole('group', { name: 'editing Birth' })).toBeInTheDocument();
    });

    it('falls back to the section when the row is gone', () => {
        render(<Rows deleteOnSave />);
        activate(screen.getByRole('button', { name: 'Edit Birth' }));
        fireEvent.click(screen.getByRole('button', { name: 'save' }));
        expect(screen.getByTestId('scope')).toHaveFocus();
    });
});

describe('Hero editor Escape (#798, KB-3)', () => {
    function Hero({ dirty, onCancel }: { dirty: boolean; onCancel: () => void }) {
        return (
            <UnsavedChangesProvider>
                <HeroEditorPanel onSave={() => {}} onCancel={onCancel} saving={false} dirty={dirty}>
                    <input aria-label="first name" />
                </HeroEditorPanel>
            </UnsavedChangesProvider>
        );
    }

    it('focuses the first field, and Escape cancels an unchanged editor', () => {
        const onCancel = vi.fn();
        wrap(<Hero dirty={false} onCancel={onCancel} />);
        const field = screen.getByRole('textbox', { name: 'first name' });
        expect(field).toHaveFocus();
        escape(field);
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('asks before Escape discards changes', () => {
        const onCancel = vi.fn();
        // happy-dom has no window.confirm; stub the one the guard calls.
        const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
        vi.stubGlobal('confirm', confirm);
        wrap(<Hero dirty onCancel={onCancel} />);
        const field = screen.getByRole('textbox', { name: 'first name' });
        escape(field);
        expect(confirm).toHaveBeenCalledTimes(1);
        expect(onCancel).not.toHaveBeenCalled();
        escape(field);
        expect(onCancel).toHaveBeenCalledTimes(1);
    });
});
