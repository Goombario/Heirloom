import type { PendingCitation } from '@/app/components/AttachSourceSidebar';
import type { DataClient } from '@/lib/data/types';
import { FACT_TABLES } from '@/lib/db/fact-tables';

/** Flush a composer citation only after its comment has a persisted id. */
export async function attachPendingCommentCitation(
  client: Pick<DataClient, 'sources' | 'citations'>,
  pending: PendingCitation,
  commentId: number,
  treeId: number | null,
): Promise<number> {
  const sourceId = pending.sourceId ?? (pending.newSource ? (await client.sources.create(pending.newSource, treeId)).Id : null);
  if (!sourceId) throw new Error('Queued citation has no source');
  await client.citations.create({
    FactTable: FACT_TABLES.CASE_COMMENTS,
    FactId: commentId,
    SourceId: sourceId,
    Page: pending.page,
    Quay: pending.quay ?? null,
    DataText: pending.dataText ?? null,
    Url: pending.url ?? null,
  }, treeId);
  return sourceId;
}
