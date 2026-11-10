'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Badge, Input } from '@/app/components/ui';
import { getDataClient } from '@/lib/data';
import { formatLifespan, formatYearOrEmpty } from '@/lib/date-utils';
import { useNoAutofill } from '@/app/hooks/useNoAutofill';
import type { FamilyWithSpouseNames } from '@/lib/db/queries/families';

/** One partner as the picker shows them: "Tom Bracken (1820–1890)". */
function partnerLabel(name: string | null, birth?: string | null, death?: string | null): string {
    if (!name) return '';
    const years = formatLifespan({ birth: formatYearOrEmpty(birth) || null, death: formatYearOrEmpty(death) || null });
    return years ? `${name} (${years})` : name;
}

/**
 * Search a family by a partner's name. Each result names both partners with
 * their years and the children count, so two same-named couples can be told
 * apart. Used to move a child (#796) and to pick a census household (#799).
 */
export function FamilySearch({ treeId, excludeFamilyId, disabled, autoFocus, autofillKey, onPick }: {
    treeId: number | null;
    excludeFamilyId?: number;
    disabled?: boolean;
    autoFocus?: boolean;
    autofillKey: string;
    onPick: (family: FamilyWithSpouseNames) => void;
}) {
    const t = useTranslations('families');
    const te = useTranslations('editPerson');
    const tc = useTranslations('common');
    const noAutofill = useNoAutofill();
    const [q, setQ] = useState('');
    const [results, setResults] = useState<FamilyWithSpouseNames[]>([]);

    useEffect(() => {
        if (q.trim().length < 2) return;
        let cancelled = false;
        const timer = setTimeout(async () => {
            try {
                const client = await getDataClient();
                const found = await client.families.search(q, treeId);
                if (!cancelled) setResults(found.filter((f) => f.Id !== excludeFamilyId));
            } catch { /* surfaced by the data layer */ }
        }, 200);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [q, treeId, excludeFamilyId]);
    // A query too short to search shows nothing, whatever an older search returned.
    const shown = q.trim().length < 2 ? [] : results;

    return (
        <>
            <Input
                type="text"
                autoFocus={autoFocus}
                size="sm"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={te('search_families_plain')}
                aria-label={te('search_families_plain')}
                {...noAutofill(autofillKey)}
            />
            {shown.length > 0 && (
                <div className="flex flex-col gap-1">
                    {shown.slice(0, 6).map((f) => {
                        const label = [
                            partnerLabel(f.husbandName, f.partner1BirthDate, f.partner1DeathDate),
                            partnerLabel(f.wifeName, f.partner2BirthDate, f.partner2DeathDate),
                        ].filter(Boolean).join(' & ') || tc('unknown');
                        const married = formatYearOrEmpty(f.MarriageDate);
                        return (
                            <button
                                key={f.Id}
                                type="button"
                                disabled={disabled}
                                onClick={() => onPick(f)}
                                className="row row-lift gap-2 py-2 px-2 rounded-[6px] min-h-11 w-full text-left"
                            >
                                <span className="flex-1 min-w-0 text-meta">
                                    {label}
                                    {married && <span className="muted"> · {t('married_year', { year: married })}</span>}
                                </span>
                                <Badge>{te('kids', { count: Number(f.childCount) })}</Badge>
                            </button>
                        );
                    })}
                </div>
            )}
        </>
    );
}
