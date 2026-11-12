import { NextRequest } from 'next/server';
import { workspaceRoute } from '@/lib/api/case-workspace-route';
import { changeLeadService } from '@/lib/services/case-workspace';

type Params = { params: Promise<{ id: string; leadId: string }> };

/** PATCH /api/cases/[id]/leads/[leadId] — `action` edit (with the lead's fields), settle, reopen or drop (#58). */
export async function PATCH(request: NextRequest, { params }: Params) {
    return workspaceRoute(request, params, 'leadId', (p) => changeLeadService({ ...p, leadId: p.childId }), { failure: 'Failed to change lead' });
}
