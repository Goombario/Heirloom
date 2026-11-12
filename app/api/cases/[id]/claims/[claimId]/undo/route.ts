import { NextRequest } from 'next/server';
import { workspaceRoute } from '@/lib/api/case-workspace-route';
import { undoAppliedClaimService } from '@/lib/services/case-workspace';

type Params = { params: Promise<{ id: string; claimId: string }> };

/** POST /api/cases/[id]/claims/[claimId]/undo — put back what Answer and close changed for the claim (#58). */
export async function POST(request: NextRequest, { params }: Params) {
    return workspaceRoute(request, params, 'claimId', (p) => undoAppliedClaimService({ ...p, claimId: p.childId }), { failure: 'Failed to undo the change' });
}
