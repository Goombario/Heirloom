import type { DataCheckEntry, DataChecksClient, DataChecksFilter, DataChecksResult, DataChecksSummary } from '../types';
import type { DataCheckInput } from '@/lib/data-checks/rules';
import {
  confirmDataCheckService, dataCheckNeighbourhoodService, listDataChecksService, loadDataChecks, reopenDataCheckService, summarizeDataChecksService,
  type DataChecksSnapshot,
} from '@/lib/services/data-checks';
import { memoUntilWrite } from './memo-until-write';
import { ensureLocalUser } from '../local-user';

/**
 * A tree's checks, kept until the next write (#1269). A person or family page
 * shows only its own data-check marks, but the rules need the whole tree's
 * dates, and reading them took about a third of a person page's queries,
 * twice per visit.
 */
const snapshots = memoUntilWrite<number, DataChecksSnapshot>();
const cachedDataChecks = (treeId: number) => snapshots.get(treeId, () => loadDataChecks(treeId));

/** TEST ONLY: forget every cached snapshot. */
export function __resetDataCheckSnapshots(): void {
  snapshots.reset();
}

/** Data checks run over in-browser PGlite: the same service and engine as the server. */
export class LocalDataChecksClient implements DataChecksClient {
  async list(treeId?: number | null, filter: DataChecksFilter = {}): Promise<DataChecksResult> {
    const currentUserId = await ensureLocalUser();
    return listDataChecksService({ ...filter, requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId }, cachedDataChecks);
  }

  async summary(treeId?: number | null): Promise<DataChecksSummary> {
    const currentUserId = await ensureLocalUser();
    return summarizeDataChecksService({ requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId }, cachedDataChecks);
  }

  async confirm(problemId: string, reason: string, treeId?: number | null): Promise<DataCheckEntry> {
    const currentUserId = await ensureLocalUser();
    return confirmDataCheckService({ problemId, reason, requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }

  async reopen(problemId: string, treeId?: number | null): Promise<void> {
    const currentUserId = await ensureLocalUser();
    await reopenDataCheckService({ problemId, requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId });
  }

  async neighbourhood(personId: number, treeId?: number | null): Promise<DataCheckInput> {
    const currentUserId = await ensureLocalUser();
    return dataCheckNeighbourhoodService({ personId, requestedTreeId: treeId ?? null, requestedOwnerId: null, currentUserId }, cachedDataChecks);
  }
}
