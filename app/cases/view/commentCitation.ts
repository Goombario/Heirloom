import type { PendingCitation } from '@/app/components/AttachSourceSidebar';
import { attachPendingCitation } from '@/app/components/citations/pendingCitations';
import type { DataClient } from '@/lib/data/types';
import { FACT_TABLES } from '@/lib/db/fact-tables';

/** Flush a composer citation only after its comment has a persisted id. */
export async function attachPendingCommentCitation(
  client: Pick<DataClient, 'sources' | 'citations'>,
  pending: PendingCitation,
  commentId: number,
  treeId: number | null,
): Promise<number> {
  return attachPendingCitation(client, pending, FACT_TABLES.CASE_COMMENTS, commentId, treeId);
}
