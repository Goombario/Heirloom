import type { FamilySuggestionCandidate } from './db/queries/families';
import type { SpouseSuggestionCandidate } from './db/queries/people';
import { displayFullName } from './utils/names';
import { sortableYear } from './date-utils';

export type SuggestionRole = 'child' | 'sibling' | 'spouse';

export interface FamilySuggestion {
    role: SuggestionRole;
    score: number;
    // For child/sibling suggestions
    familyId?: number;
    husbandName: string | null;
    wifeName: string | null;
    marriageDate: string | null;
    childCount?: number;
    // For spouse suggestions
    personId?: number;
    personFirstName: string | null;
    personLastName: string | null;
    personEffectiveFirstName?: string | null;
    personNickname?: string | null;
    personName: string | null;
    personBirthDate: string | null;
}

interface NewPersonInput {
    lastName: string;
    birthYear: number;
    sex?: string; // 'M' | 'F' | ''
    birthPlace?: string;
}

function recencyBonus(dateIso: string | null | undefined, now: number, fullPoints: number): number {
    if (!dateIso) return 0;
    const ageMs = now - new Date(dateIso).getTime();
    if (ageMs < 60 * 60 * 1000) return fullPoints;          // < 1 hour
    if (ageMs < 24 * 60 * 60 * 1000) return Math.round(fullPoints * 0.75);  // < 1 day
    if (ageMs < 7 * 24 * 60 * 60 * 1000) return Math.round(fullPoints * 0.5); // < 1 week
    return 0;
}

function normalizePlace(place: string | null | undefined): string {
    if (!place) return '';
    // Take the first segment (city/region) for loose matching
    return place.split(',')[0].trim().toLowerCase();
}

function placesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
    const pa = normalizePlace(a);
    const pb = normalizePlace(b);
    return pa.length > 0 && pb.length > 0 && pa === pb;
}

export function scoreSuggestions(
    input: NewPersonInput,
    familyCandidates: FamilySuggestionCandidate[],
    spouseCandidates: SpouseSuggestionCandidate[],
    nowMs?: number,
): FamilySuggestion[] {
    const results: FamilySuggestion[] = [];
    const { lastName, birthYear, sex, birthPlace } = input;
    const now = nowMs ?? Date.now();
    const lastNameLower = lastName.toLowerCase();

    for (const family of familyCandidates) {
        let childScore = 0;
        let siblingScore = 0;

        // --- Last name signal ---
        const husbLastLower = (family.husbandLastName ?? '').toLowerCase();
        const wifeLastLower = (family.wifeLastName ?? '').toLowerCase();
        const lastNameMatchesParent =
            (husbLastLower && husbLastLower === lastNameLower) ||
            (wifeLastLower && wifeLastLower === lastNameLower);
        if (lastNameMatchesParent) {
            childScore += 50;
            siblingScore += 50;
        }

        // --- Birth year gap vs parents ---
        const husbYear = sortableYear(family.husbandBirthDate);
        const wifeYear = sortableYear(family.wifeBirthDate);
        const parentYears = [husbYear, wifeYear].filter((y): y is number => y !== null);

        if (parentYears.length > 0) {
            const avgParentYear = parentYears.reduce((a, b) => a + b, 0) / parentYears.length;
            const gapFromParents = birthYear - avgParentYear;

            if (gapFromParents >= 15 && gapFromParents <= 55) {
                childScore += 25;
            } else {
                // Gap too small or too large — biologically implausible for both child and sibling
                childScore -= 25;
                siblingScore -= 25;
            }
        }

        // --- Birth year vs siblings (sibling signal) ---
        const siblingYears = family.childrenBirthDates
            .map(d => sortableYear(d))
            .filter((y): y is number => y !== null);

        const withinSiblingRange = siblingYears.some(sy => Math.abs(birthYear - sy) <= 20);
        if (withinSiblingRange) {
            siblingScore += 30;
            childScore += 15; // also bumps child score (same family)
        } else if (siblingYears.length > 0) {
            // Siblings exist but new person is far outside their era — wrong generation
            siblingScore -= 20;
        }

        // --- Birth place ---
        if (
            placesMatch(birthPlace, family.husbandBirthPlace) ||
            placesMatch(birthPlace, family.wifeBirthPlace)
        ) {
            childScore += 10;
            siblingScore += 10;
        }

        // --- Family vacancy bonus (both spouses present = complete couple) ---
        if (family.Partner1Id && family.Partner2Id) {
            childScore += 5;
        }

        // --- Recency bonus (family recently updated) ---
        const familyRecency = recencyBonus(family.familyUpdatedAt, now, 10);
        childScore += familyRecency;
        siblingScore += familyRecency;

        // --- Determine best role for this family ---
        // Prefer sibling over child when siblings exist and last name matches
        const isSiblingStronger = siblingScore >= 45 && siblingScore > childScore;

        if (isSiblingStronger && siblingScore >= 45) {
            results.push({
                role: 'sibling',
                score: siblingScore,
                familyId: family.Id,
                husbandName: family.husbandName,
                wifeName: family.wifeName,
                marriageDate: family.MarriageDate,
                childCount: Number(family.childCount),
                personFirstName: null,
                personLastName: null,
                personName: null,
                personBirthDate: null,
            });
        } else if (childScore >= 35) {
            results.push({
                role: 'child',
                score: childScore,
                familyId: family.Id,
                husbandName: family.husbandName,
                wifeName: family.wifeName,
                marriageDate: family.MarriageDate,
                childCount: Number(family.childCount),
                personFirstName: null,
                personLastName: null,
                personName: null,
                personBirthDate: null,
            });
        }
    }

    // --- Spouse candidates ---
    // People under 16 are never suggested as spouses
    const currentYear = new Date(now).getFullYear();
    const personAge = currentYear - birthYear;
    const eligibleForSpouse = personAge >= 16;

    for (const person of eligibleForSpouse ? spouseCandidates : []) {
        let spouseScore = 0;

        // Birth year proximity (already pre-filtered to ±15 yrs by SQL)
        const personYear = sortableYear(person.BirthDate);
        if (personYear !== null) {
            const gap = Math.abs(birthYear - personYear);
            if (gap <= 5) spouseScore += 25;
            else if (gap <= 10) spouseScore += 15;
            else spouseScore += 5;
        }

        // Last name: different = likely spouse, same = likely sibling/relative
        const personLastLower = (person.LastName ?? '').toLowerCase();
        if (personLastLower && personLastLower !== lastNameLower) {
            spouseScore += 20;
        } else if (personLastLower && personLastLower === lastNameLower) {
            spouseScore -= 15; // same surname reduces spouse likelihood
        }

        // Person has no existing spouse (guaranteed by SQL query)
        spouseScore += 20;

        // Complementary sex
        if (sex === 'M' && person.Sex === 'F') spouseScore += 15;
        else if (sex === 'F' && person.Sex === 'M') spouseScore += 15;
        else if (sex && person.Sex && sex === person.Sex) spouseScore -= 10; // same known sex
        else if (!sex || !person.Sex) spouseScore += 5; // unknown sex, small bonus

        // Shared birth place
        if (placesMatch(birthPlace, person.BirthPlace)) {
            spouseScore += 10;
        }

        // Recency bonus (use most recent of CreatedAt / UpdatedAt)
        const mostRecentActivity = [person.CreatedAt, person.UpdatedAt]
            .filter(Boolean)
            .sort()
            .at(-1) ?? null;
        spouseScore += recencyBonus(mostRecentActivity, now, 20);

        if (spouseScore >= 40) {
            const name = displayFullName(person) || null;
            results.push({
                role: 'spouse',
                score: spouseScore,
                personId: person.Id,
                personFirstName: person.FirstName,
                personLastName: person.LastName,
                personEffectiveFirstName: person.EffectiveFirstName,
                personNickname: person.Nickname,
                personName: name,
                personBirthDate: person.BirthDate,
                husbandName: null,
                wifeName: null,
                marriageDate: null,
            });
        }
    }

    // Always include at least one family and one spouse if available,
    // then fill remaining slots by score.
    const sorted = results.sort((a, b) => b.score - a.score);
    const families = sorted.filter(r => r.role === 'child' || r.role === 'sibling');
    const spouses = sorted.filter(r => r.role === 'spouse');

    const picked: FamilySuggestion[] = [];
    if (families.length > 0) picked.push(families[0]);
    if (spouses.length > 0) picked.push(spouses[0]);

    // Fill up to 3 with the highest-scoring remaining suggestions
    for (const s of sorted) {
        if (picked.length >= 3) break;
        if (!picked.includes(s)) picked.push(s);
    }

    return picked.sort((a, b) => b.score - a.score);
}
