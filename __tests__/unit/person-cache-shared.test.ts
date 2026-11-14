import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dataCache } from '@/lib/data/cache';

const get = vi.fn(async (id: number) => ({ Id: id, events: [{ Id: 70, noteCount: 1 }] }));
const list = vi.fn(async () => ({ media: [] }));
const listForPerson = vi.fn(async () => ({}));
const listNameVariants = vi.fn(async () => []);
const listForOwner = vi.fn(async () => []);
vi.mock('@/lib/data', () => ({
  getDataClient: async () => ({
    people: { get, listNameVariants },
    media: { list },
    citations: { listForPerson },
    notes: { listForOwner },
  }),
}));

const { loadPerson, prefetchPerson } = await import('@/app/people/view/personCache');
const { loadOwnerNotes, notesKey } = await import('@/app/components/notes/ownerNotesCache');

describe('person cache loads (#65)', () => {
  beforeEach(() => {
    dataCache.clear();
    vi.clearAllMocks();
  });

  it('a page that mounts during a hover prefetch joins it instead of asking again', async () => {
    prefetchPerson(5, 1);
    await loadPerson(5, 1);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('warms the notes on the person and on their events', async () => {
    prefetchPerson(5, 1);
    await vi.waitFor(() => expect(dataCache.has(notesKey(1, 'Events', 70))).toBe(true));
    expect(dataCache.has(notesKey(1, 'People', 5))).toBe(true);
  });

  it('never joins a load that started before a write', async () => {
    const first = loadOwnerNotes('People', 5, 1);
    dataCache.clear();
    await Promise.all([first, loadOwnerNotes('People', 5, 1)]);
    expect(listForOwner).toHaveBeenCalledTimes(2);
  });
});
