/** @vitest-environment happy-dom */
import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TagField } from '@/app/components/ui';

function Harness({ initial = [] as string[], onSubmit = () => {} }) {
    const [tags, setTags] = useState(initial);
    return (
        <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
            <TagField
                label="Tags"
                value={tags}
                onChange={setTags}
                removeLabel={(t) => `Remove ${t}`}
                addedLabel={(t) => `Added tag ${t}`}
                removedLabel={(t) => `Removed tag ${t}`}
            />
            <div data-testid="value">{tags.join("|")}</div>
        </form>
    );
}

const value = () => screen.getByTestId('value').textContent;

// The inline tag field (#33): chips and the input in one field.
describe('TagField', () => {
    it('adds on Enter and on a comma, without submitting the form, and keeps focus', async () => {
        const user = userEvent.setup();
        let submitted = 0;
        render(<Harness onSubmit={() => { submitted += 1; }} />);
        const box = screen.getByRole('textbox', { name: 'Tags' });
        await user.type(box, 'parentage{Enter}census,');
        expect(value()).toBe('parentage|census');
        expect(submitted).toBe(0);
        expect(box).toHaveFocus();
        expect(screen.getByRole('status')).toHaveTextContent('Added tag census');
    });

    it('trims, and ignores empties and case-insensitive duplicates', async () => {
        const user = userEvent.setup();
        render(<Harness initial={['Census']} />);
        await user.type(screen.getByRole('textbox', { name: 'Tags' }), '   {Enter} census {Enter}  Leeds {Enter}');
        expect(value()).toBe('Census|Leeds');
    });

    it('adds what was typed when the field loses focus', async () => {
        const user = userEvent.setup();
        render(<Harness />);
        await user.type(screen.getByRole('textbox', { name: 'Tags' }), 'baptism');
        await user.tab();
        expect(value()).toBe('baptism');
    });

    it('removes a chip by its named button and returns focus to the input', async () => {
        const user = userEvent.setup();
        render(<Harness initial={['parentage', 'census']} />);
        await user.click(screen.getByRole('button', { name: 'Remove parentage' }));
        expect(value()).toBe('census');
        expect(screen.getByRole('textbox', { name: 'Tags' })).toHaveFocus();
        expect(screen.getByRole('status')).toHaveTextContent('Removed tag parentage');
    });

    it('selects the last chip on Backspace, then removes it on a second Backspace', async () => {
        const user = userEvent.setup();
        render(<Harness initial={['parentage', 'census']} />);
        await user.click(screen.getByRole('textbox', { name: 'Tags' }));
        await user.keyboard('{Backspace}');
        expect(value()).toBe('parentage|census');
        await user.keyboard('{Backspace}');
        expect(value()).toBe('parentage');
    });
});
