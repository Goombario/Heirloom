import type { PendingCitation } from '@/app/components/AttachSourceSidebar';
import type { DataClient } from '@/lib/data/types';
import type { FactTableValue } from '@/lib/db/fact-tables';

/**
 * Writes a queued citation once its fact has a persisted id: a case entry
 * (#34) or a new event cited from the Add an event composer (#192). A queued
 * new source is created first. Returns the source id it cited.
 */
export async function attachPendingCitation(
  client: Pick<DataClient, 'sources' | 'citations'>,
  pending: PendingCitation,
  factTable: FactTableValue,
  factId: number,
  treeId: number | null,
): Promise<number> {
  const sourceId = pending.sourceId ?? (pending.newSource ? (await client.sources.create(pending.newSource, treeId)).Id : null);
  if (!sourceId) throw new Error('Queued citation has no source');
  await client.citations.create({
    FactTable: factTable,
    FactId: factId,
    SourceId: sourceId,
    Page: pending.page,
    Quay: pending.quay ?? null,
    DataText: pending.dataText ?? null,
    Url: pending.url ?? null,
  }, treeId);
  return sourceId;
}

/**
 * Writes every queued citation for a just-created fact. One failure doesn't stop
 * the rest; the caller says how many failed. Returns the ones that did not save,
 * so they can stay queued for another try.
 */
export async function attachPendingCitations(
  client: Pick<DataClient, 'sources' | 'citations'>,
  pending: readonly PendingCitation[],
  factTable: FactTableValue,
  factId: number,
  treeId: number | null,
): Promise<PendingCitation[]> {
  const failed: PendingCitation[] = [];
  for (const p of pending) {
    try {
      await attachPendingCitation(client, p, factTable, factId, treeId);
    } catch {
      failed.push(p);
    }
  }
  return failed;
}
