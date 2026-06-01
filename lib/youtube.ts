import { formatCompact } from './metrics';
import { inferCategory, selectSeedKeywords } from './catalog';
import { readState, StoreInputError, upsertVideos } from './store';
import type { AppState, VideoItem } from './types';

export type YoutubeImportPayload = {
  category?: string;
  dryRun?: boolean;
  language?: string;
  maxResults?: number;
  order?: string;
  publishedAfter?: string;
  publishedBefore?: string;
  query?: string;
  regionCode?: string;
  template?: string;
};

export type YoutubeImportPlan = {
  searchUrl: string;
  videosUrl: string | null;
  query: string;
  maxResults: number;
  order: string;
  regionCode: string;
  relevanceLanguage: string;
};

type YoutubeSearchResponse = {
  items?: {
    id?: { videoId?: string };
    snippet?: {
      channelTitle?: string;
      publishedAt?: string;
      title?: string;
    };
  }[];
  nextPageToken?: string;
};

type YoutubeVideosResponse = {
  items?: YoutubeVideoResource[];
};

type YoutubeVideoResource = {
  id?: string;
  snippet?: {
    channelId?: string;
    channelTitle?: string;
    publishedAt?: string;
    thumbnails?: Record<string, { url?: string }>;
    title?: string;
  };
  statistics?: {
    commentCount?: string;
    likeCount?: string;
    viewCount?: string;
  };
  contentDetails?: {
    duration?: string;
  };
};

const searchEndpoint = 'https://www.googleapis.com/youtube/v3/search';
const videosEndpoint = 'https://www.googleapis.com/youtube/v3/videos';
const channelsEndpoint = 'https://www.googleapis.com/youtube/v3/channels';

type ChannelStats = { subscriberCount?: number; channelPublishedAt?: string };
type YoutubeChannelsResponse = {
  items?: {
    id?: string;
    snippet?: { publishedAt?: string };
    statistics?: { subscriberCount?: string; hiddenSubscriberCount?: boolean };
  }[];
};

export const buildYoutubeImportPlan = (payload: YoutubeImportPayload): YoutubeImportPlan => {
  const query = payload.query?.trim();
  if (!query) throw new StoreInputError('query is required');

  const maxResults = clampMaxResults(payload.maxResults);
  const order = normalizeOrder(payload.order);
  const regionCode = normalizeRegion(payload.regionCode);
  const relevanceLanguage = normalizeRelevanceLanguage(payload.language);
  const key = getApiKey();

  const searchParams = new URLSearchParams({
    part: 'snippet',
    maxResults: String(Math.min(maxResults, 50)), // 페이지당 ≤50 (총량은 페이지네이션으로 plan.maxResults까지)
    order,
    q: query,
    regionCode,
    relevanceLanguage,
    safeSearch: 'moderate',
    type: 'video',
    videoDuration: 'short',
  });
  if (payload.publishedAfter) searchParams.set('publishedAfter', payload.publishedAfter);
  if (payload.publishedBefore) searchParams.set('publishedBefore', payload.publishedBefore);
  if (key) searchParams.set('key', key);

  return {
    searchUrl: `${searchEndpoint}?${searchParams.toString()}`,
    videosUrl: null,
    query,
    maxResults,
    order,
    regionCode,
    relevanceLanguage,
  };
};

export const importYoutubeShorts = async (payload: YoutubeImportPayload): Promise<AppState> => {
  const key = getApiKey();
  if (!key) throw new StoreInputError('YOUTUBE_DATA_API_KEY or SHORTS_IQ_YOUTUBE_API_KEY is required');

  const plan = buildYoutubeImportPlan(payload);
  const ids = await searchVideoIds(plan, key);
  if (ids.length === 0) throw new StoreInputError('No YouTube video results found for query');

  const videos = await idsToVideos(ids, key, payload);
  if (videos.length === 0) throw new StoreInputError('No Shorts-length videos found in YouTube response');
  return upsertVideos(videos);
};

// search.list를 nextPageToken으로 순회해 plan.maxResults까지 videoId를 모은다 (페이지당 ≤50).
const searchVideoIds = async (plan: YoutubeImportPlan, key: string): Promise<string[]> => {
  const ids: string[] = [];
  let pageToken: string | undefined;
  const maxPages = Math.max(1, Math.ceil(plan.maxResults / 50));
  for (let page = 0; page < maxPages; page += 1) {
    const url = pageToken ? `${plan.searchUrl}&pageToken=${encodeURIComponent(pageToken)}` : plan.searchUrl;
    const response = await fetchJson<YoutubeSearchResponse>(url, 'YouTube search');
    for (const item of response.items ?? []) {
      if (item.id?.videoId) ids.push(item.id.videoId);
    }
    pageToken = response.nextPageToken;
    if (!pageToken) break;
  }
  return Array.from(new Set(ids)).slice(0, plan.maxResults);
};

// videoId 목록을 videos.list(50개 청크)로 상세 조회 → Shorts(≤60s)만 VideoItem으로 변환.
const idsToVideos = async (ids: string[], key: string, payload: YoutubeImportPayload): Promise<VideoItem[]> => {
  const unique = Array.from(new Set(ids)).filter(Boolean);
  const resources: YoutubeVideoResource[] = [];
  for (let index = 0; index < unique.length; index += 50) {
    const chunk = unique.slice(index, index + 50);
    const params = new URLSearchParams({ id: chunk.join(','), key, part: 'snippet,statistics,contentDetails' });
    const response = await fetchJson<YoutubeVideosResponse>(`${videosEndpoint}?${params.toString()}`, 'YouTube videos');
    resources.push(...(response.items ?? []));
  }
  const channelStats = await fetchChannelStats(resources, key);
  return resources
    .map((item, index) => youtubeResourceToVideo(item, index, payload, channelStats))
    .filter((video): video is VideoItem => Boolean(video))
    .filter((video) => durationToSeconds(video.duration) <= 60);
};

// 채널 통계(구독자·개설일)를 1회 배치 조회. 실패해도 영상 수집은 계속(부분 degradation).
const fetchChannelStats = async (items: YoutubeVideoResource[], key: string): Promise<Map<string, ChannelStats>> => {
  const channelIds = Array.from(new Set(items.map((item) => item.snippet?.channelId).filter(Boolean) as string[]));
  if (channelIds.length === 0) return new Map();
  const map = new Map<string, ChannelStats>();
  try {
    // channels API도 id 최대 50개 → 청크 처리 (구독자 대비 배율은 breakout 핵심 신호라 누락 최소화).
    for (let index = 0; index < channelIds.length; index += 50) {
      const chunk = channelIds.slice(index, index + 50);
      const params = new URLSearchParams({ id: chunk.join(','), key, part: 'snippet,statistics' });
      const response = await fetchJson<YoutubeChannelsResponse>(`${channelsEndpoint}?${params.toString()}`, 'YouTube channels');
      for (const channel of response.items ?? []) {
        if (!channel.id) continue;
        const subscriberCount = channel.statistics?.hiddenSubscriberCount
          ? undefined
          : Number(channel.statistics?.subscriberCount ?? NaN) || undefined;
        map.set(channel.id, { subscriberCount, channelPublishedAt: channel.snippet?.publishedAt });
      }
    }
    return map;
  } catch {
    // 부분 성공이라도 이미 모은 통계는 유지 (전부 버리지 않는다).
    return map;
  }
};

// 외부 API 실패(키 미설정 제외) 시 마지막 수집한 youtube-api 캐시를 반환하는 graceful fallback.
export const importYoutubeShortsWithFallback = async (
  payload: YoutubeImportPayload,
): Promise<AppState & { degraded?: boolean; degradedReason?: string }> => {
  try {
    return await importYoutubeShorts(payload);
  } catch (error) {
    // 키 미설정은 사용자가 설정해야 하는 사항 — fallback 대상이 아니라 그대로 전파.
    if (error instanceof StoreInputError && /API_KEY|required/i.test(error.message)) throw error;
    // 쿼터 초과·네트워크 실패 등은 마지막 수집 상태를 그대로 보여줘 화면이 비지 않게 한다.
    const cached = await readState();
    return {
      ...cached,
      degraded: true,
      degradedReason: error instanceof Error ? error.message : 'YouTube 수집에 실패했습니다.',
    };
  }
};

export const dryRunYoutubeImport = (payload: YoutubeImportPayload) => buildYoutubeImportPlan(payload);

export type DiscoverPayload = {
  regionCode?: string;
  language?: string;
  keywords?: string[];
  keywordCount?: number;
  perKeyword?: number;
  periodHours?: number;
  includePopular?: boolean;
  offset?: number;
};

export type DiscoverResult = AppState & { discovered: number; keywords: string[]; warnings: string[] };

// 대량 '터진 영상 발견' 수집: 시드 키워드를 순회하고 (옵션) 인기차트를 병합해 한 번에 모은다.
// 키워드별 실패는 건너뛰고 warning으로 모아 보고한다 (부분 성공 우선 — 외부 API 함정 대비).
export const discoverBreakouts = async (payload: DiscoverPayload): Promise<DiscoverResult> => {
  const key = getApiKey();
  if (!key) throw new StoreInputError('YOUTUBE_DATA_API_KEY or SHORTS_IQ_YOUTUBE_API_KEY is required');

  const region = normalizeRegion(payload.regionCode);
  const language = payload.language;
  const keywords = payload.keywords?.length
    ? payload.keywords.map((keyword) => keyword.trim()).filter(Boolean)
    : selectSeedKeywords(payload.keywordCount ?? 12, payload.offset ?? 0);
  const perKeyword = Math.max(1, Math.min(50, Math.round(payload.perKeyword ?? 15)));
  const publishedAfter = periodHoursToIso(payload.periodHours);

  const ids = new Set<string>();
  const warnings: string[] = [];

  if (payload.includePopular !== false) {
    try {
      for (const id of await popularShortIds(region, key)) ids.add(id);
    } catch (error) {
      warnings.push(`인기차트 수집 실패: ${errorMessage(error)}`);
    }
  }

  for (const keyword of keywords) {
    try {
      const plan = buildYoutubeImportPlan({ regionCode: region, language, query: keyword, maxResults: perKeyword, order: 'viewCount', publishedAfter });
      for (const id of await searchVideoIds(plan, key)) ids.add(id);
    } catch (error) {
      warnings.push(`'${keyword}' 수집 실패: ${errorMessage(error)}`);
    }
  }

  if (ids.size === 0) throw new StoreInputError('수집된 영상이 없습니다. 쿼터·네트워크를 확인하세요.');

  const videos = await idsToVideos(Array.from(ids), key, { regionCode: region, language });
  if (videos.length === 0) throw new StoreInputError('Shorts 길이 영상이 없습니다.');

  const state = await upsertVideos(videos);
  return { ...state, discovered: videos.length, keywords, warnings };
};

// 외부 API 실패 시 마지막 수집 캐시를 반환하는 graceful fallback (discover 버전).
export const discoverBreakoutsWithFallback = async (
  payload: DiscoverPayload,
): Promise<DiscoverResult & { degraded?: boolean; degradedReason?: string }> => {
  try {
    return await discoverBreakouts(payload);
  } catch (error) {
    if (error instanceof StoreInputError && /API_KEY|required/i.test(error.message)) throw error;
    const cached = await readState();
    return {
      ...cached,
      discovered: 0,
      keywords: [],
      warnings: [],
      degraded: true,
      degradedReason: error instanceof Error ? error.message : 'YouTube 대량 수집에 실패했습니다.',
    };
  }
};

export type ResampleResult = AppState & { resampled: number };

// 이미 추적 중인 youtube-api 영상들의 통계를 YouTube에서 다시 불러와 갱신한다 (실제 Live sync).
// - viewsHistory에 실제 샘플이 누적되어 velocity/추세가 실측화된다 (mock 증분 대체).
// - category/template/language(=Codex 분류 등)는 기존값을 보존한다.
// - 50개 청크 videos.list라 쿼터 저렴(200개 ≈ 4 units + 채널통계).
export const resampleTrackedVideos = async (limit = 1000): Promise<ResampleResult> => {
  const key = getApiKey();
  if (!key) throw new StoreInputError('YOUTUBE_DATA_API_KEY or SHORTS_IQ_YOUTUBE_API_KEY is required');

  const state = await readState();
  const tracked = state.videos
    .filter((video) => video.sourceKind === 'youtube-api' && video.id.startsWith('yt-'))
    .slice(0, Math.max(1, Math.min(1000, limit))); // videos.list는 50개/1 unit이라 전체 갱신도 저렴
  if (tracked.length === 0) return { ...state, resampled: 0 };

  const byId = new Map(tracked.map((video) => [video.id, video]));
  const ids = tracked.map((video) => video.id.replace(/^yt-/, ''));
  const refreshed = (await idsToVideos(ids, key, {})).map((video) => {
    const previous = byId.get(video.id);
    // 분류·언어는 기존값 유지(재추론으로 Codex 수정분이 덮이지 않게). 통계·시계열만 갱신.
    return previous ? { ...video, category: previous.category, template: previous.template, language: previous.language } : video;
  });
  if (refreshed.length === 0) return { ...state, resampled: 0 };

  const merged = await upsertVideos(refreshed);
  return { ...merged, resampled: refreshed.length };
};

// 외부 API 실패 시 기존 상태를 그대로 반환하는 graceful fallback (resample 버전).
export const resampleTrackedVideosWithFallback = async (
  limit = 1000,
): Promise<ResampleResult & { degraded?: boolean; degradedReason?: string }> => {
  try {
    return await resampleTrackedVideos(limit);
  } catch (error) {
    if (error instanceof StoreInputError && /API_KEY|required/i.test(error.message)) throw error;
    const cached = await readState();
    return { ...cached, resampled: 0, degraded: true, degradedReason: error instanceof Error ? error.message : 'Live sync에 실패했습니다.' };
  }
};

// 인기차트(mostPopular)에서 Shorts(≤60s) videoId를 뽑는다 (1 unit, 키워드 불필요).
const popularShortIds = async (region: string, key: string): Promise<string[]> => {
  const params = new URLSearchParams({ part: 'contentDetails', chart: 'mostPopular', regionCode: region, maxResults: '50', key });
  const response = await fetchJson<{ items?: { id?: string; contentDetails?: { duration?: string } }[] }>(`${videosEndpoint}?${params.toString()}`, 'YouTube mostPopular');
  return (response.items ?? [])
    .filter((item) => durationToSeconds(isoDurationToClock(item.contentDetails?.duration)) <= 60)
    .map((item) => item.id)
    .filter((id): id is string => Boolean(id));
};

const periodHoursToIso = (periodHours?: number): string | undefined => {
  if (!periodHours || !Number.isFinite(periodHours) || periodHours <= 0) return undefined;
  return new Date(Date.now() - periodHours * 36e5).toISOString();
};

const errorMessage = (error: unknown) => error instanceof Error ? error.message : '알 수 없는 오류';

const youtubeResourceToVideo = (item: YoutubeVideoResource, index: number, payload: YoutubeImportPayload, channelStats: Map<string, ChannelStats> = new Map()): VideoItem | null => {
  if (!item.id || !item.snippet) return null;
  const now = new Date().toISOString();
  const publishedAt = item.snippet.publishedAt ?? now;
  const viewCount = Number(item.statistics?.viewCount ?? 0);
  const comments = Number(item.statistics?.commentCount ?? 0);
  const likes = Number(item.statistics?.likeCount ?? 0);
  const ageHours = Math.max((Date.now() - Date.parse(publishedAt)) / 36e5, 0.5);
  const vph = Math.round(viewCount / ageHours);
  const duration = isoDurationToClock(item.contentDetails?.duration);
  const saveRate = viewCount > 0 ? `${Math.max(1.8, Math.min(18, ((likes + comments * 3) / viewCount) * 100)).toFixed(1)}%` : '0%';
  const retention = `${Math.max(45, Math.min(82, 58 + Math.round(vph / 6000) + (durationToSeconds(duration) <= 30 ? 6 : 0)))}%`;

  return {
    id: `yt-${item.id}`,
    rank: index + 1,
    title: item.snippet.title ?? 'Untitled YouTube Shorts',
    channel: item.snippet.channelTitle ?? 'Unknown channel',
    template: payload.template?.trim() || inferTemplate(item.snippet.title ?? ''),
    category: payload.category?.trim() || inferCategory(item.snippet.title ?? '', item.snippet.channelTitle ?? ''),
    uploaded: uploadedLabel(publishedAt),
    views: formatCompact(viewCount),
    viewCount,
    velocity: `+${(vph / 1000).toFixed(1)}K/h`,
    saved: true,
    folder: 'YouTube 수집',
    gradient: gradientFor(item.id),
    hook: `YouTube Data API 수집: ${payload.query?.trim() || 'keyword'} 검색 결과. 조회수·좋아요·댓글은 실측, 시청유지·저장률은 공개 API 미제공으로 추정값입니다.`,
    retention,
    saveRate,
    duration,
    sourceUrl: `https://www.youtube.com/shorts/${item.id}`,
    thumbnailUrl: bestThumbnail(item.snippet.thumbnails),
    publishedAt,
    lastSampledAt: now,
    ingestedAt: now,
    sourceKind: 'youtube-api',
    language: normalizeLanguage(payload.language),
    viewsHistory: [{ at: now, views: viewCount }],
    likeCount: likes,
    commentCount: comments,
    channelId: item.snippet.channelId,
    subscriberCount: channelStats.get(item.snippet.channelId ?? '')?.subscriberCount,
    channelPublishedAt: channelStats.get(item.snippet.channelId ?? '')?.channelPublishedAt,
    metricsProxy: true,
  };
};

const fetchJson = async <T>(url: string, label: string): Promise<T> => {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body?.error?.message === 'string' ? body.error.message : `${label} request failed`;
    throw new StoreInputError(message);
  }
  return body as T;
};

const getApiKey = () => process.env.SHORTS_IQ_YOUTUBE_API_KEY || process.env.YOUTUBE_DATA_API_KEY || '';

const clampMaxResults = (value?: number) => {
  if (!Number.isFinite(value)) return 12;
  return Math.max(1, Math.min(200, Math.round(Number(value)))); // 페이지네이션으로 최대 200까지 수집
};

const normalizeOrder = (order?: string) => ['date', 'relevance', 'viewCount'].includes(order ?? '') ? order as string : 'viewCount';

const normalizeRegion = (region?: string) => {
  const value = (region || 'KR').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(value) ? value : 'KR';
};

const normalizeRelevanceLanguage = (language?: string) => language === '영어' ? 'en' : 'ko';

const normalizeLanguage = (language?: string): VideoItem['language'] => language === '영어' ? '영어' : language === '기타' ? '기타' : '한국어';

const isoDurationToClock = (duration?: string) => {
  const match = duration?.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return '00:30';
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);
  const total = hours * 3600 + minutes * 60 + seconds;
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
};

const durationToSeconds = (duration: string) => {
  const [minutes, seconds] = duration.split(':').map(Number);
  return (minutes || 0) * 60 + (seconds || 0);
};

const uploadedLabel = (publishedAt: string) => {
  const hours = Math.max((Date.now() - Date.parse(publishedAt)) / 36e5, 0);
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m ago`;
  if (hours < 24) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
};

const inferTemplate = (title: string) => {
  if (/\d|top|best|가지|개/.test(title.toLowerCase())) return 'Ranking Hook';
  if (/before|after|전후|비교/.test(title.toLowerCase())) return 'Before / After';
  if (/how|방법|튜토리얼|법/.test(title.toLowerCase())) return 'Tutorial Steps';
  if (/product|review|추천|템/.test(title.toLowerCase())) return 'Product Demo';
  return '9:16 Full Frame';
};

const bestThumbnail = (thumbnails?: Record<string, { url?: string }>) => thumbnails?.maxres?.url
  || thumbnails?.standard?.url
  || thumbnails?.high?.url
  || thumbnails?.medium?.url
  || thumbnails?.default?.url;

const gradientFor = (input: string) => {
  const palettes = [
    ['#7170ff', '#111827'],
    ['#06b6d4', '#101820'],
    ['#10b981', '#111827'],
    ['#f59e0b', '#171717'],
    ['#ec4899', '#121212'],
  ];
  const index = input.split('').reduce((sum, char, idx) => (sum + char.charCodeAt(0) * (idx + 3)) % palettes.length, 0);
  return `linear-gradient(160deg,${palettes[index][0]},${palettes[index][1]} 58%,#050505)`;
};
