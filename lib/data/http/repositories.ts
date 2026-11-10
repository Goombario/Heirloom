import type { RepositoriesClient, CreateRepositoryInput, UpdateRepositoryInput, Repository, RepositoryWithCount } from '../types';
import { throwForStatus, treeQuery } from './shared';

/** Repositories backed by the hosted REST API (`/api/repositories`). */
export class HttpRepositoriesClient implements RepositoriesClient {
  async list(treeId?: number | null): Promise<RepositoryWithCount[]> {
    const res = await fetch(`/api/repositories${treeQuery(treeId)}`);
    if (!res.ok) await throwForStatus(res);
    return ((await res.json()) as { repositories: RepositoryWithCount[] }).repositories;
  }

  async get(id: number, treeId?: number | null): Promise<Repository> {
    const res = await fetch(`/api/repositories/${id}${treeQuery(treeId)}`);
    if (!res.ok) await throwForStatus(res);
    return ((await res.json()) as { repository: Repository }).repository;
  }

  async sources(id: number, treeId?: number | null): Promise<{ Id: number; Title: string | null }[]> {
    const res = await fetch(`/api/repositories/${id}/sources${treeQuery(treeId)}`);
    if (!res.ok) await throwForStatus(res);
    return ((await res.json()) as { sources: { Id: number; Title: string | null }[] }).sources;
  }

  async create(input: CreateRepositoryInput, treeId?: number | null): Promise<Repository> {
    const res = await fetch(`/api/repositories${treeQuery(treeId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) await throwForStatus(res);
    return ((await res.json()) as { repository: Repository }).repository;
  }

  async update(id: number, patch: UpdateRepositoryInput, treeId?: number | null): Promise<Repository> {
    const res = await fetch(`/api/repositories/${id}${treeQuery(treeId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) await throwForStatus(res);
    return ((await res.json()) as { repository: Repository }).repository;
  }

  async remove(id: number, treeId?: number | null): Promise<void> {
    const res = await fetch(`/api/repositories/${id}${treeQuery(treeId)}`, { method: 'DELETE' });
    if (!res.ok) await throwForStatus(res);
  }
}
