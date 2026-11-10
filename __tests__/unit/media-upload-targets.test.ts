import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccessError, NotFoundError } from '@/lib/data/errors';
import { ValidationError } from '@/lib/validation';
import { resolveMediaUploadTargets } from '@/lib/services/media-upload-targets';

const mocks = vi.hoisted(() => ({
  resolveTreeScope: vi.fn(),
  ownerExistsInTree: vi.fn(),
  caseExistsInTree: vi.fn(),
}));

vi.mock('@/lib/db/queries/trees', () => ({ resolveTreeScope: mocks.resolveTreeScope }));
vi.mock('@/lib/db/queries/owner-links', () => ({ ownerExistsInTree: mocks.ownerExistsInTree }));
vi.mock('@/lib/db/queries/cases', () => ({ caseExistsInTree: mocks.caseExistsInTree }));

const input = {
  requestedTreeId: 10,
  requestedOwnerId: null,
  currentUserId: 7,
  personId: null,
  caseId: null,
  ownerTable: null,
  ownerRecordId: null,
};

describe('resolveMediaUploadTargets', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveTreeScope.mockResolvedValue({ treeId: 10, ownerId: 2, permission: 'owner' });
    mocks.ownerExistsInTree.mockResolvedValue(true);
    mocks.caseExistsInTree.mockResolvedValue(true);
  });

  it('requires ownerTable and ownerRecordId together after resolving scope', async () => {
    await expect(resolveMediaUploadTargets({ ...input, ownerTable: 'Families' }))
      .rejects.toBeInstanceOf(ValidationError);
    expect(mocks.resolveTreeScope).toHaveBeenCalledWith({ treeId: 10, ownerId: null }, 7);
  });

  it.each(['owner', 'edit', 'contribute'] as const)('accepts valid targets for %s access', async (permission) => {
    mocks.resolveTreeScope.mockResolvedValueOnce({ treeId: 10, ownerId: 2, permission });

    await expect(resolveMediaUploadTargets({
      ...input, personId: 11, caseId: 12, ownerTable: 'Families', ownerRecordId: 13,
    })).resolves.toMatchObject({
      scope: { treeId: 10, ownerId: 2, permission },
      personId: 11,
      caseId: 12,
      owner: { table: 'Families', id: 13 },
    });
    expect(mocks.ownerExistsInTree).toHaveBeenCalledWith('People', 11, 10);
    expect(mocks.caseExistsInTree).toHaveBeenCalledWith(12, 10);
    expect(mocks.ownerExistsInTree).toHaveBeenCalledWith('Families', 13, 10);
  });

  it('rejects view access before querying any target existence', async () => {
    mocks.resolveTreeScope.mockResolvedValueOnce({ treeId: 10, ownerId: 2, permission: 'view' });

    await expect(resolveMediaUploadTargets({ ...input, personId: 11 }))
      .rejects.toBeInstanceOf(AccessError);
    expect(mocks.ownerExistsInTree).not.toHaveBeenCalled();
    expect(mocks.caseExistsInTree).not.toHaveBeenCalled();
  });

  it.each([
    ['missing person', { personId: 11 }, 'ownerExistsInTree'],
    ['foreign person', { personId: 11 }, 'ownerExistsInTree'],
    ['missing case', { caseId: 12 }, 'caseExistsInTree'],
    ['foreign case', { caseId: 12 }, 'caseExistsInTree'],
    ['missing owner', { ownerTable: 'Sources', ownerRecordId: 13 }, 'ownerExistsInTree'],
    ['foreign owner', { ownerTable: 'Sources', ownerRecordId: 13 }, 'ownerExistsInTree'],
  ] as const)('hides %s targets as NotFound', async (_kind, target, mockName) => {
    mocks[mockName].mockResolvedValueOnce(false);

    await expect(resolveMediaUploadTargets({ ...input, ...target }))
      .rejects.toBeInstanceOf(NotFoundError);
  });
});
