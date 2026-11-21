import type { TreesClient } from '../types';
import type { Tree } from '@/lib/db/schema';
import { throwForStatus } from './shared';

export class HttpTreesClient implements TreesClient {
  async list(): Promise<{ trees: Tree[]; count: number }> {
    const res = await fetch('/api/trees');
    if (!res.ok) await throwForStatus(res);
    return (await res.json()) as { trees: Tree[]; count: number };
  }

  async get(id: number): Promise<{ tree: Tree; permission: 'owner' | 'edit' | 'contribute' | 'view' }> {
    const res = await fetch(`/api/trees/${id}`);
    if (!res.ok) await throwForStatus(res);
    return (await res.json()) as { tree: Tree; permission: 'owner' | 'edit' | 'contribute' | 'view' };
  }

  async create(name: string): Promise<Tree> {
    const res = await fetch('/api/trees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) await throwForStatus(res);
    const data = (await res.json()) as { tree: Tree };
    return data.tree;
  }

  async rename(id: number, name: string): Promise<Tree> {
    const res = await fetch(`/api/trees/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) await throwForStatus(res);
    const data = (await res.json()) as { tree: Tree };
    return data.tree;
  }

  async getIsEmpty(id: number): Promise<boolean> {
    const res = await fetch(`/api/trees/${id}/empty`);
    if (!res.ok) await throwForStatus(res);
    const body = (await res.json()) as { isEmpty?: unknown };
    return body.isEmpty === true;
  }

  async remove(id: number, opts?: { onlyIfEmpty?: boolean }): Promise<{ cleanupWarningCount: number }> {
    // Tree deletion is NOT restorable from the audit log — the API demands the
    // confirmation header on every delete, empty or not; the UI additionally gates
    // a tree with data on typing its name (#36).
    const res = await fetch(`/api/trees/${id}${opts?.onlyIfEmpty ? '?onlyIfEmpty=1' : ''}`, {
      method: 'DELETE',
      headers: { 'X-Confirm-Delete-Tree': 'CONFIRM_DELETE_TREE' },
    });
    if (!res.ok) await throwForStatus(res);
    const body = await res.json().catch(() => ({})) as { cleanupWarningCount?: unknown };
    return { cleanupWarningCount: typeof body.cleanupWarningCount === 'number' ? body.cleanupWarningCount : 0 };
  }
}
