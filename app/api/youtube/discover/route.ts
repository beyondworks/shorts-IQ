import { discoverBreakoutsWithFallback } from '../../../../lib/youtube';
import { StoreInputError, StoreNotFoundError } from '../../../../lib/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// 대량 '터진 영상 발견' 수집 엔드포인트. 시드 키워드 순회 + 인기차트를 병합해 한 번에 모은다.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as {
    regionCode?: string;
    language?: string;
    keywords?: string[];
    keywordCount?: number;
    perKeyword?: number;
    periodHours?: number;
    includePopular?: boolean;
    offset?: number;
  };

  try {
    return Response.json(await discoverBreakoutsWithFallback(body));
  } catch (error) {
    if (error instanceof StoreInputError || error instanceof StoreNotFoundError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
