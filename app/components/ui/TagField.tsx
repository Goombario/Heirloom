'use client';

import { useRef, useState } from 'react';
import { X } from '@/lib/icons';
import { Badge } from './Badge';
import { cx } from './cx';

export interface TagFieldProps {
  /** The field's accessible name ("Tags"). */
  label: string;
  value: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  /** Names a chip's remove button after its tag ("Remove parentage"). */
  removeLabel: (tag: string) => string;
  /** The polite announcement after a chip is added or removed. */
  addedLabel: (tag: string) => string;
  removedLabel: (tag: string) => string;
  /** Id of a hint under the field, for `aria-describedby`. */
  describedBy?: string;
  id?: string;
  disabled?: boolean;
}

/** Adds `raw` to `tags`, trimmed and ignoring an empty or case-insensitive duplicate. */
function addTag(tags: string[], raw: string): string[] {
  const tag = raw.trim();
  if (!tag || tags.some((t) => t.toLowerCase() === tag.toLowerCase())) return tags;
  return [...tags, tag];
}

/**
 * An inline tag field (#33): the tags are chips inside the field's border and the
 * input follows the last one, so the place you type stays put as tags are added.
 * Enter or a comma adds what was typed, as does leaving the field (so a touch
 * keyboard needs no special key). Backspace in an empty input selects the last
 * chip, and a second Backspace removes it. Adds and removes are announced politely.
 */
export function TagField({
  label, value, onChange, placeholder, removeLabel, addedLabel, removedLabel, describedBy, id, disabled = false,
}: TagFieldProps) {
  const [text, setText] = useState('');
  const [armed, setArmed] = useState(false);
  const [said, setSaid] = useState('');
  const input = useRef<HTMLInputElement>(null);

  const commit = () => {
    const next = addTag(value, text);
    if (next !== value) {
      onChange(next);
      setSaid(addedLabel(next[next.length - 1]));
    }
    setText('');
  };
  const remove = (tag: string) => {
    onChange(value.filter((t) => t !== tag));
    setSaid(removedLabel(tag));
    setArmed(false);
    input.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      // Never submits the surrounding form: Enter here means "add this tag".
      e.preventDefault();
      commit();
      return;
    }
    if (e.key === 'Backspace' && text === '' && value.length > 0) {
      e.preventDefault();
      if (armed) remove(value[value.length - 1]);
      else setArmed(true);
      return;
    }
    if (armed) setArmed(false);
  };

  return (
    <div
      className={cx(
        'tag-field flex flex-wrap items-center gap-1.5 min-h-9 px-2 py-1 rounded-[8px] border border-border bg-card focus-ring-within',
        disabled && 'opacity-60',
      )}
      onClick={(e) => { if (e.target === e.currentTarget) input.current?.focus(); }}
    >
      {value.map((tag, i) => {
        const selected = armed && i === value.length - 1;
        return (
          <Badge key={tag} shape="pill" tone={selected ? 'outline' : 'neutral'} className="gap-1 pr-1" data-selected={selected || undefined}>
            {tag}
            <button
              type="button"
              disabled={disabled}
              onClick={() => remove(tag)}
              aria-label={removeLabel(tag)}
              title={removeLabel(tag)}
              className="grid place-items-center w-4 h-4 rounded-full border-0 bg-transparent p-0 text-current cursor-pointer hover:bg-hover-surface focus-ring"
            >
              <X className="w-3 h-3" aria-hidden="true" />
            </button>
          </Badge>
        );
      })}
      <input
        ref={input}
        id={id}
        value={text}
        disabled={disabled}
        onChange={(e) => { setText(e.target.value.replace(/,/g, '')); setArmed(false); }}
        onKeyDown={onKeyDown}
        onBlur={() => { if (text.trim()) commit(); setArmed(false); }}
        placeholder={placeholder}
        aria-label={label}
        aria-describedby={describedBy}
        enterKeyHint="done"
        autoComplete="off"
        className="flex-1 min-w-[8ch] border-0 bg-transparent p-1 text-base text-text outline-none input-nozoom"
      />
      <span role="status" className="sr-only">{said}</span>
    </div>
  );
}
