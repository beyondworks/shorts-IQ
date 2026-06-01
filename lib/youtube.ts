import { formatCompact } from './metrics';
import { StoreInputError, upsertVideos } from './store';
import type { AppState, VideoItem } from './types';

export type YoutubeImportPayload = {
  category?: string;
  dryRun?: boolean;
  language?: string;
  maxResults?: number;
  order?: string;
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
};

type YoutubeVideosResponse = {
  items?: YoutubeVideoResource[];
};

type YoutubeVideoResource = {
  id?: string;
  snippet?: {
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
    maxResults: String(maxResults),
    order,
    q: query,
    regionCode,
    relevanceLanguage,
    safeSearch: 'moderate',
    type: 'video',
    videoDuration: 'short',
  });
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
  const searchResponse = await fetchJson<YoutubeSearchResponse>(plan.searchUrl, 'YouTube search');
  const ids = Array.from(new Set((searchResponse.items ?? []).map((item) => item.id?.videoId).filter(Boolean) as string[])).slice(0, plan.maxResults);
  if (ids.length === 0) throw new StoreInputError('No YouTube video results found for query');

  const detailParams = new URLSearchParams({
    id: ids.join(','),
    key,
    part: 'snippet,statistics,contentDetails',
  });
  const videosResponse = await fetchJson<YoutubeVideosResponse>(`${videosEndpoint}?${detailParams.toString()}`, 'YouTube videos');
  const videos = (videosResponse.items ?? [])
    .map((item, index) => youtubeResourceToVideo(item, index, payload))
    .filter((video): video is VideoItem => Boolean(video))
    .filter((video) => durationToSeconds(video.duration) <= 60);

  if (videos.length === 0) throw new StoreInputError('No Shorts-length videos found in YouTube response');
  return upsertVideos(videos);
};

export const dryRunYoutubeImport = (payload: YoutubeImportPayload) => buildYoutubeImportPlan(payload);

const youtubeResourceToVideo = (item: YoutubeVideoResource, index: number, payload: YoutubeImportPayload): VideoItem | null => {
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
    category: payload.category?.trim() || 'YouTube 수집',
    uploaded: uploadedLabel(publishedAt),
    views: formatCompact(viewCount),
    viewCount,
    velocity: `+${(vph / 1000).toFixed(1)}K/h`,
    saved: true,
    folder: 'YouTube 수집',
    gradient: gradientFor(item.id),
    hook: `YouTube Data API 수집: ${payload.query?.trim() || 'keyword'} 검색 결과에서 조회수, 길이, 게시일을 보강했습니다.`,
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
  if (!Number.isFinite(value)) return 10;
  return Math.max(1, Math.min(25, Math.round(Number(value))));
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
