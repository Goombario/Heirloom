import { NextRequest } from 'next/server';
import { workspaceRoute } from '@/lib/api/case-workspace-route';
import { closeCaseService, getCaseChangesService } from '@/lib/services/case-workspace';

type Params = { params: Promise<{ id: string }> };

/** GET /api/cases/[id]/close — what Answer and close would change in the tree (#58). */
export async function GET(request: NextRequest, { params }: Params) {
    return workspaceRoute(request, params, null, async (p) => ({ changes: await getCaseChangesService(p) }), { read: true, failure: 'Failed to fetch the changes' });
}

/** POST /api/cases/[id]/close — `conclusion`, `outcome`, and `apply`: the claims to put into the tree (#58). */
export async function POST(request: NextRequest, { params }: Params) {
    return workspaceRoute(request, params, null, (p) => closeCaseService(p), { failure: 'Failed to close the case' });
}
