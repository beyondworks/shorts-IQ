// 자동 주기 수집 데몬.
// 주기마다 (1) 기존 영상 재수집(/api/sync, 시계열 누적) + (2) 신규 터진 영상 발견(/api/youtube/discover)을 호출한다.
// dev/start 서버(기본 8792)가 떠 있어야 한다. 배포 환경에서는 이 두 엔드포인트를 Vercel Cron으로 호출하면 데몬 없이 같은 동작.
//
// 실행:  node scripts/collector.mjs            (포그라운드, 로그 확인)
//        nohup node scripts/collector.mjs &    (백그라운드 상주)
//
// 쿼터 주의: discover는 키워드당 search ≈ 100 units. 기본값(8키워드×3시간)은 하루 약 6.5K units로
//           YouTube Data API 일일 10K 한도 안에 든다. 키워드 수/주기를 늘릴 때 한도를 재계산할 것.
import { spawn } from 'node:child_process';

const BASE = process.env.COLLECTOR_BASE_URL || 'http://127.0.0.1:8792';
const INTERVAL_HOURS = Number(process.env.COLLECTOR_INTERVAL_HOURS || 3);
const PERIOD_HOURS = Number(process.env.COLLECTOR_PERIOD_HOURS || 168); // 발견 대상 기간(기본 7일)
const KEYWORD_COUNT = Number(process.env.COLLECTOR_KEYWORD_COUNT || 8);
const PER_KEYWORD = Number(process.env.COLLECTOR_PER_KEYWORD || 12);

let round = 0;

const post = async (path, body) => {
  const response = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(`${path} → ${response.status} ${response.statusText}`);
  return response.json();
};

// 신규 수집 채널이 '채널 평소 대비' baseline을 받도록 주기 갱신. incremental이라 새 채널만 받아 쿼터 저렴.
const refreshChannelBaselines = () => new Promise((resolve) => {
  const child = spawn('node', ['--env-file=.env.local', 'scripts/backfill-channel-baselines.mjs'], { stdio: 'inherit' });
  child.on('exit', () => resolve());
  child.on('error', (error) => { console.error(`baseline refresh 실패: ${error.message}`); resolve(); });
});

const cycle = async () => {
  const stamp = new Date().toISOString();
  try {
    // 1) 추적 영상 재수집 (조회수 갱신 + 시계열 누적 → velocity/추세 실측화)
    const synced = await post('/api/sync');
    // 2) 신규 발견 — 키워드 묶음을 매 라운드 회전시켜 시드 풀 전체를 점진 커버
    const offset = round * KEYWORD_COUNT;
    const discovered = await post('/api/youtube/discover', {
      periodHours: PERIOD_HOURS,
      keywordCount: KEYWORD_COUNT,
      perKeyword: PER_KEYWORD,
      includePopular: true,
      offset,
    });
    const warnings = (discovered.warnings ?? []).length;
    console.log(`[${stamp}] round ${round}: resampled=${synced.resampled ?? 0} discovered=${discovered.discovered ?? 0} total=${(discovered.videos ?? []).length}${warnings ? ` warnings=${warnings}` : ''}`);
    // 3) 신규 채널 baseline 갱신 (incremental — 이미 신선한 채널은 건너뛰어 쿼터 0)
    await refreshChannelBaselines();
    round += 1;
  } catch (error) {
    console.error(`[${stamp}] cycle failed: ${error.message}`);
  }
};

console.log(`collector started → ${BASE} | every ${INTERVAL_HOURS}h · period ${PERIOD_HOURS}h · ${KEYWORD_COUNT} keywords/round`);
await cycle();
setInterval(cycle, INTERVAL_HOURS * 3600 * 1000);
