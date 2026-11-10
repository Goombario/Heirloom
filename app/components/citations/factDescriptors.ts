import type { Citation } from '@/lib/db/queries/citations';
import type { FactTableValue } from '@/lib/db/fact-tables';
import type { CitationFactDescriptor } from './types';

export type CitationMap = Record<string, Citation[]>;

function citationFactKey(factTable: string, factId: number): string {
  return `${factTable}:${factId}`;
}

/** A fact's value with its (already formatted) date kept apart from the rest. */
interface CitationFactValue {
  value: string;
  date?: string;
  detail?: string;
}

/** Build a dated value: "date · place", or `unknown` when both are empty. */
export function datedFactValue(
  date: string | null | undefined,
  place: string | null | undefined,
  unknown: string,
): CitationFactValue {
  const value = [date, place].filter(Boolean).join(' · ') || unknown;
  return date ? { value, date, detail: place || undefined } : { value };
}

export function describeCitationFact(
  citationMap: CitationMap,
  factTable: FactTableValue,
  factId: number,
  label: string,
  value: string | CitationFactValue,
): CitationFactDescriptor {
  const parts = typeof value === 'string' ? { value } : value;
  return { factTable, factId, label, ...parts, citations: citationMap[citationFactKey(factTable, factId)] ?? [] };
}

/** Keep imported/orphaned associations visible even when their display row is unavailable. */
export function withFallbackCitationFacts(
  described: CitationFactDescriptor[],
  citationMap: CitationMap,
  fallback: (table: string, id: number) => string,
): CitationFactDescriptor[] {
  const byKey = new Map(described.map(f => [citationFactKey(f.factTable, f.factId), f]));
  for (const [key, citations] of Object.entries(citationMap)) {
    if (byKey.has(key) || citations.length === 0) continue;
    const separator = key.lastIndexOf(':');
    const table = key.slice(0, separator) as FactTableValue;
    const id = Number(key.slice(separator + 1));
    if (!table || !Number.isInteger(id)) continue;
    const label = fallback(table, id);
    byKey.set(key, { factTable: table, factId: id, label, value: label, citations });
  }
  return [...byKey.values()];
}

export interface SourceAssertionGroup {
  sourceId: number;
  title: string | null;
  facts: CitationFactDescriptor[];
}

export function groupCitationFactsBySource(facts: CitationFactDescriptor[]): SourceAssertionGroup[] {
  const groups = new Map<number, SourceAssertionGroup>();
  for (const fact of facts) {
    for (const citation of fact.citations) {
      const group = groups.get(citation.SourceId) ?? {
        sourceId: citation.SourceId,
        title: citation.sourceTitle ?? null,
        facts: [],
      };
      if (!group.facts.some(existing => citationFactKey(existing.factTable, existing.factId) === citationFactKey(fact.factTable, fact.factId))) {
        group.facts.push(fact);
      }
      groups.set(citation.SourceId, group);
    }
  }
  return [...groups.values()];
}

/** Source ID → page-local footnote number. */
export type SourceNumbers = ReadonlyMap<number, number>;

/**
 * Page-local footnote numbers (#754): each source gets 1, 2, 3… in order of
 * first appearance across `facts`, which callers pass in page order. Chips and
 * the Sources cited list share one numbering, so a chip finds its footnote;
 * the `SourceId` stays the link target only.
 */
export function numberSources(facts: readonly { citations: readonly Pick<Citation, 'SourceId'>[] }[]): SourceNumbers {
  const numbers = new Map<number, number>();
  for (const fact of facts) {
    for (const citation of fact.citations) {
      if (!numbers.has(citation.SourceId)) numbers.set(citation.SourceId, numbers.size + 1);
    }
  }
  return numbers;
}

/**
 * The chips for one fact: one per source, in footnote order (#756). A second
 * citation of the same source adds no chip; the popover lists every citation.
 */
export function chipCitations<C extends Pick<Citation, 'SourceId'>>(citations: readonly C[], numbers: SourceNumbers): C[] {
  const seen = new Set<number>();
  return citations
    .filter(c => !seen.has(c.SourceId) && seen.add(c.SourceId))
    .sort((a, b) => (numbers.get(a.SourceId) ?? Infinity) - (numbers.get(b.SourceId) ?? Infinity));
}

/**
 * The fact a citation editor opens on. A pin can target a fact this page doesn't
 * describe (it has no row yet); `withFallbackCitationFacts` already covers every
 * cited fact, so such a fact is uncited and opens with no citations (#780).
 */
export function citationFactFor(
  facts: CitationFactDescriptor[],
  target: { factTable: FactTableValue; factId: number; factLabel: string },
): CitationFactDescriptor {
  return facts.find(f => f.factTable === target.factTable && f.factId === target.factId)
    ?? { factTable: target.factTable, factId: target.factId, label: target.factLabel, value: '', citations: [] };
}
