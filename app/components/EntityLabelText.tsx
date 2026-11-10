import React from 'react';

/**
 * An audit/activity entity label with only the record's name emphasised (TY-4,
 * #763). Captured labels read "Type — Name" or "Citation — Name · fact"
 * (`resolveEntityLabel`); the type prefix and the fact suffix render at 400
 * muted so each row carries one bold run. Labels in any other shape render whole.
 */
export function EntityLabelText({ label }: { label: string }) {
    const dash = label.indexOf(' — ');
    const prefix = dash > 0 ? label.slice(0, dash + 3) : '';
    let name = dash > 0 ? label.slice(dash + 3) : label;
    let suffix = '';
    const dot = prefix ? name.lastIndexOf(' · ') : -1;
    if (dot > 0) {
        suffix = name.slice(dot);
        name = name.slice(0, dot);
    }
    return (
        <>
            {prefix && <span className="font-normal text-text-muted">{prefix}</span>}
            <span className="font-semibold">{name}</span>
            {suffix && <span className="font-normal text-text-muted">{suffix}</span>}
        </>
    );
}
