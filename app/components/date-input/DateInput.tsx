'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { parseUserDateInput, formatDateForInput } from '@/lib/date-utils';
import {
    DATE_PHRASE_MAX,
    composeDateValue,
    decomposeDateValue,
    datePhraseText,
    hoistQualifier,
    makeDatePhrase,
    phraseWouldTruncate,
    type DateInputParts,
    type DateInputMode,
    type QualifierAliases,
} from '@/lib/date-qualifiers';
import { useLanguage } from '@/app/components/LanguageProvider';
import { Button, SelectField, cx, fieldClass } from '@/app/components/ui';
import { useQualifierAliases } from './aliases';

interface DateInputProps {
    value: string;
    onChange: (value: string) => void;
    /** Field class for the boxes; defaults to `fieldClass()`, as the select does. */
    className?: string;
    placeholder?: string;
    id?: string;
    /** Kind above the date instead of beside it, for a narrow panel (#797, M-2). */
    stacked?: boolean;
    /**
     * As you type: the value leaving the box now would commit, or null when it
     * would stop to ask first (§4). `onChange` still fires only on commit (#832).
     */
    onDraft?: (value: string | null) => void;
    /**
     * The phone's typing sheets (design-system.md → Mobile → Sheets): the same
     * Kind · date · About row with a wider Kind menu, and a range's second box on
     * its own row with "and"/"to" under the menu (#64, ADR 0048).
     */
    touch?: boolean;
}

/**
 * What kind of date the field holds (ADR 0048). How sure an On date is lives in
 * the About box, not here: GEDCOM can't qualify a range, so About is offered
 * only for On.
 */
type DateKind = 'ON' | 'BEF' | 'AFT' | 'BET' | 'FROM';
const DATE_KINDS: DateKind[] = ['ON', 'BEF', 'AFT', 'BET', 'FROM'];
const KIND_KEY: Record<DateKind, string> = {
    ON: 'kind_on', BEF: 'kind_bef', AFT: 'kind_aft', BET: 'kind_bet', FROM: 'kind_from',
};

function kindOf(mode: DateInputMode): DateKind {
    return mode === 'BEF' || mode === 'AFT' || mode === 'BET' || mode === 'FROM' ? mode : 'ON';
}

/** About, or an imported Estimated or Calculated, which About keeps as it is (ADR 0048 §4). */
function isApproximate(mode: DateInputMode): boolean {
    return mode === 'ABT' || mode === 'EST' || mode === 'CAL';
}

/** Which modes show a second box. */
function hasRange(mode: DateInputMode): boolean {
    return mode === 'BET' || mode === 'FROM';
}

/**
 * Swap the width utility in a caller-supplied field class string.
 *
 * Call sites pass `fieldClass()`, which begins with `w-full` — correct for the
 * single box this control used to be, wrong now that a select and up to two
 * boxes share one row. Appending a width would leave two competing utilities and
 * let stylesheet order decide the winner (see `fieldClass`'s docblock), so the
 * token is replaced rather than added.
 */
function withWidth(cls: string | undefined, width: string): string {
    if (!cls) return width;
    return cls.split(/\s+/).filter(Boolean).map((c) => (c === 'w-full' ? width : c)).concat(
        cls.includes('w-full') ? [] : [width],
    ).join(' ');
}

/**
 * What a date box's text commits as when it's left: the new parts, and which
 * boxes re-render from them. Null when the parser can't read it, which leaves
 * the §4 choice to the caller. Shared by blur and by the live draft (#832).
 */
function readBox(
    parts: DateInputParts, box: 'first' | 'second', raw: string, aliases: QualifierAliases, order: 'MDY' | 'DMY',
): { next: DateInputParts; shown: Array<'first' | 'second'> } | null {
    if (!raw) return { next: { ...parts, [box]: '' } as DateInputParts, shown: [box] };

    // §2a: a typed or pasted qualifier moves into the select and the box keeps
    // the plain remainder. Fires on blur, at the same moment the box text loses
    // its token, so the two changes read as one "understood you" event.
    const hoisted = hoistQualifier(raw, aliases);
    // A hoist out of the END box may only take over the whole field when the
    // text itself carries BOTH bounds (a pasted "1877-1880", "BET x AND y").
    // Anything else — "~1905", "to 1905" — describes one bound, and applying
    // its qualifier to the field would rewrite `parts.first` out of existence:
    // `{ABT, 1877, 1905}` composes to `ABT 1877`, and the End box the user was
    // actually editing is what survives, so `BET 1877 AND 1880` + "~1905"
    // silently became `ABT 1905`. Losing a stated bound is a data loss; losing
    // the `~` is not, because GEDCOM has no per-bound qualifier inside a
    // BET/FROM range and the box visibly re-renders without it.
    const hoistOwnsBothBounds = Boolean(hoisted?.first && hoisted?.second);
    if (hoisted && box === 'second' && !hoistOwnsBothBounds) {
        const remainder = hoisted.second || hoisted.first;
        const parsed = remainder ? parseUserDateInput(remainder, order) : '';
        if (parsed !== null) return { next: { ...parts, second: parsed } as DateInputParts, shown: ['second'] };
    } else if (hoisted) {
        const first = hoisted.first ? parseUserDateInput(hoisted.first, order) : '';
        const second = hoisted.second ? parseUserDateInput(hoisted.second, order) : '';
        if (first !== null && second !== null) {
            return { next: { qualifier: hoisted.qualifier, first, second }, shown: ['first', 'second'] };
        }
    }

    const parsed = parseUserDateInput(raw, order);
    return parsed !== null ? { next: { ...parts, [box]: parsed } as DateInputParts, shown: [box] } : null;
}

/** Set on a DateInput's root while a box holds uncommitted text. */
const DATE_DRAFT_ATTR = 'data-date-draft';

/** True when a date box inside `root` holds text it hasn't reported yet (#861). */
export function hasUncommittedDate(root: Element | null | undefined): boolean {
    return !!root?.querySelector(`[${DATE_DRAFT_ATTR}]`);
}

/**
 * The date control: a Kind menu (On, Before, After, Between, From), one or two
 * plain-date boxes, and an About checkbox for an On date (spec §1, ADR 0048).
 *
 * The load-bearing simplification is that the inner boxes hold PLAIN dates only
 * and reuse the existing parse/format paths unchanged — the qualifier lives in the
 * translated Kind menu and About box, so nobody has to type a GEDCOM token in any language.
 * Typed shorthand still works via hoisting (§2a), but that is a convenience: if
 * the alias table for a language were empty, the control would still work.
 *
 * The stored string format does not change; this only produces values date-utils
 * and the GEDCOM generator already handle.
 */
export default function DateInput({ value, onChange, className = fieldClass(), placeholder, id, stacked = false, onDraft, touch = false }: DateInputProps) {
    const t = useTranslations('dateInput');
    const { language } = useLanguage();
    const aliases = useQualifierAliases();

    const [parts, setParts] = useState<DateInputParts>(() => decomposeDateValue(value));
    const [firstText, setFirstText] = useState(() => initialBoxText(decomposeDateValue(value), 'first', language));
    const [secondText, setSecondText] = useState(() => initialBoxText(decomposeDateValue(value), 'second', language));
    const focusedRef = useRef(false);
    // The value this control itself last emitted, set in `commit` and cleared by
    // the resync effect that sees it come back. See that effect for why.
    const selfEmittedRef = useRef<string | null>(null);
    const languageRef = useRef(language);

    // Mirror of `parts` for the resync effect below, which needs the latest parts
    // but must not list them as a dependency: re-running that effect on a parts
    // change would have it re-read `value` and undo the mode the user just chose.
    // Declared first so it is already updated when that effect runs in the same
    // commit.
    const partsRef = useRef(parts);
    useEffect(() => { partsRef.current = parts; });

    // Unresolved unparseable input (§4). While set, the field is in a visible
    // unresolved state: nothing bogus is committed, nothing is silently lost.
    const [pending, setPending] = useState<{
        box: 'first' | 'second';
        raw: string;
        /** An edited INT value after its phrase has been cleaned/capped. */
        acceptedRaw?: string;
    } | null>(null);
    const firstRef = useRef<HTMLInputElement>(null);
    const secondRef = useRef<HTMLInputElement>(null);

    // Resync when the value changes externally (form reset, record load) — but not
    // mid-edit, which would fight the user's typing.
    useEffect(() => {
        if (focusedRef.current) return;
        const languageChanged = languageRef.current !== language;
        languageRef.current = language;
        const echo = selfEmittedRef.current;
        selfEmittedRef.current = null;

        // The seam. Every call site is a controlled parent, so what `commit` emits
        // comes straight back in as `value` — and re-reading our own echo would
        // downgrade the mode the user just chose, because a half-known range is
        // *stored* narrowed (§2: a BET with one bound is written `AFT`, a FROM with
        // only an end is written `TO`). That is what made "Between … and …" flip
        // the select back to "After" and take the second box away before the user
        // could reach it. The chosen mode stays theirs until the value is re-entered.
        //
        // Matching on the exact string we emitted (rather than on "does this compose
        // to the same thing?") keeps the reload path honest: a value that genuinely
        // arrives from outside — another record loaded, a form reset, a parent that
        // rewrote what we sent — is not an echo, so it still decomposes faithfully
        // and a stored `AFT 1850` still reads back as After.
        if (echo !== null && echo === (value ?? '').trim()) {
            // Nothing to re-read, but a language switch must still re-render the
            // box text in the new locale.
            if (languageChanged) {
                setFirstText(initialBoxText(partsRef.current, 'first', language));
                setSecondText(initialBoxText(partsRef.current, 'second', language));
            }
            return;
        }

        const next = decomposeDateValue(value);
        setParts(next);
        setFirstText(initialBoxText(next, 'first', language));
        setSecondText(initialBoxText(next, 'second', language));
    }, [value, language]);

    /** Commit new state upward. Never called on mount. */
    const commit = useCallback((next: DateInputParts) => {
        setParts(next);
        const composed = composeDateValue(next);
        onDraft?.(composed);
        if (composed !== value) {
            selfEmittedRef.current = composed;
            onChange(composed);
        }
    }, [onChange, onDraft, value]);

    function slashOrder(): 'MDY' | 'DMY' {
        return (localStorage.getItem('dateSlashFormat') ?? 'MDY') as 'MDY' | 'DMY';
    }

    /** A new kind. Moving to On starts unticked; a range or an open end can't be About. */
    function handleKindChange(kind: DateKind) {
        if (kind === kindOf(parts.qualifier)) return;
        handleQualifierChange(kind === 'ON' ? 'EXACT' : kind);
    }

    /** Ticking writes About; unticking clears it, an imported Estimated or Calculated too. */
    function handleAboutChange(checked: boolean) {
        handleQualifierChange(checked ? 'ABT' : 'EXACT');
    }

    function handleQualifierChange(qualifier: DateInputMode) {
        // Leaving a range mode drops the second bound, which no other mode can store.
        const second = hasRange(qualifier) ? parts.second : '';
        if (!hasRange(qualifier)) setSecondText('');
        commit({ ...parts, qualifier, second });
    }

    /** Blur of a date box: hoist, parse, commit. */
    function handleBoxBlur(box: 'first' | 'second') {
        focusedRef.current = false;
        const raw = (box === 'first' ? firstText : secondText).trim();
        const read = readBox(parts, box, raw, aliases, slashOrder());
        if (read) {
            if (read.shown.includes('first')) setFirstText(read.next.first ? formatDateForInput(read.next.first, language) : '');
            if (read.shown.includes('second')) setSecondText(read.next.second ? formatDateForInput(read.next.second, language) : '');
            commit(read.next);
            return;
        }

        // The parser could not read this. Surface a visible, unresolved choice
        // rather than either silently discarding the text or committing a bogus
        // value (#475, §4).
        onUnparseable(box, raw);
    }

    /** A box's text changed: tell a caller that previews drafts what leaving it would commit. */
    function draftBox(box: 'first' | 'second', text: string) {
        if (!onDraft) return;
        const read = readBox(parts, box, text.trim(), aliases, slashOrder());
        onDraft(read ? composeDateValue(read.next) : null);
    }

    /** Phrase mode's draft: what its blur would commit, or null when it would ask to shorten. */
    function draftPhrase(text: string): string | null {
        if (text === parts.first) return composeDateValue(parts);
        if (phraseWouldTruncate(text)) return null;
        return composeDateValue({ qualifier: 'PHRASE', first: makeDatePhrase(text).slice(1, -1), second: '' });
    }

    /** INT mode's draft, the same way. */
    function draftRaw(value: string): string | null {
        const text = value.trim();
        if (text === parts.first) return composeDateValue(parts);
        const phrase = datePhraseText(text);
        if (phrase !== null && phraseWouldTruncate(phrase)) return null;
        return composeDateValue({ qualifier: 'RAW', first: parseUserDateInput(text, slashOrder()) ?? text, second: '' });
    }

    function onUnparseable(box: 'first' | 'second', raw: string) {
        setPending({ box, raw });
    }

    /**
     * §4 "Keep as written" text, before it is capped/parenthesised by
     * `makeDatePhrase`. In a two-box mode (BET/FROM) with a non-empty other box,
     * both boxes' current text are combined — losing only the box that failed to
     * parse would silently drop the other bound, exactly the failure #475 exists
     * to close. Order is always first-box-then-second-box, regardless of which
     * box raised the prompt.
     */
    function pendingCombinedText(): string {
        if (!pending) return '';
        const other = pending.box === 'first' ? secondText : firstText;
        if (hasRange(parts.qualifier) && other.trim()) {
            return pending.box === 'first' ? `${pending.raw} - ${other}` : `${other} - ${pending.raw}`;
        }
        return pending.raw;
    }

    /** §4 "Keep as written": preserve the text as a date phrase rather than lose it. */
    function keepAsWritten() {
        if (!pending) return;
        if (pending.acceptedRaw !== undefined) {
            setFirstText(pending.acceptedRaw);
            setSecondText('');
            commit({ qualifier: 'RAW', first: pending.acceptedRaw, second: '' });
            setPending(null);
            return;
        }
        // Commit the text exactly as it will be stored — cleaned and, if the user
        // has just accepted it, capped — so the box and the record agree afterwards
        // rather than the box showing text longer than what was saved.
        const text = makeDatePhrase(pendingCombinedText()).slice(1, -1);
        setFirstText(text);
        setSecondText('');
        commit({ qualifier: 'PHRASE', first: text, second: '' });
        setPending(null);
    }

    /**
     * The §4 prompt. `showUnparsedTitle` is false in phrase mode, where the text is
     * already known to be prose and the only question is the length cap.
     *
     * The preview runs the combined text through the real `makeDatePhrase`, and the
     * "will it be shortened?" test through `phraseWouldTruncate`, which shares its
     * cleaning — so neither can drift from what is actually stored.
     */
    function pendingAlert(showUnparsedTitle: boolean) {
        if (!pending) return null;
        const combined = pendingCombinedText();
        const acceptedPhrase = pending.acceptedRaw ? datePhraseText(pending.acceptedRaw) : null;
        const preview = acceptedPhrase ?? makeDatePhrase(combined).slice(1, -1);
        const willTruncate = pending.acceptedRaw !== undefined || phraseWouldTruncate(combined);
        return (
            <div role="alert" className="mt-1 text-xs text-error">
                {/* Icon + text: colour is never the only cue. */}
                {showUnparsedTitle && (
                    <p className="mb-1"><span aria-hidden="true">⚠ </span>{t('unparsed_title')}</p>
                )}
                {willTruncate && (
                    <p className="mb-1 text-text-secondary">
                        {!showUnparsedTitle && <span aria-hidden="true">⚠ </span>}
                        {t('phrase_truncated', { text: preview })}
                    </p>
                )}
                <Button type="button" variant="outline" size="sm" className="mr-1.5" onClick={keepAsWritten}>
                    {t('keep_as_written')}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={letMeFix}>
                    {t('let_me_fix')}
                </Button>
            </div>
        );
    }

    /** §4 "Let me fix it": back to the box, nothing committed. */
    function letMeFix() {
        const box = pending?.box;
        setPending(null);
        (box === 'second' ? secondRef : firstRef).current?.focus();
    }

    // A box holding text it hasn't committed: `onChange` fires only on blur, so an
    // editor's Escape handler reads this marker to ask before discarding (#861).
    const drafting = pending !== null
        || firstText !== initialBoxText(parts, 'first', language)
        || secondText !== initialBoxText(parts, 'second', language);
    const draftMark = { [DATE_DRAFT_ATTR]: drafting ? '' : undefined };

    // §3: a field already holding a date phrase renders as one free-text box. This
    // state is reached only by the §4 prompt or by loading a record that carries a
    // phrase — never by picking it from the menu, because offering free text up
    // front invites it where a real date is known.
    if (parts.qualifier === 'PHRASE') {
        const remaining = Math.max(0, DATE_PHRASE_MAX - firstText.length);
        return (
            <div {...draftMark}>
                <input
                    id={id}
                    type="text"
                    aria-label={t('phrase_label')}
                    ref={firstRef}
                    maxLength={DATE_PHRASE_MAX}
                    value={firstText}
                    onChange={(e) => { setPending(null); setFirstText(e.target.value); onDraft?.(draftPhrase(e.target.value)); }}
                    onFocus={() => { focusedRef.current = true; }}
                    onBlur={() => {
                        focusedRef.current = false;
                        // `maxLength` caps *typing*; a longer phrase still arrives
                        // from an import, where `parseDate` keeps a bare `(phrase)`
                        // verbatim and uncapped on purpose. Untouched text is never
                        // re-committed, so merely tabbing through the field cannot
                        // rewrite the record (§3: text is never silently shortened
                        // after the fact).
                        if (firstText === parts.first) return;
                        // An edit that genuinely has to be shortened asks first,
                        // through the same prompt §4 already uses.
                        if (phraseWouldTruncate(firstText)) {
                            setPending({ box: 'first', raw: firstText });
                            return;
                        }
                        // Emptying the box empties the field; the next resync then
                        // returns the composite control.
                        const text = makeDatePhrase(firstText).slice(1, -1);
                        setFirstText(text);
                        commit({ qualifier: 'PHRASE', first: text, second: '' });
                    }}
                    className={className}
                />
                <p className="mt-1 text-xs text-text-muted">{t('chars_remaining', { count: remaining })}</p>
                {pendingAlert(false)}
            </div>
        );
    }

    // An INT value carries both a date and a phrase and has no menu entry; edit it
    // whole so it round-trips exactly.
    if (parts.qualifier === 'RAW') {
        return (
            <div {...draftMark}>
                <input
                    id={id}
                    type="text"
                    // With an id, the caller's <label for> names the box ("Death date", #798).
                    aria-label={id ? undefined : t('raw_label')}
                    ref={firstRef}
                    value={firstText}
                    onChange={(e) => { setPending(null); setFirstText(e.target.value); onDraft?.(draftRaw(e.target.value)); }}
                    onFocus={() => { focusedRef.current = true; }}
                    onBlur={() => {
                        focusedRef.current = false;
                        const text = firstText.trim();
                        // Same rule as phrase mode: an untouched value — an import may
                        // have written an INT whose phrase is over the 35-character cap
                        // — is not re-normalised, and so not re-capped, merely because
                        // the field was focused and left (§3).
                        if (text === parts.first) return;
                        const parsed = parseUserDateInput(text, slashOrder());
                        const committed = parsed ?? text;
                        const phrase = datePhraseText(text);
                        if (phrase !== null && phraseWouldTruncate(phrase)) {
                            setPending({ box: 'first', raw: text, acceptedRaw: committed });
                            return;
                        }
                        setFirstText(committed);
                        commit({ qualifier: 'RAW', first: committed, second: '' });
                    }}
                    className={className}
                />
                {pendingAlert(false)}
            </div>
        );
    }

    const kind = kindOf(parts.qualifier);
    const range = hasRange(parts.qualifier);
    const kindWidth = touch ? 'w-[112px]' : stacked ? 'w-full' : 'w-auto';
    const kindMenu = (
        <SelectField<DateKind>
            aria-label={t('kind_label')}
            value={kind}
            onChange={handleKindChange}
            fieldClassName={className ? withWidth(className, cx(kindWidth, 'shrink-0')) : undefined}
            width={kindWidth}
            className="shrink-0"
            options={DATE_KINDS.map((k) => ({ value: k, label: t(KIND_KEY[k]) }))}
        />
    );
    const boxWidth = 'flex-1 min-w-[7rem]';
    const firstBox = (
        <input
            id={id}
            type="text"
            // With an id, the caller's <label for> names the box ("Death date", #798).
            aria-label={id ? undefined : t('first_label')}
            ref={firstRef}
            value={firstText}
            onChange={(e) => { setPending(null); setFirstText(e.target.value); draftBox('first', e.target.value); }}
            onFocus={() => { focusedRef.current = true; }}
            onBlur={() => handleBoxBlur('first')}
            className={withWidth(className, boxWidth)}
            placeholder={placeholder || t('placeholder')}
        />
    );
    const connector = (
        <span className={cx('text-text-muted text-sm', touch ? 'w-[112px] shrink-0 text-right pr-1' : 'px-0.5')}>
            {parts.qualifier === 'BET' ? t('conn_and') : t('conn_to')}
        </span>
    );
    const secondBox = (
        <input
            type="text"
            aria-label={t('second_label')}
            ref={secondRef}
            value={secondText}
            onChange={(e) => { setPending(null); setSecondText(e.target.value); draftBox('second', e.target.value); }}
            onFocus={() => { focusedRef.current = true; }}
            onBlur={() => handleBoxBlur('second')}
            className={withWidth(className, boxWidth)}
            placeholder={placeholder || t('placeholder')}
        />
    );
    // About sits at the row's end, like "On 1850, about"; it wraps under the box
    // when a narrow panel runs out of room (ADR 0048, layout A).
    const about = kind === 'ON' && (
        <label className={cx('inline-flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap text-base text-text', touch ? 'min-h-11 pl-1' : 'min-h-9')}>
            <input
                type="checkbox"
                checked={isApproximate(parts.qualifier)}
                onChange={(e) => handleAboutChange(e.target.checked)}
                className="w-4 h-4 m-0"
            />
            {t('about_label')}
        </label>
    );

    return (
        <div {...draftMark}>
            {stacked ? (
                <div className="flex flex-col gap-1.5 w-full">
                    {kindMenu}
                    <div className="flex flex-wrap items-center gap-1.5 w-full">
                        {firstBox}
                        {about}
                        {range && <>{connector}{secondBox}</>}
                    </div>
                </div>
            ) : touch ? (
                <div className="flex flex-col gap-2 w-full">
                    <div className="flex items-center gap-2 w-full">
                        {kindMenu}
                        {firstBox}
                        {about}
                    </div>
                    {range && <div className="flex items-center gap-2 w-full">{connector}{secondBox}</div>}
                </div>
            ) : (
                <div className="date-field-row flex flex-wrap items-center gap-1.5 w-full">
                    {kindMenu}
                    {firstBox}
                    {about}
                    {range && <>{connector}{secondBox}</>}
                </div>
            )}
            {pendingAlert(true)}
        </div>
    );
}

function initialBoxText(next: DateInputParts, which: 'first' | 'second', locale: string): string {
    const raw = next[which];
    if (!raw) return '';
    if (next.qualifier === 'PHRASE' || next.qualifier === 'RAW') return raw;
    return formatDateForInput(raw, locale);
}
