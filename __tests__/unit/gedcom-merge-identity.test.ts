import { describe, expect, it } from 'vitest';
import { mergeIdentityAgrees } from '@/lib/gedcom/merge-identity';

const existing = (FirstName: string | null, LastName: string | null, Sex: string | null = null, Variants: string[] = []) =>
  ({ FirstName, LastName, Sex, Variants });

describe('mergeIdentityAgrees (#871)', () => {
  it('accepts the same person regardless of case, accents and extra given names', () => {
    expect(mergeIdentityAgrees({ FirstName: 'John', LastName: 'Smith' }, existing('john', 'SMITH'))).toBe(true);
    expect(mergeIdentityAgrees({ FirstName: 'Émile Jean', LastName: 'Ölund' }, existing('Emile', 'Olund'))).toBe(true);
  });

  it('rejects a different person who holds the same xref', () => {
    expect(mergeIdentityAgrees({ FirstName: 'Maria', LastName: 'Garcia' }, existing('John', 'Smith'))).toBe(false);
    expect(mergeIdentityAgrees({ FirstName: 'John', LastName: 'Garcia' }, existing('John', 'Smith'))).toBe(false);
  });

  it('rejects a sex conflict but ignores unknown sex', () => {
    expect(mergeIdentityAgrees({ FirstName: 'Sam', LastName: 'Lee', Sex: 'M' }, existing('Sam', 'Lee', 'F'))).toBe(false);
    expect(mergeIdentityAgrees({ FirstName: 'Sam', LastName: 'Lee', Sex: 'U' }, existing('Sam', 'Lee', 'F'))).toBe(true);
  });

  it('matches through a name variant such as a married name', () => {
    expect(mergeIdentityAgrees({ FirstName: 'Anna', LastName: 'Smith' }, existing('Anna', 'Jones', 'F', ['Anna Smith']))).toBe(true);
    expect(mergeIdentityAgrees({ FirstName: 'Nan', LastName: 'Jones' }, existing('Anna', 'Jones', 'F', ['Nan']))).toBe(true);
  });

  it('needs each name part on both records or on neither (#950 review)', () => {
    expect(mergeIdentityAgrees({ FirstName: null, LastName: 'Smith' }, existing('John', 'Smith'))).toBe(false);
    expect(mergeIdentityAgrees({ FirstName: 'John', LastName: null }, existing('John', 'Doe'))).toBe(false);
    expect(mergeIdentityAgrees({ FirstName: 'John', LastName: null }, existing('John', null))).toBe(true);
    expect(mergeIdentityAgrees({ FirstName: null, LastName: null }, existing(null, null))).toBe(true);
    expect(mergeIdentityAgrees({ FirstName: null, LastName: null }, existing('John', 'Smith'))).toBe(false);
  });

  it('compares the whole surname, not its last word', () => {
    expect(mergeIdentityAgrees({ FirstName: 'Ana', LastName: 'Smith Jones' }, existing('Ana', 'Jones'))).toBe(false);
    expect(mergeIdentityAgrees({ FirstName: 'Ana', LastName: 'de la Cruz' }, existing('Ana', 'Ruiz', 'F', ['Ana de la Cruz']))).toBe(true);
  });
});
