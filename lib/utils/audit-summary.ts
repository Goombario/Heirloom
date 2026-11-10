import type { AuditLogEntryWithUser, AuditSnapshotChanges } from '@/lib/db/schema';
import { formatYearOrEmpty } from '@/lib/date-utils';

/**
 * i18n label fragments for the summary. Passed in from the component so this
 * pure function stays translation-agnostic.
 */
export interface SummaryLabels {
  /** e.g. "Photo added" */
  photoAdded: string;
  /** e.g. "Sex" */
  sexPrefix: string;
  /** e.g. "b." */
  bornPrefix: string;
  /** e.g. "d." */
  diedPrefix: string;
  /** e.g. "Status" */
  statusPrefix: string;
  /** Display name of a case status code ("in_progress" → "In progress"). */
  caseStatus: (code: string) => string;
  /** Display name of an event's GEDCOM code ("OCCU" → "Occupation"). */
  eventType?: (code: string) => string;
  /** "Confirmed as correct: Mother over 55" / "Reopened: …" for a data check entry (#830). */
  dataCheck: (action: 'create' | 'delete', rule: string, threshold: number | null) => string;
}

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

function year(v: unknown): string | null {
  return formatYearOrEmpty(str(v)) || null;
}

/**
 * Best-effort one-line human summary of a create/delete audit entry, built from
 * its snapshot. Returns `null` for updates (which render a field diff instead)
 * or when nothing meaningful can be summarized. Never throws.
 */
export function summarizeAuditEntry(entry: AuditLogEntryWithUser, labels: SummaryLabels): string | null {
  if (entry.Action !== 'create' && entry.Action !== 'delete') return null;
  try {
    const snapshot = (entry.Changes as AuditSnapshotChanges)?.snapshot;
    if (!snapshot || typeof snapshot !== 'object') return null;

    const parts: (string | null)[] = [];
    switch (entry.EntityType) {
      case 'person': {
        const sex = str(snapshot.Sex);
        if (sex) parts.push(`${labels.sexPrefix} ${sex}`);
        const born = year(snapshot.BirthDate);
        if (born) parts.push(`${labels.bornPrefix} ${born}`);
        const died = year(snapshot.DeathDate);
        if (died) parts.push(`${labels.diedPrefix} ${died}`);
        parts.push(str(snapshot.BirthPlace) ?? str(snapshot.DeathPlace));
        break;
      }
      case 'family': {
        parts.push(str(snapshot.Type));
        parts.push(str(snapshot.MarriagePlace));
        break;
      }
      case 'event': {
        const type = str(snapshot.Type);
        parts.push(type && labels.eventType ? labels.eventType(type) : type);
        parts.push(str(snapshot.Place));
        break;
      }
      case 'media': {
        parts.push(labels.photoAdded);
        break;
      }
      case 'case': {
        const status = str(snapshot.Status);
        if (status) parts.push(`${labels.statusPrefix} ${labels.caseStatus(status)}`);
        break;
      }
      case 'datacheck': {
        const rule = str(snapshot.Rule);
        const threshold = typeof snapshot.Threshold === 'number' ? snapshot.Threshold : null;
        if (rule) parts.push(labels.dataCheck(entry.Action, rule, threshold));
        break;
      }
      default:
        return null;
    }

    const summary = parts.filter((p): p is string => !!p).join(' · ');
    return summary.length > 0 ? summary : null;
  } catch {
    return null;
  }
}
