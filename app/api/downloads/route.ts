import { StoreInputError, StoreNotFoundError, createDownload, listDownloads, updateDownloadStatus } from '../../../lib/store';
import type { DownloadClip } from '../../../lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const downloads = await listDownloads();

  return Response.json({
    downloads,
    total: downloads.length,
  });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { endSec?: number; policyAccepted?: boolean; startSec?: number; videoId?: string };
  if (!body.videoId) return Response.json({ error: 'videoId is required' }, { status: 400 });

  try {
    return Response.json(await createDownload(body.videoId, Number(body.startSec), Number(body.endSec), body.policyAccepted === true));
  } catch (error) {
    if (error instanceof StoreInputError || error instanceof StoreNotFoundError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => ({})) as {
    clipId?: string;
    error?: string;
    outputPath?: string;
    status?: DownloadClip['status'];
  };
  if (!body.clipId) return Response.json({ error: 'clipId is required' }, { status: 400 });
  if (!body.status) return Response.json({ error: 'status is required' }, { status: 400 });

  try {
    return Response.json(await updateDownloadStatus(body.clipId, body.status, body.outputPath, body.error));
  } catch (error) {
    if (error instanceof StoreInputError || error instanceof StoreNotFoundError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
