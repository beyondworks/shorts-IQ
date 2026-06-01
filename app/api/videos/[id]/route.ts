import { StoreNotFoundError, getVisibleVideo } from '../../../../lib/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    return Response.json(await getVisibleVideo(id));
  } catch (error) {
    if (error instanceof StoreNotFoundError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
