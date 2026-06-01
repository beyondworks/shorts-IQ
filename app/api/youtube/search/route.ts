import { dryRunYoutubeImport, importYoutubeShortsWithFallback } from '../../../../lib/youtube';
import { StoreInputError, StoreNotFoundError } from '../../../../lib/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as {
    category?: string;
    dryRun?: boolean;
    language?: string;
    maxResults?: number;
    order?: string;
    publishedAfter?: string;
    publishedBefore?: string;
    query?: string;
    regionCode?: string;
    template?: string;
  };

  try {
    if (body.dryRun === true) return Response.json({ dryRun: true, plan: dryRunYoutubeImport(body) });
    return Response.json(await importYoutubeShortsWithFallback(body));
  } catch (error) {
    if (error instanceof StoreInputError || error instanceof StoreNotFoundError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
