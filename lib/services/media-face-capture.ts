import { parseImageMetadata } from '@/lib/media/xmp-faces';
import {
  insertFaceCandidates, loadNameMatcher, type NewFaceCandidate,
} from '@/lib/db/queries/media-faces';
import { getTagsForMedia } from '@/lib/db/queries/media-tags';

/** Options for best-effort metadata face capture during media ingestion. */
export interface CaptureFacesOptions {
  /** Skip metadata capture when the import sidecar already restored tags. */
  skipIfTagged?: boolean;
}

/**
 * Reads a photo's metadata and stages any face regions it declares. Also returns
 * its caption and taken date, which the upload paths apply to the new row.
 *
 * Best-effort by contract: a photo whose metadata cannot be read, or whose
 * candidates fail to insert, still uploads. Losing a face suggestion is a
 * much smaller harm than losing the upload.
 *
 * MUST be called with the ORIGINAL bytes, before compression — `sharp` strips
 * XMP, so calling it afterwards silently finds nothing.
 */
export async function captureFacesForMedia(
  bytes: Uint8Array,
  mediaId: number,
  treeId: number,
  options?: CaptureFacesOptions,
): Promise<{ captured: number; caption: string | null; takenDate: string | null }> {
  try {
    // Our own media.json sidecar is authoritative for the photos it covers —
    // re-importing an export we produced must not queue up duplicates of tags
    // it already restored.
    if (options?.skipIfTagged) {
      const existing = await getTagsForMedia(mediaId, treeId);
      if (existing.length > 0) return { captured: 0, caption: null, takenDate: null };
    }
    const { faces, caption, takenDate } = parseImageMetadata(bytes);
    if (faces.length === 0) return { captured: 0, caption, takenDate };

    // ONE read of the tree's names for the whole photo, memoised by name inside
    // the matcher — not two full-table scans per face (#487 review).
    const matcher = await loadNameMatcher(treeId);
    const rows: NewFaceCandidate[] = [];
    for (const face of faces) {
      const match = face.name
        ? matcher.match(face.name)
        : { personId: null, kind: 'none' as const, candidateCount: 0 };
      rows.push({
        MediaId: mediaId,
        TreeId: treeId,
        RegionX: face.x, RegionY: face.y, RegionW: face.w, RegionH: face.h,
        SourceName: face.name,
        SuggestedPersonId: match.personId,
        MatchKind: match.kind,
      });
    }
    const captured = await insertFaceCandidates(rows);
    return { captured, caption, takenDate };
  } catch (error) {
    // Swallowing is the contract — an unreadable photo must still upload — but
    // silence here is the ONLY symptom of a broken capture path, so leave a
    // trace. Matches the '[Label] message:' console convention in lib/.
    console.warn('[Faces] Capture failed for media', mediaId, error);
    return { captured: 0, caption: null, takenDate: null };
  }
}
