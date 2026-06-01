// 일회 백필: 기존 수집 영상들의 채널별 '평소 조회수 중앙값'(채널-자기 배율 baseline)을 채운다.
// 실행: node --env-file=.env.local scripts/backfill-channel-baselines.mjs
// 쿼터: channels.list(50/콜) + 채널당 playlistItems(1) + videos.list(50/콜) ≈ 채널수 × ~1.3 units.
import { readFileSync, writeFileSync, renameSync } from 'node:fs';

const DATA = './.data/shorts-iq.json';
const RECENT = 15;          // 채널 최근 영상 표본 수
const MIN_SAMPLE = 5;       // 이보다 적으면 baseline 미산출(정직)
const STALE_DAYS = Number(process.env.BASELINE_STALE_DAYS || 7); // 이보다 오래된/없는 baseline만 갱신(incremental)
const key = process.env.SHORTS_IQ_YOUTUBE_API_KEY || process.env.YOUTUBE_DATA_API_KEY || '';
if (!key) { console.error('NO_KEY: SHORTS_IQ_YOUTUBE_API_KEY 또는 YOUTUBE_DATA_API_KEY 필요 (--env-file=.env.local)'); process.exit(1); }

const j = async (url, label) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${label} ${r.status} ${b?.error?.message || ''}`);
  return b;
};
const median = (arr) => { const s = [...arr].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

const raw = JSON.parse(readFileSync(DATA, 'utf8'));
const videos = raw.videos ?? raw;
// incremental: 채널별 가장 최신 baseline 시각을 모아, 없거나 STALE_DAYS 초과한 채널만 갱신 대상으로.
const freshUntil = Date.now() - STALE_DAYS * 864e5;
const latestBaselineAt = new Map();
for (const v of videos) {
  if (!v.channelId) continue;
  const t = v.channelBaselineAt ? Date.parse(v.channelBaselineAt) : 0;
  latestBaselineAt.set(v.channelId, Math.max(latestBaselineAt.get(v.channelId) ?? 0, t || 0));
}
const allChannels = Array.from(new Set(videos.map((v) => v.channelId).filter(Boolean)));
const channelIds = allChannels.filter((id) => (latestBaselineAt.get(id) ?? 0) < freshUntil);
console.log(`전체 채널 ${allChannels.length} | 갱신 대상(없음/${STALE_DAYS}일 초과) ${channelIds.length}개 수집 시작...`);
if (channelIds.length === 0) { console.log('모든 채널 baseline이 신선 — 갱신 불필요.'); process.exit(0); }

// 1) channels.list로 uploads 플레이리스트 ID (50개씩)
const uploads = new Map();
for (let i = 0; i < channelIds.length; i += 50) {
  const chunk = channelIds.slice(i, i + 50);
  try {
    const res = await j(`https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${chunk.join(',')}&key=${key}`, 'channels');
    for (const ch of res.items ?? []) {
      const up = ch.contentDetails?.relatedPlaylists?.uploads;
      if (ch.id && up) uploads.set(ch.id, up);
    }
  } catch (e) { console.error('channels 청크 실패:', e.message); }
}
console.log(`uploads 플레이리스트 확보: ${uploads.size}/${channelIds.length}`);

// 2) 채널별 최근 영상 views 중앙값
const baselines = new Map();
let done = 0, ok = 0;
for (const [channelId, playlistId] of uploads) {
  try {
    const pl = await j(`https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=${RECENT}&playlistId=${playlistId}&key=${key}`, 'playlistItems');
    const ids = (pl.items ?? []).map((i) => i.contentDetails?.videoId).filter(Boolean);
    if (ids.length >= MIN_SAMPLE) {
      const vr = await j(`https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${ids.join(',')}&key=${key}`, 'videos');
      const views = (vr.items ?? []).map((i) => Number(i.statistics?.viewCount ?? 0)).filter((n) => Number.isFinite(n));
      if (views.length >= MIN_SAMPLE) { baselines.set(channelId, { medianViews: median(views), sampleSize: views.length }); ok++; }
    }
  } catch (e) { /* 채널 단위 실패 건너뜀 */ }
  if (++done % 50 === 0) console.log(`  진행 ${done}/${uploads.size} (baseline 산출 ${ok})`);
}
console.log(`baseline 산출 완료: ${baselines.size}개 채널`);

// 3) 쓰기 직전 파일을 다시 읽어(dev 서버가 그 사이 바꿨을 수 있음) 머지 후 atomic write
const at = new Date().toISOString();
const fresh = JSON.parse(readFileSync(DATA, 'utf8'));
const freshVideos = fresh.videos ?? fresh;
let applied = 0;
for (const v of freshVideos) {
  const b = v.channelId && baselines.get(v.channelId);
  if (b) { v.channelMedianViews = b.medianViews; v.channelSampleSize = b.sampleSize; v.channelBaselineAt = at; applied++; }
}
const tmp = DATA + '.tmp';
writeFileSync(tmp, JSON.stringify(fresh, null, 2));
renameSync(tmp, DATA);
console.log(`적용 완료: ${applied}/${freshVideos.length} 영상에 채널 baseline 기록.`);
