'use client';

import React from 'react';
import { Card } from './Card';
import { cx } from './cx';

/**
 * Form section + field-label chrome, merged from the two near-identical defs that
 * lived in `person-form/FormSection.tsx` and `family-form/sections.tsx` (#175 Wave 2).
 *
 * `FormSection` — a titled block. Desktop renders an external rail-size (16) heading above a
 * `.card`; `mobile` renders a `ui/Card` with an internal uppercase overline heading.
 * `FieldLabel` — a label above an input.
 *
 * Citation pins are per fact, not per field (#548): a fact's date, place and
 * cause share one pin, so it sits on the fact's heading — `FormSection`'s `cite`
 * when the section is one fact, `FactGroupLabel` for a fact inside a section.
 */
export function FormSection({ title, hint, cite, children, mobile = false }: {
  title: string;
  hint?: string;
  /** The citation pin for the fact this whole section edits. */
  cite?: React.ReactNode;
  children: React.ReactNode;
  mobile?: boolean;
}) {
  if (mobile) {
    return (
      <Card className="mb-3">
        <div className="flex items-center gap-1.5 mb-3"><div className="eyebrow">{title}</div>{cite}</div>
        {children}
      </Card>
    );
  }
  return (
    <div className="mb-[22px]">
      <div className="mb-2.5">
        {/* inline fontSize overrides the unlayered `.section` (18px) → 16px */}
        <div className="flex items-center gap-1.5"><h2 className="rail-title m-0">{title}</h2>{cite}</div>
        {hint && <div className="muted text-meta mt-0.5">{hint}</div>}
      </div>
      <div className="card card-pad">{children}</div>
    </div>
  );
}

/** The heading of one fact's fields inside a section ("Birth", "Death"), with its pin. */
export function FactGroupLabel({ label, cite, className }: { label: string; cite?: React.ReactNode; className?: string }) {
  return <div className={cx('rel-group-label flex items-center gap-1.5 mb-2', className)}>{label}{cite}</div>;
}

export function FieldLabel({ label, fullLabel, hint, required, htmlFor, children }: {
  label: string;
  /** The control's accessible name when the visible label leans on a heading above it
   *  ("Date" under Birth reads "Birth date"), so the field names its fact (#855). */
  fullLabel?: string;
  hint?: string;
  required?: boolean;
  /** The id of the control this labels, so a composite field gets its accessible name. */
  htmlFor?: string;
  children: React.ReactNode;
}) {
  const req = required && <span className="text-[color:var(--error)] ml-[3px]">*</span>;
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-meta font-medium text-[color:var(--text-2)] mb-1">
        {fullLabel ? <><span aria-hidden="true">{label}{req}</span><span className="sr-only">{fullLabel}</span></> : <>{label}{req}</>}
      </label>
      {children}
      {hint && <div className="muted text-xs mt-1">{hint}</div>}
    </div>
  );
}
