import { describe, expect, it } from 'vitest';
import { FACT_TABLES } from '@/lib/db/fact-tables';
import {
  datedFactValue,
  describeCitationFact,
  groupCitationFactsBySource,
  numberSources,
  chipCitations,
  citationFactFor,
  withFallbackCitationFacts,
} from '@/app/components/citations/factDescriptors';
import type { Citation } from '@/lib/db/queries/citations';

function citation(overrides: Partial<Citation>): Citation {
  return {
    Id: 1, OwnerId: 1, FactTable: FACT_TABLES.PERSON_BIRTH, FactId: 7, SourceId: 10,
    Page: null, Note: null, Quay: null, DataText: null, DataDate: null, Even: null, Role: null,
    CreatedAt: '2026-01-01', sourceTitle: 'Civil register', ...overrides,
  };
}

describe('citation fact descriptors', () => {
  it('counts one assertion when a source has multiple citation rows for the same fact', () => {
    const map = {
      'PersonBirth:7': [citation({ Id: 1 }), citation({ Id: 2, Page: 'p. 4' })],
    };
    const fact = describeCitationFact(map, FACT_TABLES.PERSON_BIRTH, 7, 'Birth', '12 March 1874');

    expect(groupCitationFactsBySource([fact])).toEqual([expect.objectContaining({
      sourceId: 10,
      facts: [fact],
    })]);
  });

  it('keeps an association visible when its display fact is unavailable', () => {
    const orphan = citation({ Id: 3, FactTable: FACT_TABLES.EVENTS, FactId: 99 });
    const facts = withFallbackCitationFacts([], { 'Events:99': [orphan] }, (table, id) => `${table} #${id}`);

    expect(facts).toEqual([{
      factTable: FACT_TABLES.EVENTS,
      factId: 99,
      label: 'Events #99',
      value: 'Events #99',
      citations: [orphan],
    }]);
  });

  it('groups one source across distinct facts without losing either assertion', () => {
    const birth = describeCitationFact({ 'PersonBirth:7': [citation({ Id: 1 })] }, FACT_TABLES.PERSON_BIRTH, 7, 'Birth', '1874');
    const deathCitation = citation({ Id: 2, FactTable: FACT_TABLES.PERSON_DEATH, SourceId: 10 });
    const death = describeCitationFact({ 'PersonDeath:7': [deathCitation] }, FACT_TABLES.PERSON_DEATH, 7, 'Death', '1940');

    expect(groupCitationFactsBySource([birth, death])[0].facts).toHaveLength(2);
  });
});

describe('numberSources (#754)', () => {
  it('numbers sources 1, 2, 3… by first appearance, not by source ID', () => {
    const birth = describeCitationFact({ 'PersonBirth:7': [citation({ Id: 1, SourceId: 317 }), citation({ Id: 2, SourceId: 5 })] }, FACT_TABLES.PERSON_BIRTH, 7, 'Birth', '1874');
    const death = describeCitationFact({ 'PersonDeath:7': [citation({ Id: 3, FactTable: FACT_TABLES.PERSON_DEATH, SourceId: 5 }), citation({ Id: 4, FactTable: FACT_TABLES.PERSON_DEATH, SourceId: 1042 })] }, FACT_TABLES.PERSON_DEATH, 7, 'Death', '1940');

    const numbers = numberSources([birth, death]);
    expect([...numbers]).toEqual([[317, 1], [5, 2], [1042, 3]]);
  });

  it('matches the order Sources cited groups its rows in', () => {
    const facts = [
      describeCitationFact({ 'PersonBirth:7': [citation({ Id: 1, SourceId: 9 })] }, FACT_TABLES.PERSON_BIRTH, 7, 'Birth', '1874'),
      describeCitationFact({ 'PersonDeath:7': [citation({ Id: 2, FactTable: FACT_TABLES.PERSON_DEATH, SourceId: 4 }), citation({ Id: 3, FactTable: FACT_TABLES.PERSON_DEATH, SourceId: 9 })] }, FACT_TABLES.PERSON_DEATH, 7, 'Death', '1940'),
    ];
    const numbers = numberSources(facts);
    expect(groupCitationFactsBySource(facts).map(g => numbers.get(g.sourceId))).toEqual([1, 2]);
  });
});

describe('chipCitations (#756)', () => {
  it('gives a fact one chip per source, in footnote order', () => {
    const chips = chipCitations(
      [citation({ Id: 1, SourceId: 8 }), citation({ Id: 2, SourceId: 3 }), citation({ Id: 3, SourceId: 8 })],
      new Map([[3, 1], [8, 2]]),
    );
    expect(chips.map(c => c.Id)).toEqual([2, 1]);
  });
});

describe('datedFactValue (#731)', () => {
  it('keeps the date apart so it can render in the mono date treatment', () => {
    expect(datedFactValue('12 Mar 1889', 'Kent', 'Unknown')).toEqual({ value: '12 Mar 1889 · Kent', date: '12 Mar 1889', detail: 'Kent' });
    expect(datedFactValue('1889', null, 'Unknown')).toEqual({ value: '1889', date: '1889', detail: undefined });
  });

  it('is plain text without a date', () => {
    expect(datedFactValue(null, 'Kent', 'Unknown')).toEqual({ value: 'Kent' });
    expect(datedFactValue(null, null, 'Unknown')).toEqual({ value: 'Unknown' });
  });

  it('flows into the descriptor', () => {
    const fact = describeCitationFact({}, FACT_TABLES.PERSON_BIRTH, 7, 'Birth', datedFactValue('1889', 'Kent', 'Unknown'));
    expect(fact).toMatchObject({ value: '1889 · Kent', date: '1889', detail: 'Kent' });
  });
});

describe('citationFactFor (#780)', () => {
  it('opens on the described fact, with its citations', () => {
    const fact = describeCitationFact({ 'PersonBirth:7': [citation({})] }, FACT_TABLES.PERSON_BIRTH, 7, 'Birth', '1889');
    expect(citationFactFor([fact], { factTable: FACT_TABLES.PERSON_BIRTH, factId: 7, factLabel: 'birth pin' })).toBe(fact);
  });

  it('opens an undescribed fact uncited, under the pin label', () => {
    expect(citationFactFor([], { factTable: FACT_TABLES.EVENTS, factId: 3, factLabel: 'Residence' }))
      .toEqual({ factTable: FACT_TABLES.EVENTS, factId: 3, label: 'Residence', value: '', citations: [] });
  });
});
