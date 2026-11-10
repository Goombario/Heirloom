import { NextRequest, NextResponse } from 'next/server';
import { generateSpreadsheetTemplate } from '@/lib/spreadsheet/template';
import { getUserFromRequest } from '@/lib/auth/get-user-from-request';

export async function GET(request: NextRequest) {
    const user = await getUserFromRequest();
    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const rawFormat = searchParams.get('dateFormat');
    const slashOrder: 'MDY' | 'DMY' = rawFormat === 'DMY' ? 'DMY' : 'MDY';

    const buffer = await generateSpreadsheetTemplate(slashOrder);

    return new NextResponse(new Uint8Array(buffer), {
        status: 200,
        headers: {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': 'attachment; filename="genealogy_template.xlsx"',
            'Content-Length': String(buffer.length),
        },
    });
}
