import { readJsonObject } from '@/lib/api/read-json';
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { listTreesService, createTreeService } from '@/lib/services/trees';
import { handleApiError } from '@/lib/api/handle-error';

export async function GET(_request: NextRequest) {
  try {
    const user = await getUserFromRequest();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const trees = await listTreesService(user.id);
    return NextResponse.json({ trees, count: trees.length });
  } catch (error) {
    return handleApiError(error, 'Failed to fetch trees');
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getUserFromRequest();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await readJsonObject(request);
    const tree = await createTreeService({ name: body.name, currentUserId: user.id });
    return NextResponse.json({ tree }, { status: 201 });
  } catch (error) {
    return handleApiError(error, 'Failed to create tree');
  }
}
