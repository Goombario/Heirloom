import type { Citation } from '@/lib/db/queries/citations';
import type { FactTableValue } from '@/lib/db/fact-tables';

/** Display-ready association between one persisted fact and its citations. */
export interface CitationFactDescriptor {
  factTable: FactTableValue;
  factId: number;
  label: string;
  /** Plain-text value ("12 Mar 1889 · Kent"), used where only text fits. */
  value: string;
  /** The formatted date and the rest of the value, kept apart so the date can
   *  render in `.date-mono` (see FactValue). Absent when the fact has no date. */
  date?: string;
  detail?: string;
  citations: Citation[];
}

export interface CitationPreviewTarget {
  fact: CitationFactDescriptor;
  citation: Citation;
  anchor: HTMLElement;
}
