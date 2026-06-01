import { StoreNotFoundError, updateVideoSaved } from '../../../lib/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { videoId?: string };
  if (!body.videoId) return Response.json({ error: 'videoId is required' }, { status: 400 });

  try {
    return Response.json(await updateVideoSaved(body.videoId));
  } catch (error) {
    if (error instanceof StoreNotFoundError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
