import { NextRequest } from 'next/server';
import { workspaceRoute } from '@/lib/api/case-workspace-route';
import { addFindingService } from '@/lib/services/case-workspace';

type Params = { params: Promise<{ id: string }> };

/** POST /api/cases/[id]/findings — add a record with its source and claims, or a search that found nothing (#58). */
export async function POST(request: NextRequest, { params }: Params) {
    return workspaceRoute(request, params, null, (p) => addFindingService(p), { status: 201, failure: 'Failed to add finding' });
}
