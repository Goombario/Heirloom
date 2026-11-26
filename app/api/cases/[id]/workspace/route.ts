import { NextRequest } from 'next/server';
import { workspaceRoute } from '@/lib/api/case-workspace-route';
import { getCaseWorkspaceService } from '@/lib/services/case-workspace';

type Params = { params: Promise<{ id: string }> };

/** GET /api/cases/[id]/workspace — the case's leads, findings and requests (#58). */
export async function GET(request: NextRequest, { params }: Params) {
    return workspaceRoute(request, params, null,
        async (p) => ({ workspace: await getCaseWorkspaceService(p) }),
        { read: true, failure: 'Failed to load the research workspace' });
}
