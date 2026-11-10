import { describe, it, expect } from 'vitest';
import {
  fullName,
  avatarClass,
  eventIsBirth,
  eventIsDeath,
  countTotalFacts,
  countSourcedFacts,
  hasDeathFact,
  canAddVitalEvent,
  countDescendants,
  computeLastEventPlace,
  splitFirstName,
} from '@/app/people/view/derive';
import type { PersonWithRelations } from '@/lib/db/schema';

// Characterization tests — lock the pure derivations inline in PersonDetailView.

function person(partial: Partial<PersonWithRelations>): PersonWithRelations {
  return { Id: 1, FirstName: null, LastName: null, Sex: null, BirthDate: null, BirthPlace: null, DeathDate: null, DeathPlace: null, IsDeceased: null, events: [], spouses: [], ...partial } as PersonWithRelations;
}

describe('fullName / avatarClass', () => {
  it('fullName falls back to the unknown label', () => {
    expect(fullName(null, 'Unknown')).toBe('Unknown');
    expect(fullName(person({ FirstName: 'Ada', LastName: 'Lovelace' }))).toBe('Ada Lovelace');
  });
  it('avatarClass maps sex to a class', () => {
    expect(avatarClass('M')).toBe('avatar-male');
    expect(avatarClass('F')).toBe('avatar-female');
    expect(avatarClass(null)).toBe('avatar-neutral');
  });
});

describe('eventIsBirth / eventIsDeath', () => {
  it('classifies GEDCOM event types', () => {
    expect(eventIsBirth('BIRT')).toBe(true);
    expect(eventIsBirth('DEAT')).toBe(false);
    expect(eventIsDeath('DEAT')).toBe(true);
    expect(eventIsDeath('BURI')).toBe(true);
    expect(eventIsDeath('BIRT')).toBe(false);
  });
});

describe('countTotalFacts', () => {
  it('counts birth, death, and events', () => {
    expect(countTotalFacts(person({ BirthDate: '1900', DeathPlace: 'X', events: [{ Id: 1 } as never, { Id: 2 } as never] }))).toBe(4);
    expect(countTotalFacts(person({}))).toBe(0);
  });
  it('counts a flag-only death but not explicit living status', () => {
    expect(countTotalFacts(person({ IsDeceased: 1 }))).toBe(1);
    expect(countTotalFacts(person({ IsDeceased: 0 }))).toBe(0);
  });
});

describe('Add event vital guard', () => {
  it('does not offer Death when the only death data is IsDeceased=1', () => {
    const p = person({ IsDeceased: 1 });
    expect(hasDeathFact(p)).toBe(true);
    expect(canAddVitalEvent(p, 'DEAT')).toBe(false);
  });
  it('still offers Death for explicit living or unknown status with no death data', () => {
    expect(canAddVitalEvent(person({ IsDeceased: 0 }), 'DEAT')).toBe(true);
    expect(canAddVitalEvent(person({ IsDeceased: null }), 'DEAT')).toBe(true);
  });
});

describe('countSourcedFacts', () => {
  it('counts only birth/death/event facts that carry a citation', () => {
    const p = person({
      BirthDate: '1900', DeathPlace: 'X',
      events: [{ Id: 5 } as never, { Id: 6 } as never],
    });
    // Birth cited, death not; one of two events cited ⇒ 2 of 4 sourced.
    const citationMap = {
      'PersonBirth:1': [{}],
      'Events:5': [{}],
    } as Record<string, readonly unknown[]>;
    expect(countSourcedFacts(p, citationMap)).toBe(2);
    expect(countTotalFacts(p)).toBe(4);
  });
  it('ignores citations on facts the person does not have', () => {
    const p = person({ BirthDate: '1900' });
    // A stray death citation must not count when there is no death fact.
    expect(countSourcedFacts(p, { 'PersonDeath:1': [{}] } as Record<string, readonly unknown[]>)).toBe(0);
  });
  it('is 0 with an empty citation map', () => {
    expect(countSourcedFacts(person({ BirthDate: '1900' }), {})).toBe(0);
  });
});

describe('countDescendants', () => {
  it('sums children across spouses', () => {
    const p = person({ spouses: [{ children: [{}, {}] } as never, { children: [{}] } as never] });
    expect(countDescendants(p)).toBe(3);
  });
  it('is 0 with no spouses/children', () => {
    expect(countDescendants(person({}))).toBe(0);
  });
});

describe('computeLastEventPlace', () => {
  it('returns the most recent place across death/events/birth', () => {
    const p = person({
      BirthDate: '1900', BirthPlace: 'Birthtown',
      DeathDate: '1980', DeathPlace: 'Deathville',
      events: [{ Date: '1950', Place: 'Midtown' } as never],
    });
    expect(computeLastEventPlace(p)).toEqual({ place: 'Deathville', placeId: null });
  });
  it('falls back to an earlier place when there is no later one', () => {
    const p = person({ BirthDate: '1900', BirthPlace: 'Birthtown', events: [{ Date: '1950', Place: 'Midtown' } as never] });
    expect(computeLastEventPlace(p)).toEqual({ place: 'Midtown', placeId: null });
  });
  it('returns null with no places', () => {
    expect(computeLastEventPlace(person({}))).toBeNull();
  });
});

describe('splitFirstName', () => {
  it('splits the first word from the rest', () => {
    expect(splitFirstName('Ada Augusta')).toEqual({ firstWord: 'Ada', rest: 'Augusta' });
    expect(splitFirstName('Ada')).toEqual({ firstWord: 'Ada', rest: '' });
    expect(splitFirstName(null)).toEqual({ firstWord: '', rest: '' });
  });
});
