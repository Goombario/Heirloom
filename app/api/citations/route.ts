import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';
import { parseIdParam, parseOptionalIdParam } from '@/lib/utils/parse-id';
import { handleApiError } from '@/lib/api/handle-error';
import { isFactTableValue } from '@/lib/db/fact-tables';
import {
  listCitationsForPersonService,
  listCitationsForFamilyService,
  listCitationsForFactService,
  createCitationService,
} from '@/lib/services/citations';

export async function GET(request: NextRequest) {
  const user = await getUserFromRequest();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const requestedTreeId = parseIdParam(searchParams.get('treeId'));
  const requestedOwnerId = parseIdParam(searchParams.get('ownerId'));
  const factTable = searchParams.get('factTable');
  const factId = searchParams.get('factId');
  const personId = searchParams.get('personId');
  const familyId = searchParams.get('familyId');

  try {
    const factModeRequested = factTable !== null || factId !== null;
    const requestedModes = [personId !== null, familyId !== null, factModeRequested].filter(Boolean).length;
    if (requestedModes !== 1) {
      return NextResponse.json({ error: 'Provide exactly one citation scope: personId, familyId, or factTable with factId' }, { status: 400 });
    }
    const parsedPersonId = parseOptionalIdParam(personId, 'personId');
    if (parsedPersonId !== null) {
      const citationMap = await listCitationsForPersonService({
        personId: parsedPersonId,
        requestedTreeId,
        requestedOwnerId,
        currentUserId: user.id,
      });
      return NextResponse.json({ citationMap });
    }

    const parsedFamilyId = parseOptionalIdParam(familyId, 'familyId');
    if (parsedFamilyId !== null) {
      const citationMap = await listCitationsForFamilyService({
        familyId: parsedFamilyId,
        requestedTreeId,
        requestedOwnerId,
        currentUserId: user.id,
      });
      return NextResponse.json({ citationMap });
    }

    if (!factTable || !factId) {
      return NextResponse.json({ error: 'factTable and factId are required' }, { status: 400 });
    }
    if (!isFactTableValue(factTable)) {
      return NextResponse.json({ error: `Invalid factTable: ${factTable}` }, { status: 400 });
    }
    // factId is known present here (guarded above), so this either parses or 400s.
    const citations = await listCitationsForFactService({
      factTable,
      factId: parseOptionalIdParam(factId, 'factId')!,
      requestedTreeId,
      requestedOwnerId,
      currentUserId: user.id,
    });
    return NextResponse.json({ citations });
  } catch (error) {
    return handleApiError(error, 'Failed to fetch citations');
  }
}

export async function POST(request: NextRequest) {
  const user = await getUserFromRequest();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const requestedTreeId = parseIdParam(searchParams.get('treeId'));
  const requestedOwnerId = parseIdParam(searchParams.get('ownerId'));

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  try {
    const citation = await createCitationService({ input: body, requestedTreeId, requestedOwnerId, currentUserId: user.id });
    return NextResponse.json({ citation }, { status: 201 });
  } catch (error) {
    return handleApiError(error, 'Failed to create citation');
  }
}
