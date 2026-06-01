import { backfillPeriodsWithFallback } from '../../../../lib/youtube';
import { StoreInputError, StoreNotFoundError } from '../../../../lib/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// 기간 구간별 대량 백필. 과거 영상은 누적 조회수 확정이라 1회 채우면 충분 — 각 시기의 터진 영상을 골고루 수집한다.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as {
    regionCode?: string;
    language?: string;
    keywordCount?: number;
    perKeyword?: number;
    offset?: number;
    includePopular?: boolean;
  };

  try {
    return Response.json(await backfillPeriodsWithFallback(body));
  } catch (error) {
    if (error instanceof StoreInputError || error instanceof StoreNotFoundError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
