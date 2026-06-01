import { StoreNotFoundError, assignVideoFolder, listFolderCollections } from '../../../lib/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const folderName = searchParams.get('folder') ?? undefined;

  try {
    const folders = await listFolderCollections(folderName);
    return Response.json({
      folders,
      activeFolder: folderName ? folders[0] : folders.find((folder) => folder.count && folder.count > 0) ?? folders[0] ?? null,
    });
  } catch (error) {
    if (error instanceof StoreNotFoundError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { folder?: string; videoId?: string };
  if (!body.videoId) return Response.json({ error: 'videoId is required' }, { status: 400 });
  if (!body.folder) return Response.json({ error: 'folder is required' }, { status: 400 });

  try {
    return Response.json(await assignVideoFolder(body.videoId, body.folder));
  } catch (error) {
    if (error instanceof StoreNotFoundError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
