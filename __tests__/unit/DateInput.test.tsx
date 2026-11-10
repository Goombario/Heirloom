/**
 * @vitest-environment happy-dom
 *
 * The composite date control (fuzzy-date-entry spec §1, §2, §2a).
 * next-intl is stubbed to return the key, so assertions key off stable strings
 * rather than English copy; the alias/word lookups are stubbed with the real
 * English vocabulary so hoisting can be exercised.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';

// Params are appended (as JSON) after the key rather than dropped, so tests can
// assert on interpolated values (e.g. chars_remaining's count) without needing
// real translation strings. Existing assertions use substring/regex matches
// against the key, so this is additive and does not change what they see.
vi.mock('next-intl', () => ({
    useTranslations: () => (key: string, params?: Record<string, unknown>) =>
        (params ? `${key} ${JSON.stringify(params)}` : key),
}));
vi.mock('@/app/components/LanguageProvider', () => ({
    useLanguage: () => ({ language: 'en', setLanguage: vi.fn() }),
}));
vi.mock('@/app/components/date-input/aliases', () => ({
    useQualifierAliases: () => ({ ABT: ['about', 'abt', 'ca', 'circa'], BEF: ['before', 'bef'], AFT: ['after', 'aft'] }),
    useDateQualifierWords: () => ({
        ABT: 'ABT', EST: 'EST', CAL: 'CAL', INT: 'INT', BEF: 'BEF', AFT: 'AFT',
        BET: 'BET', AND: 'AND', FROM: 'FROM', TO: 'TO',
    }),
    parseAliasList: (raw: string) => raw.split(',').map((a) => a.trim()).filter(Boolean),
}));

import DateInput from '@/app/components/DateInput';

// The qualifier is a SelectField (a select-only combobox), not a native <select>:
// its raw value is on `data-value`, and choosing opens the list and clicks an option.
const qualifier = () => screen.getByRole('combobox', { name: 'qualifier_label' });
const qualifierValue = () => qualifier().dataset.value;
async function chooseQualifier(user: ReturnType<typeof userEvent.setup>, value: string) {
    await user.click(qualifier());
    const option = screen.getAllByRole('option').find((o) => o.dataset.value === value);
    if (!option) throw new Error(`no qualifier option ${value}`);
    await user.click(option);
}
const firstBox = () => screen.getByLabelText('first_label') as HTMLInputElement;
const secondBox = () => screen.getByLabelText('second_label') as HTMLInputElement;

beforeEach(() => {
    localStorage.clear();
});

/**
 * Render the control the way every real call site does: **controlled**, with the
 * parent feeding what `onChange` emitted straight back in as the next `value`.
 *
 * A static `value` prop cannot see the component's actual behaviour, which is a
 * round trip — `onChange` → parent state → new `value` → the resync effect. Two
 * shipped defects were invisible to a static render and fail immediately here:
 * choosing "Between" over an existing date bounced the select back to "After"
 * (because a half-known BET legally stores as `AFT`, and the resync then read
 * that back), and hoisting a compact form out of the End box silently dropped
 * the first bound. Use this for anything that asserts on state *after* a commit.
 *
 * `current()` is the parent's live value — what would actually be saved.
 */
function renderControlled(initial: string, props: { className?: string } = {}) {
    const onChange = vi.fn();
    let current = initial;
    function Harness() {
        const [value, setValue] = useState(initial);
        return (
            <DateInput
                {...props}
                value={value}
                onChange={(next) => { onChange(next); current = next; setValue(next); }}
            />
        );
    }
    render(<Harness />);
    return { onChange, current: () => current };
}

describe('DateInput — qualifier menu', () => {
    it('defaults to Exact and offers no INT and no free-text option', () => {
        render(<DateInput value="" onChange={vi.fn()} />);
        expect(qualifierValue()).toBe('EXACT');
        fireEvent.click(qualifier());
        const values = screen.getAllByRole('option').map((o) => o.dataset.value);
        expect(values).toEqual(['EXACT', 'ABT', 'EST', 'CAL', 'BEF', 'AFT', 'BET', 'FROM']);
    });

    it('does not call onChange on mount', () => {
        const onChange = vi.fn();
        render(<DateInput value="ABT 1850" onChange={onChange} />);
        expect(onChange).not.toHaveBeenCalled();
    });

    it('stores every qualifier path', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<DateInput value="" onChange={onChange} />);

        await chooseQualifier(user, 'ABT');
        await user.type(firstBox(), '1850');
        await user.tab();
        expect(onChange).toHaveBeenLastCalledWith('ABT 1850');
    });

    it('reveals a second box for a range and stores both bounds', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<DateInput value="" onChange={onChange} />);

        expect(screen.queryByLabelText('second_label')).not.toBeInTheDocument();
        await chooseQualifier(user, 'BET');
        await user.type(firstBox(), '1877');
        await user.type(secondBox(), '1880');
        await user.tab();
        expect(onChange).toHaveBeenLastCalledWith('BET 1877 AND 1880');
    });

    it('stores the legal single-bound form when only one box is filled', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<DateInput value="" onChange={onChange} />);

        await chooseQualifier(user, 'BET');
        await user.type(firstBox(), '1877');
        await user.tab();
        expect(onChange).toHaveBeenLastCalledWith('AFT 1877');
    });

    it('clears the field when the box is emptied', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<DateInput value="ABT 1850" onChange={onChange} />);
        await user.clear(firstBox());
        await user.tab();
        expect(onChange).toHaveBeenLastCalledWith('');
    });

    it('does not resurrect the second bound after switching away from a range and back', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<DateInput value="BET 1877 AND 1880" onChange={onChange} />);
        await chooseQualifier(user, 'ABT');
        expect(onChange).toHaveBeenLastCalledWith('ABT 1877');
        await chooseQualifier(user, 'BET');
        expect(secondBox().value).toBe('');
        expect(onChange).toHaveBeenLastCalledWith('AFT 1877');
    });
});

describe('DateInput — layout widths', () => {
    // fieldClass() starts with w-full, which was correct for the single box this
    // control replaced. Three siblings in one flex row must not each claim 100%.
    const CALLER = 'w-full rounded-lg border border-border bg-card px-3 py-2 text-base';

    it('gives the select and the boxes their own widths, never two width utilities', () => {
        render(<DateInput value="BET 1877 AND 1880" onChange={vi.fn()} className={CALLER} />);
        for (const el of [qualifier(), firstBox(), secondBox()]) {
            const classes = el.className.split(/\s+/);
            expect(classes).not.toContain('w-full');
            expect(classes.filter((c) => c.startsWith('w-')).length).toBeLessThanOrEqual(1);
        }
        expect(qualifier().className).toContain('shrink-0');
        expect(firstBox().className).toContain('flex-1');
        // Chrome from the caller survives — only the width was swapped.
        expect(firstBox().className).toContain('rounded-lg');
    });

    it('still applies a width when the caller passes none', () => {
        render(<DateInput value="" onChange={vi.fn()} className="rounded-lg" />);
        expect(firstBox().className).toContain('flex-1');
        expect(firstBox().className).toContain('rounded-lg');
    });

    it('gives the boxes field chrome when the caller passes no class at all', () => {
        // The lightbox date field passed none and rendered a bare box.
        render(<DateInput value="BET 1877 AND 1880" onChange={vi.fn()} stacked />);
        for (const el of [firstBox(), secondBox()]) {
            expect(el.className).toContain('border-border');
            expect(el.className).toContain('bg-card');
        }
    });
});

describe('DateInput — loading a stored value', () => {
    it.each([
        ['ABT 1850', 'ABT', '1850', null],
        ['BET 1877 AND 1880', 'BET', '1877', '1880'],
        ['FROM 1901 TO 1905', 'FROM', '1901', '1905'],
        ['FROM 1901', 'FROM', '1901', ''],
        ['TO 1905', 'FROM', '', '1905'],
        // A half-known BET was stored as AFT, and reads back as After — showing
        // "Between" with one empty box would be the control lying about the record.
        ['AFT 1877', 'AFT', '1877', null],
        ['BEF 1880', 'BEF', '1880', null],
    ])('%s → select %s', (value, expectedQualifier, first, second) => {
        render(<DateInput value={value} onChange={vi.fn()} />);
        expect(qualifierValue()).toBe(expectedQualifier);
        expect(firstBox().value).toBe(first);
        if (second === null) {
            expect(screen.queryByLabelText('second_label')).not.toBeInTheDocument();
        } else {
            expect(secondBox().value).toBe(second);
        }
    });
});

describe('DateInput — hoisting (§2a)', () => {
    it.each([
        ['~1850', 'ABT', '1850'],
        ['<1920', 'BEF', '1920'],
        ['>1850', 'AFT', '1850'],
        ['abt. 1850', 'ABT', '1850'],
        ['ca 1850', 'ABT', '1850'],
        ['circa 1850', 'ABT', '1850'],
    ])('%s moves the qualifier into the select on blur', async (typed, expectedQualifier, expectedBox) => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<DateInput value="" onChange={onChange} />);
        await user.type(firstBox(), typed);
        await user.tab();
        expect(qualifierValue()).toBe(expectedQualifier);
        expect(firstBox().value).toBe(expectedBox);
        expect(onChange).toHaveBeenLastCalledWith(`${expectedQualifier} ${expectedBox}`);
    });

    it('hoists a typed year range into both boxes', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<DateInput value="" onChange={onChange} />);
        await user.type(firstBox(), '1877-1880');
        await user.tab();
        expect(qualifierValue()).toBe('BET');
        expect(firstBox().value).toBe('1877');
        expect(secondBox().value).toBe('1880');
        expect(onChange).toHaveBeenLastCalledWith('BET 1877 AND 1880');
    });
});

describe('DateInput — unparseable input (#475, §4)', () => {
    it('surfaces a choice instead of silently discarding the text', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<DateInput value="" onChange={onChange} />);

        await user.type(firstBox(), 'harvest time 1850');
        await user.tab();

        expect(screen.getByRole('alert')).toHaveTextContent('unparsed_title');
        expect(screen.getByRole('button', { name: 'keep_as_written' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'let_me_fix' })).toBeInTheDocument();
        // Unresolved: nothing bogus is committed, but nothing is lost either.
        expect(onChange).not.toHaveBeenCalled();
        expect(firstBox().value).toBe('harvest time 1850');
    });

    it('Keep as written stores the text as a date phrase', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<DateInput value="" onChange={onChange} />);

        await user.type(firstBox(), 'harvest time 1850');
        await user.tab();
        await user.click(screen.getByRole('button', { name: 'keep_as_written' }));

        expect(onChange).toHaveBeenLastCalledWith('(harvest time 1850)');
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('Let me fix it returns focus to the box and commits nothing', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<DateInput value="" onChange={onChange} />);

        await user.type(firstBox(), 'harvest time 1850');
        await user.tab();
        await user.click(screen.getByRole('button', { name: 'let_me_fix' }));

        expect(firstBox()).toHaveFocus();
        expect(onChange).not.toHaveBeenCalled();
    });

    it('shows the truncated result before committing over-length text', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<DateInput value="" onChange={onChange} />);

        const long = 'sometime around the great harvest of that long year';
        await user.type(firstBox(), long);
        await user.tab();

        expect(screen.getByRole('alert')).toHaveTextContent('phrase_truncated');
        await user.click(screen.getByRole('button', { name: 'keep_as_written' }));
        expect(onChange).toHaveBeenLastCalledWith(`(${long.slice(0, 35).trim()})`);
    });

    it('Keep as written combines both boxes of a BET range when only the second fails to parse', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<DateInput value="" onChange={onChange} />);

        await chooseQualifier(user, 'BET');
        await user.type(firstBox(), '1877');
        await user.type(secondBox(), 'some day');
        await user.tab();

        expect(screen.getByRole('alert')).toHaveTextContent('unparsed_title');
        await user.click(screen.getByRole('button', { name: 'keep_as_written' }));

        // Neither bound is silently dropped (#475): the parsed first box and the
        // unparseable second box are combined into a single phrase.
        expect(onChange).toHaveBeenLastCalledWith('(1877 - some day)');
    });

    it('previews the exact text that will be stored when the unparsed text contains parentheses', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<DateInput value="" onChange={onChange} />);

        // 20 a's + "(bbb)" + 20 c's = 45 raw chars. makeDatePhrase strips the
        // parentheses before capping, so the correct 35-char preview is
        // 20 a's + "bbb" + 12 c's — NOT a naive slice of the raw text, which would
        // still contain the literal "(" and ")" and only 10 c's.
        const long = `${'a'.repeat(20)}(bbb)${'c'.repeat(20)}`;
        const correctPreview = `${'a'.repeat(20)}bbb${'c'.repeat(12)}`;
        const naiveSlice = long.slice(0, 35).trim();
        expect(correctPreview).not.toBe(naiveSlice);

        await user.type(firstBox(), long);
        await user.tab();

        expect(screen.getByRole('alert')).toHaveTextContent(correctPreview);
        await user.click(screen.getByRole('button', { name: 'keep_as_written' }));
        expect(onChange).toHaveBeenLastCalledWith(`(${correctPreview})`);
    });
});

describe('DateInput — phrase mode (§3)', () => {
    it('renders a stored phrase as a single free-text box with no qualifier menu', () => {
        render(<DateInput value="(harvest time)" onChange={vi.fn()} />);
        expect(screen.queryByLabelText('qualifier_label')).not.toBeInTheDocument();
        const box = screen.getByLabelText('phrase_label') as HTMLInputElement;
        expect(box.value).toBe('harvest time');
        expect(box.maxLength).toBe(35);
    });

    it('shows a live remaining-character count', () => {
        render(<DateInput value="(harvest time)" onChange={vi.fn()} />);
        expect(screen.getByText(/chars_remaining/)).toBeInTheDocument();
    });

    it('clamps the remaining-character count at zero for a pre-cap phrase loaded over the limit', () => {
        // A phrase longer than DATE_PHRASE_MAX can arrive from a GEDCOM import that
        // predates the cap; the count must never go negative.
        render(<DateInput value={`(${'a'.repeat(40)})`} onChange={vi.fn()} />);
        expect(screen.getByText('chars_remaining {"count":0}')).toBeInTheDocument();
    });

    it('does not promote a phrase whose text parses as a date', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<DateInput value="(abt 1850)" onChange={onChange} />);
        const box = screen.getByLabelText('phrase_label');
        await user.click(box);
        await user.tab();
        expect(onChange).not.toHaveBeenCalled();
    });

    it('clearing the phrase empties the field', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<DateInput value="(harvest time)" onChange={onChange} />);
        await user.clear(screen.getByLabelText('phrase_label'));
        await user.tab();
        expect(onChange).toHaveBeenLastCalledWith('');
    });
});

describe('DateInput — controlled round trip (regressions)', () => {
    it('keeps Between selected after choosing it over an existing date', async () => {
        const user = userEvent.setup();
        const c = renderControlled('1850');

        await chooseQualifier(user, 'BET');

        // A half-known BET legally stores as `AFT 1850` (§2), and the value does
        // come back that way — but the mode the user just chose is theirs to keep
        // until they re-enter the field, otherwise the second box vanishes before
        // they can reach it.
        expect(c.current()).toBe('AFT 1850');
        expect(qualifierValue()).toBe('BET');
        expect(screen.getByLabelText('second_label')).toBeInTheDocument();

        await user.type(secondBox(), '1880');
        await user.tab();
        expect(c.current()).toBe('BET 1850 AND 1880');
    });

    it('still decomposes a value that arrives from outside the control', () => {
        // The reload path must be untouched: a stored AFT reads back as After.
        render(<DateInput value="AFT 1850" onChange={vi.fn()} />);
        expect(qualifierValue()).toBe('AFT');
        expect(screen.queryByLabelText('second_label')).not.toBeInTheDocument();
    });

    it('does not eat the first bound when a compact form is typed into the End box', async () => {
        const user = userEvent.setup();
        const c = renderControlled('BET 1877 AND 1880');

        await user.clear(secondBox());
        await user.type(secondBox(), '~1905');
        await user.tab();

        // `~1905` is this app's own compact display form, so pasting it back is a
        // real loop. GEDCOM has no per-bound qualifier inside BET, so the marker
        // is dropped — but the 1877 bound is a date and must survive.
        expect(c.current()).toBe('BET 1877 AND 1905');
        expect(qualifierValue()).toBe('BET');
        expect(firstBox().value).toBe('1877');
        expect(secondBox().value).toBe('1905');
    });

    it('does not shorten an imported over-length phrase on focus+blur alone', async () => {
        const user = userEvent.setup();
        const long = 'a'.repeat(40);
        const c = renderControlled(`(${long})`);

        await user.click(screen.getByLabelText('phrase_label'));
        await user.tab();

        // maxLength caps *typing*; a longer value can arrive from an import, and
        // tabbing through the field must not rewrite the record (§3).
        expect(c.onChange).not.toHaveBeenCalled();
        expect(c.current()).toBe(`(${long})`);
    });

    it('confirms before shortening an over-length phrase the user did edit', async () => {
        const user = userEvent.setup();
        const long = 'a'.repeat(40);
        const c = renderControlled(`(${long})`);

        const box = screen.getByLabelText('phrase_label');
        await user.click(box);
        await user.keyboard('{End}{Backspace}');
        await user.tab();

        expect(screen.getByRole('alert')).toHaveTextContent('phrase_truncated');
        expect(c.onChange).not.toHaveBeenCalled();

        await user.click(screen.getByRole('button', { name: 'keep_as_written' }));
        expect(c.current()).toBe(`(${'a'.repeat(35)})`);
    });

    it('re-renders an edited phrase as the cleaned value that was saved', async () => {
        const user = userEvent.setup();
        const c = renderControlled('(harvest time)');
        const box = screen.getByLabelText('phrase_label');

        await user.clear(box);
        await user.type(box, '  the  (fire)  ');
        await user.tab();

        expect(c.current()).toBe('(the fire)');
        expect(box).toHaveValue('the fire');
    });

    it('does not re-cap an untouched over-length INT phrase', async () => {
        const user = userEvent.setup();
        const stored = `INT 1850 (${'b'.repeat(40)})`;
        const c = renderControlled(stored);

        await user.click(screen.getByLabelText('raw_label'));
        await user.tab();

        expect(c.onChange).not.toHaveBeenCalled();
        expect(c.current()).toBe(stored);
    });

    it('asks before shortening an edited INT phrase and saves the accepted result', async () => {
        const user = userEvent.setup();
        const long = 'b'.repeat(40);
        const c = renderControlled('INT 1850 (the fire)');
        const box = screen.getByLabelText('raw_label');

        await user.clear(box);
        await user.type(box, `INT 1850 (${long})`);
        await user.tab();

        expect(screen.getByRole('alert')).toHaveTextContent('phrase_truncated');
        expect(c.onChange).not.toHaveBeenCalled();

        await user.click(screen.getByRole('button', { name: 'keep_as_written' }));
        expect(c.current()).toBe(`INT 1850 (${'b'.repeat(35)})`);
        expect(box).toHaveValue(`INT 1850 (${'b'.repeat(35)})`);
    });

    it('returns focus to the RAW box when the user chooses to fix an overlong INT phrase', async () => {
        const user = userEvent.setup();
        renderControlled('INT 1850 (the fire)');
        const box = screen.getByLabelText('raw_label');

        await user.clear(box);
        await user.type(box, `INT 1850 (${'b'.repeat(40)})`);
        await user.tab();
        await user.click(screen.getByRole('button', { name: 'let_me_fix' }));

        expect(box).toHaveFocus();
    });

    it('re-renders a normal edited INT value as the parsed value that was saved', async () => {
        const user = userEvent.setup();
        const c = renderControlled('INT 1850 (the fire)');
        const box = screen.getByLabelText('raw_label');

        await user.clear(box);
        await user.type(box, 'INT 15 Mar 1850 (the fire)');
        await user.tab();

        expect(c.current()).toBe('INT 1850-03-15 (the fire)');
        expect(box).toHaveValue('INT 1850-03-15 (the fire)');
    });
});

describe('DateInput — INT round-trips through the raw box', () => {
    it('edits an INT value whole and stores it unchanged', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<DateInput value="INT 1850 (the fire)" onChange={onChange} />);
        const box = screen.getByLabelText('raw_label') as HTMLInputElement;
        expect(box.value).toBe('INT 1850 (the fire)');
        await user.click(box);
        await user.tab();
        expect(onChange).not.toHaveBeenCalled();
    });
});
