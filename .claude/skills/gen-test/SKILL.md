---
name: gen-test
description: Generate Vitest unit or integration tests following this project's established patterns
---

Generate a Vitest test file for the specified module or API route, following the exact conventions used in this codebase.

## Decision: Unit vs Integration

**Write a unit test** (`__tests__/unit/`) when:
- The target is a pure function in `lib/` (validation, date-utils, GEDCOM parser/generator, rate-limit)
- No database or HTTP is involved
- Run with `npm run test:unit`

**Write an integration test** (`__tests__/integration/api/`) when:
- The target is an API route handler in `app/api/`
- Requires real database operations
- Run with `npm run test:integration`

---

## Integration Test Template

File location: `__tests__/integration/api/<entity>.test.ts`

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { GET, POST } from '@/app/api/<entity>/route';
import { GET as GET_BY_ID, PUT, DELETE } from '@/app/api/<entity>/[id]/route';
import { createRequest, parseResponse } from '../../setup/test-helpers';
import { cleanupTestData, hasTestDatabase } from '../../setup/db-helpers';

const describeIf = hasTestDatabase() ? describe : describe.skip;

describeIf('API /api/<entity>', () => {
  afterEach(async () => {
    await cleanupTestData();
  });

  describe('POST /api/<entity>', () => {
    it('creates a <entity> with valid data', async () => {
      const req = createRequest('http://localhost:3000/api/<entity>', {
        method: 'POST',
        body: { /* required fields */ },
      });
      const res = await POST(req);
      expect(res.status).toBe(201);

      const data = await parseResponse<{ <entity>: { Id: number } }>(res);
      expect(data.<entity>.Id).toBeGreaterThan(0);
    });

    it('returns 400 for missing required fields', async () => {
      const req = createRequest('http://localhost:3000/api/<entity>', {
        method: 'POST',
        body: {},
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid field type', async () => {
      const req = createRequest('http://localhost:3000/api/<entity>', {
        method: 'POST',
        body: { SomeStringField: 123 }, // number where string expected
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/<entity>', () => {
    it('returns empty list initially', async () => {
      const req = createRequest('http://localhost:3000/api/<entity>');
      const res = await GET(req);
      expect(res.status).toBe(200);

      const data = await parseResponse<{ <entity>s: unknown[]; count: number }>(res);
      expect(data.<entity>s).toEqual([]);
      expect(data.count).toBe(0);
    });
  });

  describe('GET /api/<entity>/[id]', () => {
    it('returns 404 for non-existent id', async () => {
      const req = createRequest('http://localhost:3000/api/<entity>/999999');
      const res = await GET_BY_ID(req, { params: Promise.resolve({ id: '999999' }) });
      expect(res.status).toBe(404);
    });

    it('returns 400 for invalid id format', async () => {
      const req = createRequest('http://localhost:3000/api/<entity>/abc');
      const res = await GET_BY_ID(req, { params: Promise.resolve({ id: 'abc' }) });
      expect(res.status).toBe(400);
    });
  });

  describe('PUT /api/<entity>/[id]', () => {
    it('updates an existing <entity>', async () => {
      // First create
      const createRes = await POST(createRequest('http://localhost:3000/api/<entity>', {
        method: 'POST',
        body: { /* required fields */ },
      }));
      const { <entity> } = await parseResponse<{ <entity>: { Id: number } }>(createRes);

      // Then update
      const req = createRequest(`http://localhost:3000/api/<entity>/${<entity>.Id}`, {
        method: 'PUT',
        body: { /* updated field */ },
      });
      const res = await PUT(req, { params: Promise.resolve({ id: String(<entity>.Id) }) });
      expect(res.status).toBe(200);
    });
  });

  describe('DELETE /api/<entity>/[id]', () => {
    it('deletes an existing <entity>', async () => {
      const createRes = await POST(createRequest('http://localhost:3000/api/<entity>', {
        method: 'POST',
        body: { /* required fields */ },
      }));
      const { <entity> } = await parseResponse<{ <entity>: { Id: number } }>(createRes);

      const req = createRequest(`http://localhost:3000/api/<entity>/${<entity>.Id}`, {
        method: 'DELETE',
      });
      const res = await DELETE(req, { params: Promise.resolve({ id: String(<entity>.Id) }) });
      expect(res.status).toBe(200);
    });

    it('returns 404 when deleting non-existent <entity>', async () => {
      const req = createRequest('http://localhost:3000/api/<entity>/999999', {
        method: 'DELETE',
      });
      const res = await DELETE(req, { params: Promise.resolve({ id: '999999' }) });
      expect(res.status).toBe(404);
    });
  });

  describe('Auth checks', () => {
    it('returns 401 when not authenticated', async () => {
      const { getUserFromRequest } = await import('@/lib/auth/get-user-from-request');
      const { vi } = await import('vitest');
      vi.mocked(getUserFromRequest).mockResolvedValueOnce(null);

      const req = createRequest('http://localhost:3000/api/<entity>');
      const res = await GET(req);
      expect(res.status).toBe(401);
    });
  });
});
```

---

## Unit Test Template

File location: `__tests__/unit/<module>.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { functionUnderTest } from '@/lib/<module>';

describe('<module name>', () => {
  describe('functionUnderTest', () => {
    it('returns expected result for valid input', () => {
      expect(functionUnderTest('validInput')).toBe('expectedOutput');
    });

    it('throws for invalid input', () => {
      expect(() => functionUnderTest(null)).toThrow();
    });

    it('handles edge cases', () => {
      expect(functionUnderTest('')).toBeNull();
    });
  });
});
```

---

## Key Rules

1. **All test data must be fictional** — never use real names, emails, or genealogy data
2. **`describeIf` wraps all integration tests** — auto-skips when no DB
3. **`afterEach(cleanupTestData)`** — always reset DB between tests to ensure isolation
4. **`params` for `[id]` routes** — always pass `{ params: Promise.resolve({ id: '...' }) }`
5. **List response shape** — `{ <entity>s: [...], count: number }`
6. **Single entity shape** — `{ <entity>: { Id: number, ... } }`
7. **Errors** — `{ error: "message" }` with appropriate status code
8. **Don't test the DB directly** — test through the API route handlers

---

## Instructions

When generating tests:
1. Read the target API route file to identify: required fields, validation rules, response shapes
2. Read the corresponding `lib/db/queries/<entity>.ts` to understand what DB operations occur
3. Generate tests covering: happy path, validation failures (400), not found (404), unauthorized (401), access denied (403)
4. Use realistic but obviously fictional test data (e.g., `FirstName: 'Alice'`, `LastName: 'Wonderland'`)
5. If the route has search/filter functionality, test that too
