import type { FamilyType } from '@/lib/db/schema';
import type { HierarchyLevel } from '@/lib/geocode/photon';
import type { DataClient } from '@/lib/data/types';
import { FACT_TABLES } from '@/lib/db/fact-tables';
import type { PendingCitation } from '@/app/components/AttachSourceSidebar';
import { END_REASON_TAGS } from '@/app/families/view/derive';
import { inBirthOrder, slotLinks, type Staged, type StagedChild } from './mobile/model';

/*
 * Saving a new family (#1066, #52): the phone sheet and the desktop dialog write the
 * same thing. People made in the finders, the family, its children, the ending and
 * the staged citations, in that order. The people and the family are all or nothing;
 * the rest is named when it fails, since the family then exists and opens anyway.
 */

export type EndReason = 'Divorce' | 'Annulment' | 'Separation';

/** Which fact a staged citation belongs to: the start (the family row) or the ending event. */
export type CiteFor = 'start' | 'end';

interface PlaceInput {
    date: string;
    place: string;
    placeId: number | null;
    /** The place's resolution, flushed after the save (undefined: unchanged). */
    resolution: HierarchyLevel[] | null | undefined;
}

export interface NewFamilyInput {
    treeId: number | null;
    partners: Staged[];
    children: StagedChild[];
    type: FamilyType;
    start: PlaceInput;
    /** Divorce, annulment or separation: saved as that family event. Null for none (or a death). */
    end: (PlaceInput & { reason: EndReason }) | null;
    pending: (PendingCitation & { for: CiteFor })[];
}

/** What a failure is called, in the caller's words. */
export interface FailureWords {
    child: (name: string) => string;
    end: (reason: EndReason) => string;
    source: () => string;
    citation: () => string;
    childName: (child: StagedChild) => string;
}

export type SaveResult = { ok: true; familyId: number; failed: string[] } | { ok: false; error: unknown };

type Flush = (fieldValue: string, resolution: HierarchyLevel[] | null | undefined, placeId?: number | null) => Promise<void>;

export async function saveNewFamily(client: DataClient, input: NewFamilyInput, flushPlace: Flush, say: FailureWords): Promise<SaveResult> {
    const { treeId, partners, children, type, start, end, pending } = input;
    const made: number[] = [];
    const peopleIds = new Map<string, number>();
    const idOf = async (s: Staged) => {
        if (s.picked.kind === 'existing') return s.picked.person.Id;
        const d = s.picked.draft;
        const created = await client.people.create({ FirstName: d.firstName || null, LastName: d.lastName || null, Sex: d.sex, BirthDate: d.birthDate }, { treeId });
        made.push(...created.auditIds);
        return created.Id;
    };

    let familyId: number;
    let savedPlaceId: number | null | undefined;
    try {
        for (const s of [...partners, ...children]) peopleIds.set(s.key, await idOf(s));
        const family = await client.families.create({
            Partner1Id: partners[0] ? peopleIds.get(partners[0].key) ?? null : null,
            Partner2Id: partners[1] ? peopleIds.get(partners[1].key) ?? null : null,
            Type: type,
            MarriageDate: start.date.trim() || null,
            MarriagePlace: start.place.trim() || null,
            MarriagePlaceId: start.place.trim() ? start.placeId : null,
        }, treeId);
        familyId = family.Id;
        savedPlaceId = family.MarriagePlaceId;
    } catch (error) {
        if (made.length > 0) { try { await client.audit.revert(made, treeId); } catch { /* report the first error */ } }
        return { ok: false, error };
    }

    const failed: string[] = [];
    try { await flushPlace(start.place.trim(), start.resolution, savedPlaceId); } catch { /* best effort */ }
    for (const c of inBirthOrder(children)) {
        try {
            await client.families.addChild(familyId, peopleIds.get(c.key) as number, slotLinks(c, partners), treeId);
        } catch {
            failed.push(say.child(say.childName(c)));
        }
    }
    let endEventId: number | null = null;
    if (end) {
        try {
            const ev = await client.events.create({
                Type: END_REASON_TAGS[end.reason], Date: end.date.trim() || null, Place: end.place.trim() || null,
                PlaceId: end.place.trim() ? end.placeId : null, FamilyId: familyId,
            }, treeId);
            endEventId = ev.Id;
            try { await flushPlace(end.place.trim(), end.resolution, ev.PlaceId); } catch { /* best effort */ }
        } catch {
            failed.push(say.end(end.reason));
        }
    }
    for (const pc of pending) {
        const factId = pc.for === 'start' ? familyId : endEventId;
        if (factId == null) continue;
        let sourceId = pc.sourceId;
        if (sourceId == null && pc.newSource) {
            try {
                sourceId = (await client.sources.create(pc.newSource, treeId)).Id;
            } catch {
                failed.push(say.source());
                continue;
            }
        }
        if (sourceId == null) continue;
        try {
            await client.citations.create({
                FactTable: pc.for === 'start' ? FACT_TABLES.FAMILIES : FACT_TABLES.EVENTS, FactId: factId, SourceId: sourceId,
                Page: pc.page, Quay: pc.quay ?? null, DataText: pc.dataText ?? null, Url: pc.url ?? null,
            }, treeId);
        } catch {
            failed.push(say.citation());
        }
    }
    return { ok: true, familyId, failed };
}
