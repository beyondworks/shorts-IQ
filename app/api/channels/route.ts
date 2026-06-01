import { listChannels } from '../../../lib/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sort = url.searchParams.get('sort') ?? undefined;
  const channels = await listChannels(sort);

  return Response.json({
    channels,
    total: channels.length,
    sort,
  });
}
