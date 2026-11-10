---
name: new-api-route
description: Scaffold a new API route following the three-layer pattern with auth, tree-scope resolution, and error handling
---

Scaffold a new Next.js API route for this genealogy app following the exact three-layer pattern (route → service → query) used throughout the codebase. Reference implementations: `app/api/people/route.ts` → `lib/services/people.ts` → `lib/db/queries/people.ts`.

## Architecture Overview (multi-tree)

Every API route follows this exact sequence:
1. `getUserFromRequest()` → 401 if null
2. Parse BOTH scope params with `parseIdParam` from `@/lib/utils/parse-id`: `requestedTreeId` from `?treeId=` (primary) and `requestedOwnerId` from `?ownerId=` (legacy deep-link compat → that user's default tree)
3. Pass both to the SERVICE, which resolves scope ONCE: `const scope = await resolveTreeScope({ treeId: requestedTreeId, ownerId: requestedOwnerId }, currentUserId)` — from `@/lib/db/queries/trees`; throws `AccessError` (→ 403)
4. Queries filter by `scope.treeId` (`WHERE "TreeId" = $n`); INSERTs write BOTH the legacy owner column (`scope.ownerId` — the tree's owning user) AND `"TreeId"` (`scope.treeId`)
5. Write gates: `scope.permission === 'view'` blocks all writes; `'view' || 'contribute'` blocks deletes
6. Routes catch errors with `handleApiError(error, 'Failed to …')` from `@/lib/api/handle-error` (ValidationError→400, AccessError→403, NotFoundError→404, else 500)

## Route Template

**File**: `app/api/<entity>/route.ts` — routes stay THIN; logic lives in the service.

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { parseIdParam } from '@/lib/utils/parse-id';
import { list<Entity>Service, create<Entity>Service } from '@/lib/services/<entity>';
import { handleApiError } from '@/lib/api/handle-error';

export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const result = await list<Entity>Service({
      requestedTreeId: parseIdParam(searchParams.get('treeId')),
      requestedOwnerId: parseIdParam(searchParams.get('ownerId')),
      currentUserId: user.id,
    });
    return NextResponse.json(result); // { <entity>s: [...], count }
  } catch (error) {
    return handleApiError(error, 'Failed to fetch <entity>s');
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getUserFromRequest();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { searchParams } = new URL(request.url);
    const item = await create<Entity>Service({
      body,
      requestedTreeId: parseIdParam(searchParams.get('treeId')),
      requestedOwnerId: parseIdParam(searchParams.get('ownerId')),
      currentUserId: user.id,
    });
    return NextResponse.json({ <entity>: item }, { status: 201 });
  } catch (error) {
    return handleApiError(error, 'Failed to create <entity>');
  }
}
```

**Item routes** (`app/api/<entity>/[id]/route.ts`): Next.js 16 — `params: Promise<{ id: string }>`, always `await params` before use; parse the id with `parseIdParam` and 400 on null.

## Service Template

**File**: `lib/services/<entity>.ts`

```typescript
import { getAll<Entity>, create<Entity> } from '@/lib/db/queries/<entity>';
import { resolveTreeScope } from '@/lib/db/queries/trees';
import { validateStringField, ValidationError } from '@/lib/validation';
import { AccessError } from '@/lib/data/errors';
import type { <Entity>, New<Entity> } from '@/lib/db/schema';

export interface List<Entity>Params {
  requestedTreeId: number | null;
  requestedOwnerId: number | null;
  currentUserId: number;
}

export async function list<Entity>Service(params: List<Entity>Params) {
  const { requestedTreeId, requestedOwnerId, currentUserId } = params;
  const scope = await resolveTreeScope(
    { treeId: requestedTreeId, ownerId: requestedOwnerId },
    currentUserId
  );
  const items = await getAll<Entity>(scope.treeId);
  return { <entity>s: items, count: items.length };
}

export async function create<Entity>Service(params: List<Entity>Params & { body: Record<string, unknown> }) {
  const { body, requestedTreeId, requestedOwnerId, currentUserId } = params;
  const scope = await resolveTreeScope(
    { treeId: requestedTreeId, ownerId: requestedOwnerId },
    currentUserId
  );
  if (scope.permission === 'view') {
    throw new AccessError('You only have view permission for this tree');
  }

  const newItem: New<Entity> = {
    UserId: scope.ownerId,   // legacy owner column: the TREE's owner
    TreeId: scope.treeId,    // the scope column every read filters on
    RequiredField: validateStringField(body.RequiredField, 'RequiredField', 255),
  };
  return create<Entity>(newItem, currentUserId);
}
```

## Query File Checklist

When creating `lib/db/queries/<entity>.ts`, ensure:

- [ ] Scope params are named `treeId` and predicates filter `"TreeId" = $n` (NEVER the legacy owner columns — those are written on INSERT but not used as scope)
- [ ] Two-step mutations (SELECT-to-authorize, then `UPDATE/DELETE … WHERE "Id" = $1`): the authorizing SELECT MUST filter `"TreeId"`
- [ ] `ALLOWED_<ENTITY>_FIELDS` set for dynamic updates excludes `'UserId'` AND `'TreeId'`
- [ ] All SQL column names double-quoted: `"ColumnName"` (PascalCase)
- [ ] `auditCreate()/auditUpdate()/auditDelete()` called after writes — pass rows from `RETURNING *`/`SELECT *` so the audit entry derives `TreeId` from the row
- [ ] `ENTITY_CONFIG` in `lib/db/queries/audit.ts` updated with new entity + allowed fields (do NOT include TreeId there)
- [ ] New entity type in `lib/db/schema.ts` includes `TreeId?: number | null`
- [ ] New table gets a `"TreeId" INTEGER` column + index in `lib/db/init-schema.ts` (CREATE + ALTER migration + backfill stamp) and a `SCHEMA_VERSION` bump

## Data-client checklist

- [ ] Add the client interface to `lib/data/types.ts` with a trailing `treeId?: number | null` scope param
- [ ] `lib/data/http/<entity>.ts` serializes it via `treeQuery(treeId)` from `./shared`
- [ ] `lib/data/local/<entity>.ts` passes `requestedTreeId: treeId ?? null`
- [ ] Frontend consumers pass `activeTreeId` from `useTree()`

## Response Shape Reference

| Operation | Shape | Status |
|-----------|-------|--------|
| GET list | `{ <entity>s: [...], count: number }` | 200 |
| GET one | `{ <entity>: {...} }` | 200 |
| POST | `{ <entity>: {...} }` | 201 |
| PUT | `{ <entity>: {...} }` | 200 |
| DELETE | `{ success: true }` | 200 |
| Not found | `{ error: "... not found" }` | 404 |
| Validation | `{ error: "..." }` | 400 |
| Unauthorized | `{ error: "Unauthorized" }` | 401 |
| Access denied | `{ error: "Access denied..." }` | 403 |
| Server error | `{ error: "Failed to ..." }` | 500 |

## Instructions

When the user asks to create a new API route:
1. Ask for the entity name and its fields (if not specified)
2. Scaffold `route.ts` (+ `[id]/route.ts` if needed), the service file, and the query file per the templates
3. Replace all `<entity>` / `<Entity>` placeholders
4. Walk both checklists above
5. Add integration tests mirroring `__tests__/integration/api/trees.test.ts` idioms, including a cross-tree isolation case (create in tree A, invisible with `?treeId=B`)
