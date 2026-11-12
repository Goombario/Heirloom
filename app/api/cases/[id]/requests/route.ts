import { NextRequest } from 'next/server';
import { workspaceRoute } from '@/lib/api/case-workspace-route';
import { addRequestService } from '@/lib/services/case-workspace';

type Params = { params: Promise<{ id: string }> };

/** POST /api/cases/[id]/requests — start tracking a record asked for (#58). */
export async function POST(request: NextRequest, { params }: Params) {
    return workspaceRoute(request, params, null, (p) => addRequestService(p), { status: 201, failure: 'Failed to add request' });
}
