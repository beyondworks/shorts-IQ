import type { BreakoutSignal, VideoItem } from './types';

export type ScoreWindow = '24 hours' | '1st 7 days' | '1st 28 days' | 'All';

export const scoreWindows: ScoreWindow[] = ['24 hours', '1st 7 days', '1st 28 days', 'All'];

export const durationSeconds = (duration: string) => {
  const [minutes, seconds] = duration.split(':').map(Number);
  return minutes * 60 + seconds;
};

export const uploadedHours = (uploaded: string) => uploaded.includes('m')
  ? Number(uploaded.match(/(\d+)/)?.[1] ?? 0) / 60
  : uploaded.includes('h')
    ? Number(uploaded.match(/(\d+)/)?.[1] ?? 0)
    : Number(uploaded.match(/(\d+)/)?.[1] ?? 1) * 24;

// 영상 나이(시간): publishedAt 실측 우선, 없으면 저장된 uploaded 라벨 파싱.
// publishedAt 기반이라 시간이 지나도 정확하다(수집 시점 고정값 'Nh ago' 문제 해소).
export const ageHours = (video: VideoItem): number => {
  if (video.publishedAt) {
    const hours = (Date.now() - Date.parse(video.publishedAt)) / 36e5;
    if (Number.isFinite(hours) && hours >= 0) return hours;
  }
  return uploadedHours(video.uploaded);
};

export const pct = (value: string) => Number(value.replace('%', ''));

// 실측 댓글 수 우선, 없으면(seed 등) 조회수 기반 추정.
export const commentsScore = (video: VideoItem) => video.commentCount ?? Math.round(video.viewCount * 0.003);

// 공유 수는 YouTube이 공개하지 않음 → 좋아요(실측) 또는 조회수 기반 추정값(estimate).
export const shareScore = (video: VideoItem) => Math.round((video.likeCount ?? video.viewCount * 0.02) * 0.12 * (video.template.includes('Challenge') || video.template.includes('Caption') ? 1.4 : 1));

export const velocityNumber = (video: VideoItem) => Number(video.velocity.replace('+', '').replace('K/h', '')) * 1000;

// 한국식 숫자 포맷: 1억+→"N.N억", 1만~9999만→"N만"(10만+는 정수, 미만은 소수1자리), 1000~9999→콤마, 미만→그대로.
export const formatCompact = (value: number) => {
  if (value >= 100000000) return `${(value / 100000000).toFixed(1)}억`;
  if (value >= 10000) {
    const man = value / 10000;
    return man >= 10 ? `${Math.round(man).toLocaleString('ko-KR')}만` : `${man.toFixed(1)}만`;
  }
  if (value >= 1000) return value.toLocaleString('ko-KR');
  return String(Math.round(value));
};

// 실측 viewsHistory 샘플 차분으로 시간당 조회수 증가를 계산. 샘플 1개면 누적/연령 fallback.
export const measuredVelocity = (video: VideoItem): { perHour: number; measured: boolean } => {
  const samples = (video.viewsHistory ?? [])
    .map((sample) => ({ t: Date.parse(sample.at), v: sample.views }))
    .filter((sample) => Number.isFinite(sample.t) && Number.isFinite(sample.v))
    .sort((a, b) => a.t - b.t);
  if (samples.length >= 2) {
    const first = samples[0];
    const last = samples[samples.length - 1];
    const hours = Math.max((last.t - first.t) / 36e5, 1 / 60);
    return { perHour: Math.max(0, Math.round((last.v - first.v) / hours)), measured: true };
  }
  const age = Math.max(ageHours(video), .5);
  return { perHour: Math.round(video.viewCount / age), measured: false };
};

const ageBucket = (video: VideoItem) => {
  const hours = ageHours(video);
  if (hours < 24) return '24h';
  if (hours < 168) return '7d';
  if (hours < 720) return '30d';
  return 'old';
};

// peer-group baseline: 같은 카테고리 + 같은 연령대의 '평소' 조회수 중앙값.
// 표본 하한 8 — 너무 적으면(sparse) 중앙값이 불안정해 허수 배율(1857× 같은)이 나오므로 정직하게 null.
// 연령대는 절대 버리지 않는다: 신선 영상을 old 누적과 비교하면 outlier가 구조적으로 0이 돼
// 진짜 신선 breakout을 죽인다(North Star "지금 기대 대비" 위반). sparse면 outlier=null로 두고 VSR이 발견을 맡는다.
const MIN_PEERS = 8;
const median = (sorted: number[]): number => {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
export const computeBaseline = (videos: VideoItem[], target: VideoItem): number | null => {
  const bucket = ageBucket(target);
  const peerViews = videos
    .filter((video) => video.category === target.category && ageBucket(video) === bucket)
    .map((video) => video.viewCount)
    .sort((a, b) => a - b);
  if (peerViews.length < MIN_PEERS) return null;
  return median(peerViews);
};

// ---- '터진 영상(Breakout)' 신호 ----
// 핵심 질문: "이 영상이 '원래 큰 채널/오래된 누적'이라서가 아니라, 지금 기대 대비 비정상적으로 터졌는가?"
// 세 축을 결합한다 (중요도 가중 — 업계 검증 우선순위 반영):
//   1) peer-group(같은 카테고리·연령대) 중앙값 대비 outlier — '이 니치 평소 대비 몇 배' (1순위)
//   2) 구독자 대비 조회수 배율(VSR) — 휴면·구매·비공개 구독자 탓에 노이즈가 커 2순위로 강등
//   3) 신선도 가중 시간당 조회수 (오래된 누적 대형 영상의 점수를 눌러 '지금' 터진 걸 띄움)
// 사용 가능한 축만 가중 결합하고(없으면 재정규화), 절대 억지 숫자를 만들지 않는다(정직성).
const SUBSCRIBER_FLOOR = 2000; // 초소형/미상 채널 분모 하한 — 배율 폭주 방지

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const clamp = (value: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, value));

export const breakoutSignal = (video: VideoItem, peers: VideoItem[]): BreakoutSignal => {
  const videoAge = Math.max(ageHours(video), 0.5);
  const freshVph = Math.round(video.viewCount / videoAge);

  // 1) 구독자 대비 배율 — log10 스케일 (×3≈주목, ×30≈급상승, ×300+≈폭발). 10^2.5≈316배에서 만점.
  const sub = video.subscriberCount;
  const subscriberMultiple = sub != null && sub > 0 ? video.viewCount / Math.max(sub, SUBSCRIBER_FLOOR) : null;
  const subScore = subscriberMultiple != null ? clamp01(Math.log10(Math.max(subscriberMultiple, 0.1)) / 2.5) : null;

  // 2) peer 대비 outlier — log10 (×2≈주목, ×8≈급상승, ×30+≈폭발). 10^1.5≈31배에서 만점.
  //    또래보다 '덜 본' 영상(<1배)은 더 가파른 음성(÷0.6)으로 눌러 velocity가 못 떠받치게(정직성).
  const baseline = computeBaseline(peers, video);
  // 배율 상한 100× — 업계(1of10 등)도 실제 outlier를 6~100×로 본다. 그 이상은 baseline artifact라 신뢰 불가.
  const outlier = baseline && baseline > 0 ? Math.min(video.viewCount / baseline, 100) : null;
  const outRaw = outlier != null ? Math.log10(Math.max(outlier, 0.01)) : null;
  const rawOutScore = outRaw == null ? null : outRaw >= 0 ? clamp(outRaw / 1.5, 0, 1) : clamp(outRaw / 0.6, -1, 0);
  // outlier-VSR 충돌 처리: 또래 평균엔 못 미쳐도(음수) 구독 대비 폭발(VSR≥30)한 '최근(30일 내)' 작은 채널은
  // 음수 페널티로 죽이지 않는다 — North Star 1차 신호(구독자 대비 배율) 보호. 단 0(중립)까지만, 가산 금지(과인증 방지).
  // 연령 게이트(<30일=이번달 창): 수년 된 영상의 VSR은 누적이라 '지금 터짐'이 아니므로 rescue 제외(Steady 유지).
  // 노이즈(비정상 초소형 구독)는 SUBSCRIBER_FLOOR가 분모를 막아 차단.
  const outScore = rawOutScore != null && rawOutScore < 0 && videoAge < 720 && subscriberMultiple != null && subscriberMultiple >= 30
    ? 0
    : rawOutScore;

  // 3) 신선 속도 — 시간당 조회수 log (10만 vph에서 만점) + 신선도 계수
  const velScore = clamp01(Math.log10(Math.max(freshVph, 1)) / 5);
  // 신선도: 기간은 탭(지금/이번주/이번달)이 거르므로 점수는 기간 중립적이어야 한다.
  // 0~30일 터짐은 거의 안 누르고(이번주/이번달도 유효한 벤치마크), 1년+ 누적 대형만 완만히 할인.
  const freshness = videoAge < 24 ? 1 : videoAge < 168 ? 0.95 : videoAge < 720 ? 0.85 : videoAge < 2160 ? 0.6 : videoAge < 8760 ? 0.4 : 0.25;

  // 가중(고정): outlier 1순위 0.45, VSR 2순위 0.25, velocity 보조 0.30.
  // 비대칭 흡수 — velocity(절대 인기)는 절대 흡수 안 함(항상 0.30). 빠진 '기대-대비' 가중은 1순위 outlier로만:
  //  · outlier 있고 VSR 없음 → VSR 가중을 outlier로 흡수(구독자 데이터 부재가 진짜 터짐을 깎지 않게).
  //  · outlier 없음 → 흡수 없음. VSR 0.25·velocity 0.30만 → 상한 ≤0.55(최대 Surging).
  //  · 둘 다 없음 → velScore·0.30 ≤ 0.30(최대 Steady). 절대 인기만으론 '폭발' 불가(North Star).
  // velocity가 절대 흡수 안 하므로 score와 grade가 같은 제약 공유 → 사후 등급 캡 불필요(점수-등급 일치).
  const W_OUT = 0.45, W_SUB = 0.25, W_VEL = 0.3;
  let blended = velScore * W_VEL;
  if (outScore != null) blended += outScore * (subScore != null ? W_OUT : W_OUT + W_SUB);
  if (subScore != null) blended += subScore * W_SUB;

  // 신뢰도는 축 '개수'가 아니라 '질': 1순위 outlier(또래 대비 실측)가 있으면 high,
  // 없고 VSR(노이즈 큰 2순위)만 있으면 medium, 둘 다 없으면 velocity(절대 인기)만 → low.
  const confidence: BreakoutSignal['confidence'] = outScore != null ? 'high' : subScore != null ? 'medium' : 'low';

  // 신선도 영향을 강화: '지금 터진' 영상을 띄우고, 과거에 터진 누적 대형 영상은 누른다.
  // (특정 기간만 보려면 기간 필터로 정밀 제어 — 기본 랭킹은 최근 쪽으로 기운다.)
  // 신선도는 점수를 전역으로 짓누르는 승수가 아니라 완만한 할인(0.6~1.0)으로만 — 과거 터짐 보존.
  const score = Math.round(clamp01(blended * (0.6 + 0.4 * freshness)) * 100);
  const grade: BreakoutSignal['grade'] = score >= 70 ? 'Breakout' : score >= 52 ? 'Surging' : score >= 34 ? 'Notable' : 'Steady';

  return {
    score,
    grade,
    subscriberMultiple,
    outlier,
    freshVph,
    ageHours: videoAge,
    confidence,
    measured: { subscriberMultiple: subScore != null, outlier: outScore != null },
  };
};

// 전체 목록에 breakout 신호를 한 번 부여한다. peer baseline은 같은 목록 내에서 계산.
export const attachBreakout = (videos: VideoItem[]): VideoItem[] =>
  videos.map((video) => ({ ...video, breakout: breakoutSignal(video, videos) }));

export const vidiqMetrics = (video: VideoItem, baseline?: number | null) => {
  const age = Math.max(ageHours(video), .5);
  const vph = Math.round(video.viewCount / age);
  const vel = measuredVelocity(video);

  // outlier: peer-group 중앙값 대비 배수. baseline 없으면 데이터 부족 → null (억지 숫자 금지).
  const outlier = baseline && baseline > 0 ? Math.max(0.2, Math.min(50, video.viewCount / baseline)) : null;

  // engagement: 실측 like/comment rate 우선. 둘 다 없으면 추정(retention/saveRate) proxy.
  const likeRate = video.likeCount != null && video.viewCount > 0 ? video.likeCount / video.viewCount : null;
  const commentRate = video.commentCount != null && video.viewCount > 0 ? video.commentCount / video.viewCount : null;
  const engagementMeasured = likeRate != null || commentRate != null;
  const engagement = engagementMeasured
    ? Math.round(Math.min(100, (likeRate ?? 0) * 1400 + (commentRate ?? 0) * 6000))
    : Math.round(Math.min(100, (pct(video.retention) * .52) + (pct(video.saveRate) * 2.2)));

  const outlierFactor = outlier ?? 1.5;
  const score = Math.min(100, Math.round(45 + outlierFactor * 8 + engagement * .3 + Math.min(12, vel.perHour / 8000)));
  const grade = score >= 86 ? 'Viral' : score >= 72 ? 'Strong' : score >= 58 ? 'Rising' : 'Watch';
  return {
    score,
    grade,
    vph,
    velocity: vel.perHour,
    outlier: outlier != null ? outlier.toFixed(1) : null,
    comments: commentsScore(video),
    shares: shareScore(video),
    engagement,
    measured: { velocity: vel.measured, engagement: engagementMeasured, outlier: outlier != null },
  };
};

export const scorecardCurve = (video: VideoItem, window: ScoreWindow) => {
  const historyCurve = scorecardHistoryCurve(video, window);
  if (historyCurve) return historyCurve;

  const maxViews = Math.max(video.viewCount, 1000);
  const plateau = window === '24 hours' ? Math.min(maxViews, Math.round(velocityNumber(video) * 24)) : maxViews;
  const steepness = window === 'All' ? .42 : window === '1st 28 days' ? .34 : window === '1st 7 days' ? .28 : .22;
  const points = Array.from({ length: 18 }, (_, i) => {
    const t = i / 17;
    const earlySpike = 1 - Math.exp(-(t * 10) / Math.max(.18, steepness));
    const slowTail = .08 * Math.log1p(t * (window === 'All' ? 8 : 3));
    const ratio = Math.min(1, earlySpike * .92 + slowTail);
    const x = 14 + t * 252;
    const y = 126 - ratio * 92;
    return { x, y, value: Math.round(plateau * ratio) };
  });
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const fill = `${path} L266 132 L14 132 Z`;
  const yMax = Math.ceil(maxViews / 1000000) * 1000000 || 1000000;
  const labels = window === '24 hours' ? ['0h', '6h', '12h', '18h', '24h'] : window === '1st 7 days' ? ['0', 'D2', 'D4', 'D6', 'D7'] : window === '1st 28 days' ? ['0', 'D7', 'D14', 'D21', 'D28'] : ['0', '8/23/25', '9/29/25', '1/1/26', '5/31/26'];
  return { path, fill, labels, yMax };
};

const scorecardHistoryCurve = (video: VideoItem, window: ScoreWindow) => {
  const samples = normalizedHistory(video, window);
  if (samples.length < 2) return null;

  const firstTime = samples[0].time;
  const lastTime = samples[samples.length - 1].time;
  const range = Math.max(lastTime - firstTime, 1);
  const maxViews = Math.max(video.viewCount, ...samples.map((sample) => sample.views), 1000);
  const points = Array.from({ length: 18 }, (_, index) => {
    const ratio = index / 17;
    const targetTime = firstTime + range * ratio;
    const value = interpolateViews(samples, targetTime);
    const x = 14 + ratio * 252;
    const y = 126 - (value / maxViews) * 92;
    return { x, y, value: Math.round(value) };
  });

  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
  const fill = `${path} L266 132 L14 132 Z`;
  const yMax = Math.ceil(maxViews / 1000000) * 1000000 || 1000000;
  return { path, fill, labels: historyLabels(window, firstTime, lastTime), yMax };
};

const normalizedHistory = (video: VideoItem, window: ScoreWindow) => {
  const publishedTime = video.publishedAt ? Date.parse(video.publishedAt) : NaN;
  const rawSamples = (video.viewsHistory ?? [])
    .map((sample) => ({ time: Date.parse(sample.at), views: sample.views }))
    .filter((sample) => Number.isFinite(sample.time) && Number.isFinite(sample.views))
    .sort((a, b) => a.time - b.time);

  if (rawSamples.length === 0) return [];

  const lastTime = rawSamples[rawSamples.length - 1].time;
  const windowMs = scoreWindowMs(window);
  const startTime = Number.isFinite(publishedTime) ? publishedTime : lastTime - windowMs;
  const minTime = window === 'All' ? startTime : Math.max(startTime, lastTime - windowMs);
  const samples = rawSamples.filter((sample) => sample.time >= minTime && sample.time <= lastTime);

  if (samples.length === 0) return [];

  const leading = samples[0].time > minTime
    ? [{ time: minTime, views: minTime <= startTime ? 0 : samples[0].views }]
    : [];
  return [...leading, ...samples];
};

const interpolateViews = (samples: { time: number; views: number }[], targetTime: number) => {
  const nextIndex = samples.findIndex((sample) => sample.time >= targetTime);
  if (nextIndex <= 0) return samples[0].views;
  const previous = samples[nextIndex - 1];
  const next = samples[nextIndex];
  if (!next) return samples[samples.length - 1].views;
  const span = Math.max(next.time - previous.time, 1);
  const ratio = (targetTime - previous.time) / span;
  return previous.views + (next.views - previous.views) * ratio;
};

const scoreWindowMs = (window: ScoreWindow) => {
  if (window === '24 hours') return 24 * 60 * 60 * 1000;
  if (window === '1st 7 days') return 7 * 24 * 60 * 60 * 1000;
  if (window === '1st 28 days') return 28 * 24 * 60 * 60 * 1000;
  return 365 * 24 * 60 * 60 * 1000;
};

const historyLabels = (window: ScoreWindow, firstTime: number, lastTime: number) => {
  if (window === '24 hours') return ['0h', '6h', '12h', '18h', '24h'];
  if (window === '1st 7 days') return ['0', 'D2', 'D4', 'D6', 'D7'];
  if (window === '1st 28 days') return ['0', 'D7', 'D14', 'D21', 'D28'];

  const formatter = new Intl.DateTimeFormat('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' });
  return Array.from({ length: 5 }, (_, index) => formatter.format(new Date(firstTime + ((lastTime - firstTime) * index) / 4)));
};
