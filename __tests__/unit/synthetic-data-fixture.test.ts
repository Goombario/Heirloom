import { describe, expect, it } from 'vitest';
import { buildSyntheticDataset } from '@/scripts/synthetic-data-fixture';

describe('synthetic data fixture contract', () => {
  it('contains the supported relationship and family variants', () => {
    const dataset = buildSyntheticDataset();

    expect(dataset.people).toHaveLength(120);
    expect(new Set(dataset.families.map(family => family.type))).toEqual(
      new Set(['Marriage', 'Civil union', 'Common-law', 'Other', 'Unknown']),
    );
    expect(new Set(dataset.childLinks.map(link => link.relationshipType))).toEqual(
      new Set(['Birth', 'Adoption', 'Foster']),
    );
    expect(dataset.childLinks.some(link => (link.relationshipType as string) === 'Step')).toBe(false);
  });

  it('dates every person event inside that person\'s own life (#714)', () => {
    const dataset = buildSyntheticDataset();
    const byXref = new Map(dataset.people.map(person => [person.xref, person]));

    for (const event of dataset.events.filter(candidate => candidate.personXref)) {
      const person = byXref.get(event.personXref!)!;
      if (['BURI', 'PROB'].includes(event.type)) expect(person.deathDate).not.toBeNull();
      expect(event.date >= person.birthDate).toBe(true);
      if (person.deathDate && !['BURI', 'PROB'].includes(event.type)) expect(event.date <= person.deathDate).toBe(true);
    }
  });

  it('keeps a person\'s birth and death on the People row, never as Events rows', () => {
    const dataset = buildSyntheticDataset();
    expect(dataset.events.filter(event => event.personXref && ['BIRT', 'DEAT'].includes(event.type))).toEqual([]);
  });

  it('cites every fact kind, with a stacked birth, a family and an uncited source', () => {
    const dataset = buildSyntheticDataset();
    const citations = dataset.citations;
    expect(new Set(citations.map(citation => citation.factTable))).toEqual(
      new Set(['People', 'PersonName', 'PersonBirth', 'PersonDeath', 'NameVariant', 'Events', 'Families', 'Cases', 'CaseComments']),
    );
    expect(citations.filter(citation => citation.factTable === 'PersonBirth' && citation.factRef === '@I001@').map(citation => citation.sourceKey)).toEqual(['S1', 'S4', 'S6']);
    expect(citations.filter(citation => citation.factTable === 'Families' && citation.factRef === 'F001')).toHaveLength(2);
    const cited = new Set(citations.map(citation => citation.sourceKey));
    expect(dataset.sources.filter(source => !cited.has(source.key)).map(source => source.key)).toEqual(['S7']);
    const eventKeys = new Set(dataset.events.map((_, index) => `E${String(index + 1).padStart(3, '0')}`));
    for (const citation of citations.filter(candidate => candidate.factTable === 'Events')) expect(eventKeys.has(citation.factRef)).toBe(true);
  });

  it('builds a connected graph with multiple partners and duplicate-name ambiguity', () => {
    const dataset = buildSyntheticDataset();
    const partnerCounts = new Map<string, number>();

    for (const family of dataset.families) {
      for (const partner of [family.partner1, family.partner2]) {
        if (partner) partnerCounts.set(partner, (partnerCounts.get(partner) ?? 0) + 1);
      }
    }

    expect([...partnerCounts.values()].some(count => count > 1)).toBe(true);
    expect(dataset.people.filter(person => person.firstName === 'Morgan' && person.lastName === 'Vale')).toHaveLength(2);
    expect(dataset.families.some(family => family.children.includes('@I033@') && family.children.includes('@I034@'))).toBe(true);
  });

  it('covers image, tag, and face-review fixture data', () => {
    const dataset = buildSyntheticDataset();
    const taggedPeople = new Set(dataset.media.flatMap(media => media.tags.map(tag => tag.personXref)));

    expect(dataset.media).toHaveLength(30);
    expect(taggedPeople.size).toBe(120);
    expect(dataset.media.every(media => media.tags)).toBe(true);
    expect(dataset.media.every(media => media.tags.length === 4)).toBe(true);
    expect(new Set(dataset.faceCandidates.map(candidate => candidate.status))).toEqual(
      new Set(['pending', 'confirmed', 'dismissed']),
    );
    expect(new Set(dataset.faceCandidates.map(candidate => candidate.matchKind))).toEqual(
      new Set(['exact', 'ambiguous', 'none']),
    );
    for (const tag of dataset.media.flatMap(media => media.tags)) {
      expect(tag.regionX).toBeGreaterThanOrEqual(0);
      expect(tag.regionY).toBeGreaterThanOrEqual(0);
      expect(tag.regionX + tag.regionW).toBeLessThanOrEqual(100);
      expect(tag.regionY + tag.regionH).toBeLessThanOrEqual(100);
    }
  });

  it('covers every case shape the case pages and cases.json handle (#913)', () => {
    const dataset = buildSyntheticDataset();
    const { cases, citations } = dataset;
    expect(cases.length).toBeGreaterThanOrEqual(8);
    expect(new Set(cases.map(c => c.status))).toEqual(new Set(['in_progress', 'on_hold', 'closed']));
    // A case's stored status matches its last status line, as the app writes them.
    for (const c of cases) {
      const last = c.comments.filter(comment => comment.kind === 'status').at(-1)?.body ?? 'in_progress';
      expect(last === 'reopened' ? 'in_progress' : last, c.key).toBe(c.status);
      const days = c.comments.map(comment => comment.day);
      expect(days, c.key).toEqual([...days].sort((a, b) => a - b));
    }
    // Every closed case has a conclusion, right after its closing line.
    for (const c of cases.filter(candidate => candidate.status === 'closed')) {
      const closing = c.comments.findLastIndex(comment => comment.kind === 'status' && comment.body === 'closed');
      expect(c.comments[closing + 1]?.kind, c.key).toBe('conclusion');
    }
    expect(cases.some(c => c.comments.some(comment => comment.body === 'reopened'))).toBe(true);
    expect(cases.some(c => c.title.length > 100)).toBe(true);
    expect(cases.some(c => /[à-ÿ]/i.test(c.title))).toBe(true);
    expect(cases.some(c => /[а-я]/i.test(c.title))).toBe(true);
    expect(cases.some(c => c.tags.length === 0)).toBe(true);
    expect(cases.some(c => c.tags.length > 1)).toBe(true);
    expect(new Set(cases.map(c => Math.min(c.people.length, 2)))).toEqual(new Set([0, 1, 2]));
    expect(cases.filter(c => c.people.includes('@I001@'))).toHaveLength(2);
    expect(new Set(cases.flatMap(c => c.comments.map(comment => comment.kind)))).toEqual(new Set([null, 'status', 'conclusion']));
    expect(cases.some(c => c.comments.some(comment => comment.mediaKey))).toBe(true);
    expect(cases.some(c => c.media.length > 0)).toBe(true);

    const people = new Set(dataset.people.map(person => person.xref));
    const media = new Set(dataset.media.map(m => m.key));
    for (const c of cases) {
      for (const person of c.people) expect(people.has(person), `${c.key} ${person}`).toBe(true);
      for (const key of [...c.media, ...c.comments.flatMap(comment => comment.mediaKey ?? [])]) expect(media.has(key), `${c.key} ${key}`).toBe(true);
    }
    const caseKeys = new Set(cases.map(c => c.key));
    const commentKeys = new Set(cases.flatMap(c => c.comments.map((_, index) => `${c.key}/${index}`)));
    const caseCitations = citations.filter(citation => citation.factTable === 'Cases');
    for (const citation of caseCitations) expect(caseKeys.has(citation.factRef)).toBe(true);
    for (const citation of citations.filter(candidate => candidate.factTable === 'CaseComments')) expect(commentKeys.has(citation.factRef)).toBe(true);
    expect(new Set(caseCitations.map(citation => citation.factRef)).size).toBeGreaterThan(1);
    expect(caseCitations.some(citation => citation.page && citation.note)).toBe(true);
    expect(caseCitations.some(citation => !citation.page && !citation.note)).toBe(true);
    // A source cited on both facts and cases shows Used in research next to its facts.
    const factSources = new Set(citations.filter(citation => citation.factTable !== 'Cases' && citation.factTable !== 'CaseComments').map(citation => citation.sourceKey));
    expect(caseCitations.some(citation => factSources.has(citation.sourceKey))).toBe(true);
  });
});
