import { describe, it, expect } from 'vitest';
import { nodeKeyToId, parseNodeId, canonicalNodeId, clusterPrefix } from '@/lib/tree/keys';

describe('tree NodeKey codec', () => {
  it('encodes each role', () => {
    expect(nodeKeyToId({ personId: 42, role: 'person' })).toBe('person-42');
    expect(nodeKeyToId({ personId: 42, role: 'spouse', spouseIndex: 1 })).toBe('person-42-spouse1');
    expect(nodeKeyToId({ personId: 42, role: 'spouse' })).toBe('person-42-spouse0');
    expect(nodeKeyToId({ personId: 42, role: 'sibling' })).toBe('person-42-sibling');
    expect(nodeKeyToId({ personId: 42, role: 'person', cluster: 'left' })).toBe('left-person-42');
    expect(nodeKeyToId({ personId: 7, role: 'spouse', spouseIndex: 0, cluster: 'center' })).toBe('center-person-7-spouse0');
  });

  it('round-trips through parseNodeId', () => {
    const keys = [
      { personId: 1, role: 'person' as const },
      { personId: 12, role: 'spouse' as const, spouseIndex: 3 },
      { personId: 5, role: 'sibling' as const },
      { personId: 9, role: 'person' as const, cluster: 'right' as const },
      { personId: 9, role: 'spouse' as const, spouseIndex: 0, cluster: 'center' as const },
    ];
    for (const key of keys) {
      expect(parseNodeId(nodeKeyToId(key))).toEqual(key);
    }
  });

  it('rejects non-tree IDs', () => {
    expect(parseNodeId('edge-person-1-person-2')).toBeNull();
    expect(parseNodeId('person-abc')).toBeNull();
    expect(parseNodeId('top-person-3')).toBeNull();
    expect(parseNodeId('')).toBeNull();
  });

  it('canonicalNodeId matches the historical dedup semantics exactly', () => {
    // The exact examples from the original toCanonical() doc comment:
    expect(canonicalNodeId('center-person-4215')).toBe('person-4215');
    expect(canonicalNodeId('center-person-4212-spouse0')).toBe('person-4212');
    expect(canonicalNodeId('right-person-4212')).toBe('person-4212');
    // Spouse suffix stripped even without a cluster prefix:
    expect(canonicalNodeId('person-8-spouse2')).toBe('person-8');
    // Sibling suffix preserved (ancestors mode never dedups):
    expect(canonicalNodeId('person-5-sibling')).toBe('person-5-sibling');
    // Unparseable IDs pass through unchanged:
    expect(canonicalNodeId('some-other-id')).toBe('some-other-id');
  });

  it('clusterPrefix matches the encoded prefix', () => {
    expect(clusterPrefix()).toBe('');
    expect(clusterPrefix('left')).toBe('left-');
    expect(nodeKeyToId({ personId: 3, role: 'person', cluster: 'left' })).toBe(`${clusterPrefix('left')}person-3`);
  });
});
