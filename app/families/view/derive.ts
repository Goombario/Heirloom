import type { Person, FamilyType, FamilyEndedReason } from '@/lib/db/schema';
import { displayFullName, displayFirstName, type DisplayNameParts } from '@/lib/utils/names';
import { formatYearOrEmpty, sortableYear, compareSortableYears, parseDateComponents, formatLifespan } from '@/lib/date-utils';
import type { PartnerFamilies } from './useFamilyDetail';
import { isChildRelationshipType, type ChildRelationshipType } from '@/lib/child-relationship';

/** Resolved display name, or '' when unknown — callers add a translated fallback. */
export function partnerName(p: Person | null): string {
    if (!p) return '';
    return displayFullName(p) || '';
}

/** The display year, qualifier markers intact ("~1876", "<1920"), or ''. */
export function yearOnly(date: string | null): string {
    return formatYearOrEmpty(date);
}

export function calcAgeAtDeath(birth: string | null, death: string | null): number | null {
    if (!birth || !death) return null;
    const b = sortableYear(birth);
    const d = sortableYear(death);
    if (b === null || d === null) return null;
    return d - b;
}

/**
 * A child's recorded death gets a row on the family timeline, as a recorded birth
 * does. It once took only deaths under 18, but the Sources cited card lists every
 * child's death citation, so an adult child's cited death had no row to find it on.
 */
export function hasRecordedDeath(child: { DeathDate: string | null; DeathPlace: string | null }): boolean {
    return Boolean(child.DeathDate || child.DeathPlace);
}

/**
 * An explicit end to the partnership — a divorce/annulment/separation event —
 * normalised from whichever shape the calling surface holds. The detail view has
 * the raw `events` rows; the summary cache has the pre-derived `EndedDate` /
 * `EndedReason` columns the list query builds (`lib/db/queries/families.ts`).
 */
export type UnionEnd = { date: string | null; reason: FamilyEndedReason | null };

/** GEDCOM family-event tags that end a partnership, mapped to our reason vocabulary. */
const END_EVENT_REASONS: Record<string, FamilyEndedReason> = {
    DIV: 'Divorce',
    DIVF: 'Divorce',
    ANUL: 'Annulment',
    SEPA: 'Separation',
};

/**
 * The earliest explicit end-event among a family's events, or null when there is
 * none. Earliest rather than latest: a partnership that records a separation and
 * a later divorce ended, for the hero's purposes, at the separation. Undated end
 * events still count — they carry a reason even without a year.
 */
export function endFromEvents(
    events: readonly { Type: string; Date: string | null }[] | null | undefined,
): UnionEnd | null {
    const ev = endEventOf(events);
    return ev ? { date: ev.Date, reason: END_EVENT_REASONS[ev.Type] } : null;
}

/**
 * The event row `endFromEvents` reads the end from, so the hero editor edits the
 * same divorce/annulment/separation the hero shows.
 */
export function endEventOf<E extends { Type: string; Date: string | null }>(
    events: readonly E[] | null | undefined,
): E | null {
    let best: E | null = null;
    let bestYear: number | null = null;
    for (const ev of events ?? []) {
        if (!END_EVENT_REASONS[ev.Type]) continue;
        const year = sortableYear(ev.Date);
        if (best === null || (year !== null && (bestYear === null || year < bestYear))) {
            best = ev;
            bestYear = year;
        }
    }
    return best;
}

/** The reason an end event records, or null for a tag that doesn't end a partnership. */
export function endReasonOf(type: string): FamilyEndedReason | null {
    return END_EVENT_REASONS[type] ?? null;
}

/** The GEDCOM tag a new end event is created with, per reason. */
export const END_REASON_TAGS: Record<'Divorce' | 'Annulment' | 'Separation', string> = {
    Divorce: 'DIV',
    Annulment: 'ANUL',
    Separation: 'SEPA',
};

/**
 * The year the partnership ended.
 *
 * An explicit end-event date wins outright — a couple who divorced in 1931 and
 * died in 1958 and 1962 ended their partnership in 1931, and showing a death year
 * there states something the record contradicts. Only when there is no explicit
 * end does this fall back to the earlier of the two partner deaths.
 *
 * This mirrors `familyDurationYears` in the families list
 * (`app/families/FamiliesPageClient.tsx`), which has always preferred `EndedDate`
 * over the death derivation — the hero was the one surface that did not.
 *
 * A derived end that falls before `startDate` is dropped (see
 * `derivedEndPrecedesStart`); an explicit end is stored data and is kept.
 */
export function computeEndedYear(p1: Person | null, p2: Person | null, explicitEndDate?: string | null, startDate?: string | null): string {
    const explicit = yearOnly(explicitEndDate ?? null);
    if (explicit) return explicit;
    if (derivedEndPrecedesStart(earlierDeathPartner(p1, p2)?.DeathDate, startDate)) return '';
    if (p1?.DeathDate && p2?.DeathDate) {
        const a = sortableYear(p1.DeathDate);
        const b = sortableYear(p2.DeathDate);
        if (a !== null && b !== null) return Math.min(a, b).toString();
    }
    return p1?.DeathDate ? yearOnly(p1.DeathDate) : p2?.DeathDate ? yearOnly(p2.DeathDate) : '';
}

/**
 * True when a partnership end derived from a partner's death falls in a year
 * before the partnership started (#826, task audit ED-6). That death is a bad
 * date, which the data checks report; it isn't an end, so the hero shows only
 * the start ("~1842", never "~1842–1814") and the timeline drops its derived
 * "Partnership ended" row. Explicit end events never go through this: they are
 * stored data, and "Partnership ends before it starts" flags them instead.
 */
export function derivedEndPrecedesStart(deathDate: string | null | undefined, startDate: string | null | undefined): boolean {
    const end = sortableYear(deathDate);
    const start = sortableYear(startDate);
    return end !== null && start !== null && end < start;
}

/**
 * i18n key for the small note under the hero's date range, naming HOW the
 * partnership ended. Rendered only for an explicit end-event: a range with no
 * note is the death-derived case, which the timeline already states in full, and
 * labelling every widowed couple "ended by death" under their dates is noise.
 * Returns null when there is nothing to say.
 *
 * One word, not a phrase. The ribbon's centre track is 60px wide with `nowrap`
 * children (see `.partnership-ribbon` in globals.css) — sized for a year range,
 * which a sentence overruns and the partner cards then clip.
 */
export function unionEndNoteParts(end: UnionEnd | null): { reasonKey: string } | null {
    switch (end?.reason) {
        case 'Divorce': return { reasonKey: 'hero_ended_divorce' };
        case 'Annulment': return { reasonKey: 'hero_ended_annulment' };
        case 'Separation': return { reasonKey: 'hero_ended_separation' };
        default: return null;
    }
}

/**
 * i18n key (under `families`) naming the KIND of partnership, for surfaces that
 * refer to the union itself: the timeline's start-anchor row, its row-action
 * label, the citation fact label, and the start editor's caption. Without this
 * they all read "marriage" even for a common-law family.
 */
export function partnershipKindKey(type: FamilyType | null | undefined): string {
    switch (type) {
        case 'Marriage': return 'marriage_kind';
        case 'Civil union': return 'civil_union_kind';
        case 'Common-law': return 'common_law_kind';
        default: return 'partnership_kind';
    }
}

/** Marriage year + partnership-end year for the hero center connector. Either may be ''. */
export function partnershipYears(
    p1: Person | null, p2: Person | null, marriageDate: string | null, explicitEndDate?: string | null,
): { began: string; ended: string } {
    return { began: yearOnly(marriageDate), ended: computeEndedYear(p1, p2, explicitEndDate, marriageDate) };
}

/**
 * The union's date range for the hero's centre plate, or '' when there isn't one.
 *
 * A union with an end but no start renders as "?–1918": showing the bare end
 * year read as the year it *began*. The question mark keeps the unknown endpoint
 * in its normal position so the shape matches a union that has both dates.
 *
 * A start with no end is not a range — the caller renders that as "m. 1901".
 */
export function formatUnionRange(began: string, ended: string): string {
    if (!ended) return '';
    return formatLifespan({ birth: began, death: ended }) ?? '';
}

/**
 * The short name the hero title uses for one partner: their first given name,
 * else their surname. The primary given name wins over a nickname (#796, ED-11),
 * matching the person page and the Names table — the hero title is
 * "Arthur & Mary", not two full names.
 */
export function partnerShortName(p: DisplayNameParts | null): string {
    if (!p) return '';
    const firstToken = (s: string | null | undefined) => (s ?? '').trim().split(/\s+/).filter(Boolean)[0];
    const first = firstToken(p.FirstName) ?? firstToken(displayFirstName(p));
    if (first) return first;
    return (p.LastName ?? '').trim();
}

/**
 * `partnerShortName` for surfaces that only hold an already-formatted display
 * name (the families-list summary cache stores `husbandName`/`wifeName`, built by
 * the `integratedFullName` SQL expression). A quoted segment is an integrated
 * nickname; skip it and take the first given name, as `partnerShortName` does.
 */
export function shortNameFromDisplay(name: string | null): string {
    const s = (name ?? '').replace(/["“][^"”]*["”]/g, ' ').trim();
    if (!s) return '';
    return s.split(/\s+/)[0] ?? '';
}

/**
 * A family's children in birth order (#796, ED-11): by year, approximate dates
 * by their stated year, then month and day when a year ties; undated children
 * last. Ties keep their stored order.
 */
export function sortChildrenByBirth<T extends { BirthDate?: string | null }>(children: readonly T[]): T[] {
    const within = (d: string | null | undefined) => {
        const c = parseDateComponents(d);
        return c && c.year === sortableYear(d) ? (c.month ?? 0) * 100 + (c.day ?? 0) : 0;
    };
    return children
        .map((child, i) => ({ child, i }))
        .sort((a, b) => compareSortableYears(a.child.BirthDate, b.child.BirthDate)
            || within(a.child.BirthDate) - within(b.child.BirthDate)
            || a.i - b.i)
        .map(({ child }) => child);
}

/** i18n parts for the hero title — both partners, one, or the generic fallback. */
export function heroTitleParts(
    a: string, b: string,
): { key: 'hero_title_both'; a: string; b: string } | { key: 'hero_title_one'; a: string } | { key: 'family_fallback' } {
    const x = a.trim();
    const y = b.trim();
    if (x && y) return { key: 'hero_title_both', a: x, b: y };
    if (x || y) return { key: 'hero_title_one', a: x || y };
    return { key: 'family_fallback' };
}

/**
 * i18n parts for the hero subtitle — the partnership type phrased naturally,
 * with the place when there is one ("Married at Congregational Church, Dover"),
 * type-only otherwise ("Common-law partnership"). Null ⇒ render no subtitle.
 * Uses the full place string: the subtitle is the one place the hero states
 * where the partnership happened, so truncating to the first segment loses it.
 */
export function heroSubtitleParts(
    type: FamilyType | null | undefined, place: string | null,
): { key: string; place?: string } | null {
    const p = (place ?? '').trim();
    const known = type === 'Marriage' || type === 'Civil union' || type === 'Common-law';
    if (!p && !known) return null;
    const stem = type === 'Marriage' ? 'subtitle_marriage'
        : type === 'Civil union' ? 'subtitle_civil_union'
        : type === 'Common-law' ? 'subtitle_common_law'
        : 'subtitle_partnership';
    return p ? { key: `${stem}_at`, place: p } : { key: stem };
}

/**
 * Collapse the hero's title/subtitle parts into display strings. Both the live
 * hero and the summary loading paint call this so they cannot drift — a
 * divergence between them is exactly the title flicker this replaced.
 * `t` is a next-intl translator already scoped to the `families` namespace.
 */
export function heroCopy(
    titleParts: ReturnType<typeof heroTitleParts>,
    subtitleParts: ReturnType<typeof heroSubtitleParts>,
    t: (key: string, values?: Record<string, string>) => string,
): { title: string; subtitle: string } {
    const title = titleParts.key === 'hero_title_both'
        ? t('hero_title_both', { a: titleParts.a, b: titleParts.b })
        : titleParts.key === 'hero_title_one'
            ? t('hero_title_one', { a: titleParts.a })
            : t('family_fallback');
    const subtitle = subtitleParts
        ? (subtitleParts.place ? t(subtitleParts.key, { place: subtitleParts.place }) : t(subtitleParts.key))
        : '';
    return { title, subtitle };
}

/** True when the partner (via their resolved partnerships) has a family other than the current one. */
export function hasOtherPartnerships(pf: PartnerFamilies | null, currentFamilyId: number): boolean {
    if (!pf) return false;
    return pf.spouses.some((s) => s.family.Id !== currentFamilyId);
}

/**
 * Which halves of the rail's "Other partnerships" card to render. Each partner's
 * sub-block is gated individually: gating only the card meant a partner with zero
 * other partnerships still got their "For <name>" header over an empty state
 * (follow-up item 11). The card itself needs at least one partner to show.
 */
export function otherPartnershipsVisibility(
    p1: PartnerFamilies | null, p2: PartnerFamilies | null, currentFamilyId: number,
): { p1: boolean; p2: boolean; card: boolean } {
    const a = hasOtherPartnerships(p1, currentFamilyId);
    const b = hasOtherPartnerships(p2, currentFamilyId);
    return { p1: a, p2: b, card: a || b };
}

/** The partner who died first (used to derive the "partnership ended" timeline event). */
export function earlierDeathPartner<T extends Person>(p1: T | null, p2: T | null): T | null {
    const a = sortableYear(p1?.DeathDate);
    const b = sortableYear(p2?.DeathDate);
    if (a !== null && b !== null) return a < b ? p1 : p2;
    if (a !== null) return p1;
    if (b !== null) return p2;
    return null;
}

/**
 * What a child row says about how the child is linked (#982). Nothing for a
 * birth child of every partner. One type with no name when the partners share it
 * ("Adoption"). Otherwise each partner the child isn't a birth child of, by name
 * ("Stepchild of Tom"). A stored value outside the set says nothing: claiming a
 * type the app doesn't hold is worse than silence.
 */
export function childRelationshipTags(
    child: { Partner1Relationship?: string | null; Partner2Relationship?: string | null },
    partner1: DisplayNameParts | null,
    partner2: DisplayNameParts | null,
): { type: ChildRelationshipType; name: string | null }[] {
    const known = (v: string | null | undefined): ChildRelationshipType | null => {
        const value = v ?? 'Birth';
        return isChildRelationshipType(value) ? value : null;
    };
    // A slot with no partner doesn't count, unless neither has one.
    const slots = [
        { type: known(child.Partner1Relationship), partner: partner1 },
        { type: known(child.Partner2Relationship), partner: partner2 },
    ].filter((s, _, all) => s.partner != null || all.every((x) => x.partner == null));
    const types = new Set(slots.map((s) => s.type));
    if (types.size === 1) {
        const [type] = types;
        return type === null || type === 'Birth' ? [] : [{ type, name: null }];
    }
    return slots
        .filter((s): s is { type: ChildRelationshipType; partner: DisplayNameParts | null } => s.type !== null && s.type !== 'Birth')
        .map((s) => ({ type: s.type, name: partnerShortName(s.partner) || null }));
}
