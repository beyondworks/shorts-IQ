import { createDownloadProcessPlan, processDownloadClip } from '../../../../lib/downloader';
import { StoreInputError, StoreNotFoundError } from '../../../../lib/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { clipId?: string; dryRun?: boolean };
  if (!body.clipId) return Response.json({ error: 'clipId is required' }, { status: 400 });

  try {
    if (body.dryRun === true) {
      const plan = await createDownloadProcessPlan(body.clipId);
      return Response.json({ dryRun: true, plan });
    }
    return Response.json(await processDownloadClip(body.clipId));
  } catch (error) {
    if (error instanceof StoreInputError || error instanceof StoreNotFoundError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
