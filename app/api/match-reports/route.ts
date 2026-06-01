import { StoreNotFoundError, createMatchReport, listMatchReports } from '../../../lib/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const reports = await listMatchReports();

  return Response.json({
    reports,
    total: reports.length,
  });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as {
    remakeNotes?: string;
    remakeTitle?: string;
    remakeUrl?: string;
    sourceVideoId?: string;
    sourceTitle?: string;
    sourceUrl?: string;
    videoId?: string;
  };

  try {
    return Response.json(await createMatchReport(body));
  } catch (error) {
    if (error instanceof StoreNotFoundError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
