import { StoreInputError, ingestVideo } from '../../../lib/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as {
    category?: string;
    channel?: string;
    duration?: string;
    hook?: string;
    language?: '한국어' | '영어' | '기타';
    sourceUrl?: string;
    template?: string;
    title?: string;
  };

  try {
    return Response.json(await ingestVideo(body));
  } catch (error) {
    if (error instanceof StoreInputError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
