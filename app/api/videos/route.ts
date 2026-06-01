import { listVideos, type VideoQuery } from '../../../lib/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = queryFromSearchParams(url.searchParams);
  const videos = await listVideos(query);

  return Response.json({
    videos,
    total: videos.length,
    query,
  });
}

const queryFromSearchParams = (params: URLSearchParams): VideoQuery => ({
  category: params.get('category') ?? undefined,
  duration: params.get('duration') ?? undefined,
  language: params.get('language') ?? undefined,
  maxSubscribers: params.get('maxSubscribers') ?? undefined,
  minSubscribers: params.get('minSubscribers') ?? undefined,
  q: params.get('q') ?? undefined,
  query: params.get('query') ?? undefined,
  sort: params.get('sort') ?? undefined,
  template: params.get('template') ?? undefined,
  uploaded: params.get('uploaded') ?? undefined,
  views: params.get('views') ?? undefined,
});
