import { NextRequest } from 'next/server';
import { workspaceRoute } from '@/lib/api/case-workspace-route';
import { addClaimService } from '@/lib/services/case-workspace';

type Params = { params: Promise<{ id: string; findingId: string }> };

/** POST /api/cases/[id]/findings/[findingId]/claims — add a claim to a record (#58). */
export async function POST(request: NextRequest, { params }: Params) {
    return workspaceRoute(request, params, 'findingId', (p) => addClaimService({ ...p, findingId: p.childId }), { status: 201, failure: 'Failed to add claim' });
}
