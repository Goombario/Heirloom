import type { TreeClient, TreeCounts, TreeGetParams } from '../types';
import type { TreeData } from '@/app/components/tree/types';
import { treeQuery, throwForStatus } from './shared';

/** Tree methods backed by the hosted REST API (`/api/tree`). */
export class HttpTreeClient implements TreeClient {
  async get({ id, mode, treeId }: TreeGetParams): Promise<TreeData> {
    const params = new URLSearchParams({ mode });
    if (id != null) params.set('id', String(id));
    if (treeId != null) params.set('treeId', String(treeId));
    const res = await fetch(`/api/tree?${params.toString()}`);
    if (!res.ok) await throwForStatus(res);
    return (await res.json()) as TreeData;
  }

  async getCounts(treeId?: number | null): Promise<TreeCounts> {
    const res = await fetch(`/api/tree/counts${treeQuery(treeId)}`);
    if (!res.ok) await throwForStatus(res);
    return (await res.json()) as TreeCounts;
  }
}
