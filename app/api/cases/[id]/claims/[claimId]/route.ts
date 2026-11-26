import { NextRequest } from 'next/server';
import { workspaceRoute } from '@/lib/api/case-workspace-route';
import { decideClaimService } from '@/lib/services/case-workspace';

type Params = { params: Promise<{ id: string; claimId: string }> };

/** PATCH /api/cases/[id]/claims/[claimId] — `decision`: accepted, rejected or undecided (#58). */
export async function PATCH(request: NextRequest, { params }: Params) {
    return workspaceRoute(request, params, 'claimId', (p) => decideClaimService({ ...p, claimId: p.childId }), { failure: 'Failed to decide claim' });
}
