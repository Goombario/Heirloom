import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Every `[id]` route must reject a malformed path id with a 400 before it
// reaches a service or SQL (#955). Services and queries are automocked, so a
// handler that let a bad id through would not answer 400.
const { getUserFromRequest } = vi.hoisted(() => ({ getUserFromRequest: vi.fn() }));
vi.mock('@/lib/auth/get-user-from-request', () => ({ getUserFromRequest }));
vi.mock('@/lib/services/cases');
vi.mock('@/lib/services/citations');
vi.mock('@/lib/services/events');
vi.mock('@/lib/services/families');
vi.mock('@/lib/services/media');
vi.mock('@/lib/services/owner-links');
vi.mock('@/lib/services/people');
vi.mock('@/lib/services/repositories');
vi.mock('@/lib/services/sources');
vi.mock('@/lib/db/queries/cases');
vi.mock('@/lib/db/queries/events');
vi.mock('@/lib/db/queries/media');
vi.mock('@/lib/db/queries/trees');

import * as cases from '@/app/api/cases/[id]/route';
import * as caseComments from '@/app/api/cases/[id]/comments/route';
import * as caseMedia from '@/app/api/cases/[id]/media/route';
import * as caseMediaLibrary from '@/app/api/cases/[id]/media/library/route';
import * as caseMediaItem from '@/app/api/cases/[id]/media/[mediaId]/route';
import * as citations from '@/app/api/citations/[id]/route';
import * as events from '@/app/api/events/[id]/route';
import * as families from '@/app/api/families/[id]/route';
import * as familyChildren from '@/app/api/families/[id]/children/route';
import * as familyChildMove from '@/app/api/families/[id]/children/move/route';
import * as mediaFile from '@/app/api/media/[id]/file/route';
import * as mediaTags from '@/app/api/media/[id]/tags/route';
import * as mediaTag from '@/app/api/media/[id]/tags/[tagId]/route';
import * as people from '@/app/api/people/[id]/route';
import * as personEvents from '@/app/api/people/[id]/events/route';
import * as descendantCount from '@/app/api/people/[id]/descendant-count/route';
import * as nameVariants from '@/app/api/people/[id]/name-variants/route';
import * as nameVariant from '@/app/api/people/[id]/name-variants/[variantId]/route';
import * as repositories from '@/app/api/repositories/[id]/route';
import * as repositorySources from '@/app/api/repositories/[id]/sources/route';
import * as sources from '@/app/api/sources/[id]/route';
import * as citedBy from '@/app/api/sources/[id]/cited-by/route';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- each route types its own params
type Handler = (req: NextRequest, ctx: any) => Promise<Response>;
type RouteModule = Partial<Record<'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', Handler>>;

// [name, module, the other path params besides the one under test]
const ROUTES: Array<[string, RouteModule, Record<string, string>]> = [
    ['cases/[id]', cases, {}],
    ['cases/[id]/comments', caseComments, {}],
    ['cases/[id]/media', caseMedia, {}],
    ['cases/[id]/media/library', caseMediaLibrary, {}],
    ['cases/[id]/media/[mediaId]', caseMediaItem, { mediaId: '1' }],
    ['citations/[id]', citations, {}],
    ['events/[id]', events, {}],
    ['families/[id]', families, {}],
    ['families/[id]/children', familyChildren, {}],
    ['families/[id]/children/move', familyChildMove, {}],
    ['media/[id]/file', mediaFile, {}],
    ['media/[id]/tags', mediaTags, {}],
    ['media/[id]/tags/[tagId]', mediaTag, { tagId: '1' }],
    ['people/[id]', people, {}],
    ['people/[id]/events', personEvents, {}],
    ['people/[id]/descendant-count', descendantCount, {}],
    ['people/[id]/name-variants', nameVariants, {}],
    ['people/[id]/name-variants/[variantId]', nameVariant, { variantId: '1' }],
    ['repositories/[id]', repositories, {}],
    ['repositories/[id]/sources', repositorySources, {}],
    ['sources/[id]', sources, {}],
    ['sources/[id]/cited-by', citedBy, {}],
];

const BAD_IDS = ['abc', '12abc', '1.5', '99999999999'];
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

const CASES = ROUTES.flatMap(([name, mod, rest]) =>
    METHODS.filter((m) => mod[m]).flatMap((method) => BAD_IDS.map((bad) => ({ name, mod, rest, method, bad }))),
);

function request(method: string): NextRequest {
    const init = method === 'GET' ? { method } : { method, body: JSON.stringify({ childId: 1, toFamilyId: 2 }) };
    return new NextRequest('http://localhost/api/x?treeId=1', init);
}

describe('API path id params (#955)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getUserFromRequest.mockResolvedValue({ id: 1 });
    });

    it.each(CASES)('$method $name rejects id "$bad" with 400', async ({ mod, rest, method, bad }) => {
        const res = await mod[method]!(request(method), { params: Promise.resolve({ id: bad, ...rest }) });
        expect(res.status).toBe(400);
    });

    it.each(ROUTES.filter(([, , rest]) => Object.keys(rest).length > 0))(
        '%s rejects a bad second id with 400',
        async (_name, mod, rest) => {
            const key = Object.keys(rest)[0];
            for (const method of METHODS.filter((m) => mod[m])) {
                const res = await mod[method]!(request(method), { params: Promise.resolve({ id: '1', [key]: '12abc' }) });
                expect(res.status).toBe(400);
            }
        },
    );
});
