import { NextRequest } from 'next/server';
import { workspaceRoute } from '@/lib/api/case-workspace-route';
import { replyToRequestService } from '@/lib/services/case-workspace';

type Params = { params: Promise<{ id: string; requestId: string }> };

/** PATCH /api/cases/[id]/requests/[requestId] — log the reply: `state` and an optional `note` (#58). */
export async function PATCH(request: NextRequest, { params }: Params) {
    return workspaceRoute(request, params, 'requestId', (p) => replyToRequestService({ ...p, requestId: p.childId }), { failure: 'Failed to log reply' });
}
