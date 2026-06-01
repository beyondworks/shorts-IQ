import { resampleTrackedVideosWithFallback } from '../../../lib/youtube';
import { StoreInputError } from '../../../lib/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// 실제 Live sync: 추적 중인 영상의 통계를 YouTube에서 재조회해 갱신하고 시계열을 누적한다.
export async function POST() {
  try {
    return Response.json(await resampleTrackedVideosWithFallback());
  } catch (error) {
    if (error instanceof StoreInputError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
