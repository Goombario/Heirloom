import { NextRequest } from 'next/server';
import { workspaceRoute } from '@/lib/api/case-workspace-route';
import { addLeadService } from '@/lib/services/case-workspace';

type Params = { params: Promise<{ id: string }> };

/** POST /api/cases/[id]/leads — add a lead: `question`, `fromYear`, `toYear`, `personIds` (#58). */
export async function POST(request: NextRequest, { params }: Params) {
    return workspaceRoute(request, params, null, (p) => addLeadService(p), { status: 201, failure: 'Failed to add lead' });
}
