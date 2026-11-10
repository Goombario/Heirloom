'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import type { Citation } from '@/lib/db/queries/citations';
import type { SourceNumbers } from '@/app/components/citations/factDescriptors';
import PersonAvatar from '@/app/components/PersonAvatar';
import { FilterChip, MobileRow, citeClass, cx } from '@/app/components/ui';
import { getInitials } from '@/lib/utils/initials';
import { displayFullName } from '@/lib/utils/names';
import { Plus } from '@/lib/icons';
import type { PartnerPerson } from '../useFamilyDetail';

/* Small pieces the family page's sheets share (#1062). */

/** A one-of-several choice chip: 34px, with a 44px hit. */
function Chip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
    return (
        <FilterChip active={active} label={label} aria-pressed={active} onClick={onClick}
            className="!h-[34px] px-3.5 relative before:absolute before:-inset-[5px] before:content-['']" />
    );
}

/** A labelled group of choice chips. */
export function ChipGroup<T extends string>({ label, value, options, onChange }: {
    label: string;
    value: T | null;
    options: { v: T; l: string }[];
    onChange: (v: T) => void;
}) {
    return (
        <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
            {options.map((o) => <Chip key={o.v} active={o.v === value} label={o.l} onClick={() => onChange(o.v)} />)}
        </div>
    );
}

/** A form group: an eyebrow over its fields, a hairline above. */
export function Group({ title, children, first = false }: { title?: string; children: React.ReactNode; first?: boolean }) {
    return (
        <div className={cx('grid gap-2.5 pt-4 pb-1', !first && 'border-t border-border')}>
            {title && <h3 className="eyebrow m-0">{title}</h3>}
            {children}
        </div>
    );
}

/** A fact's citations in a sheet, and the row that cites another source. */
export function SheetSources({ citations, sourceNumbers, onCite }: { citations: Citation[]; sourceNumbers: SourceNumbers; onCite: () => void }) {
    const te = useTranslations('mobileEvents');
    return (
        <>
            {citations.length === 0 && <p className="m-0 px-4 pb-1 text-base text-text-muted">{te('no_source_yet')}</p>}
            {citations.map((c) => (
                <div key={c.Id} className="flex items-start gap-2 px-4 py-1.5 text-base leading-snug">
                    <span className={cx(citeClass(), 'shrink-0 mt-0.5')}>{sourceNumbers.get(c.SourceId)}</span>
                    <span className="min-w-0">{c.sourceTitle ?? te('source_fallback')}{c.Page ? <span className="text-text-muted"> · {c.Page}</span> : null}</span>
                </div>
            ))}
            <MobileRow icon={<Plus />} end="chevron" label={te('cite_source')} onClick={onCite} />
        </>
    );
}

/** A person's round portrait, as the sheets draw them side by side. */
export function Face({ person, size = 56, treeId }: { person: PartnerPerson | { FirstName: string | null; LastName: string | null; Sex: string | null }; size?: number; treeId: number | null }) {
    const p = person as PartnerPerson;
    return (
        <PersonAvatar as="span" size={size} treeId={treeId} name={displayFullName(p) || ''} initials={getInitials(p.FirstName, p.LastName)} sex={p.Sex}
            mediaId={p.PrimaryMediaId} focalX={p.FocalX} focalY={p.FocalY} focalRadius={p.FocalRadius} />
    );
}
