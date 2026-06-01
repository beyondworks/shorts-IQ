import { mkdir, readFile, rename, writeFile } from 'fs/promises';
import path from 'node:path';
import { commentsScore, durationSeconds, formatCompact, measuredVelocity, pct, shareScore, uploadedHours, velocityNumber } from './metrics';
import { createSeedState } from './seed';
import type { AppState, ChannelSummary, DownloadClip, FolderCollection, FolderItem, MatchReport, PolicyCheck, TemplatePattern, VideoItem } from './types';

type MatchReportPayload = Partial<Pick<MatchReport, 'sourceTitle' | 'remakeTitle' | 'sourceUrl' | 'remakeUrl'>> & {
  remakeNotes?: string;
  sourceVideoId?: string;
  videoId?: string;
};
type IngestPayload = {
  category?: string;
  duration?: string;
  hook?: string;
  language?: string;
  sourceUrl?: string;
  template?: string;
  title?: string;
  channel?: string;
};
type ValidatedIngestPayload = Omit<IngestPayload, 'language'> & { language?: VideoItem['language'] };
export type VideoQuery = {
  category?: string;
  duration?: string;
  language?: string;
  maxSubscribers?: string;
  minSubscribers?: string;
  q?: string;
  query?: string;
  sort?: string;
  template?: string;
  uploaded?: string;
  views?: string;
};

const defaultDataPath = path.join(/*turbopackIgnore: true*/ process.cwd(), '.data', 'shorts-iq.json');

const folderPalette = ['#7170ff', '#10b981', '#06b6d4', '#f59e0b', '#ec4899', '#38bdf8'];

export const readState = async (): Promise<AppState> => {
  await ensureDataFile();
  const raw = await readFile(/*turbopackIgnore: true*/ getDataPath(), 'utf8');
  return hydrateState(JSON.parse(raw) as AppState);
};

export const readVisibleState = async (): Promise<AppState> => {
  const state = await readState();
  const videos = rankVisibleVideos(visibleVideos(state.videos));
  return {
    ...state,
    videos,
    folders: hydrateFolders(videos, state.folders),
  };
};

// 모든 변이(read-modify-write)를 직렬화해 동시 요청 시 lost update를 막는다.
let writeChain: Promise<unknown> = Promise.resolve();

export const withMutation = <T>(task: () => Promise<T>): Promise<T> => {
  const run = writeChain.then(task, task);
  writeChain = run.then(() => undefined, () => undefined);
  return run;
};

export const writeState = async (state: AppState): Promise<AppState> => {
  const nextState = hydrateState(state);
  const dataPath = getDataPath();
  const dataDir = dirname(dataPath);
  await mkdir(/*turbopackIgnore: true*/ dataDir, { recursive: true });
  // atomic write: temp 파일에 쓴 뒤 rename으로 교체해 부분 쓰기 손상을 방지한다.
  const tmpPath = `${dataPath}.${process.pid}.${Date.now().toString(36)}.tmp`;
  await writeFile(/*turbopackIgnore: true*/ tmpPath, `${JSON.stringify(nextState, null, 2)}\n`, 'utf8');
  await rename(/*turbopackIgnore: true*/ tmpPath, dataPath);
  return nextState;
};

export const listVideos = async (query: VideoQuery = {}): Promise<VideoItem[]> => {
  const state = await readState();
  return filterVideos(visibleVideos(state.videos), query);
};

export const getVideo = async (id: string): Promise<VideoItem> => {
  const state = await readState();
  return findVideo(state, id);
};

export const getVisibleVideo = async (id: string): Promise<VideoItem> => {
  const state = await readVisibleState();
  return findVideo(state, id);
};

export const listTemplates = async (): Promise<TemplatePattern[]> => {
  const state = await readState();
  return state.templates;
};

export const listRankings = async (query: VideoQuery = {}): Promise<VideoItem[]> => {
  return listVideos({ sort: '급상승순', ...query });
};

export const listDownloads = async (): Promise<DownloadClip[]> => {
  const state = await readState();
  return state.downloads;
};

export const listFolderCollections = async (folderName?: string): Promise<FolderCollection[]> => {
  const state = await readState();
  const collections = state.folders.map((folder) => folderCollection(folder, state));
  if (!folderName) return collections;
  const collection = collections.find((folder) => folder.name === folderName);
  if (!collection) throw new StoreNotFoundError(`Folder not found: ${folderName}`);
  return [collection];
};

export const listMatchReports = async (): Promise<MatchReport[]> => {
  const state = await readState();
  return state.matchReports;
};

export const listChannels = async (sort?: string): Promise<ChannelSummary[]> => {
  const state = await readVisibleState();
  const groups = new Map<string, VideoItem[]>();
  for (const video of state.videos) {
    const key = video.channelId || video.channel;
    const list = groups.get(key) ?? [];
    list.push(video);
    groups.set(key, list);
  }
  return sortChannels(Array.from(groups.values()).map(toChannelSummary), sort);
};

export const ingestVideo = async (payload: IngestPayload): Promise<AppState> => withMutation(async () => {
  const sourceUrl = payload.sourceUrl?.trim();
  const title = payload.title?.trim();
  if (!sourceUrl && !title) throw new StoreInputError('sourceUrl or title is required');

  const state = await readState();
  const now = new Date().toISOString();
  const language = normalizeLanguage(payload.language);
  const oembed = sourceUrl ? await fetchYoutubeOembed(sourceUrl) : null;
  const sourceId = sourceUrl && isYoutubeUrl(sourceUrl) ? youtubeVideoId(sourceUrl) : null;
  const idSeed = sourceUrl || title || now;
  const id = sourceId ? `yt-${sourceId}` : `manual-${deterministicScore(idSeed).toString(36)}`;
  const existing = state.videos.find((video) => video.id === id || (sourceUrl && video.sourceUrl === sourceUrl));
  const source = oembed ? 'youtube-oembed' : 'manual';
  const video = buildIngestedVideo({
    id,
    rank: existing?.rank ?? state.videos.length + 1,
    source,
    now,
    payload: { ...payload, language },
    oembed,
    existing,
  });

  state.videos = existing
    ? state.videos.map((item) => item.id === existing.id ? video : item)
    : [...state.videos, video];

  ensureFolder(state, '수동 수집');
  ensureTemplate(state, video.template);
  state.lastSyncedAt = now;
  await writeState(state);
  return readState();
});

export const upsertVideos = async (videos: VideoItem[]): Promise<AppState> => withMutation(async () => {
  if (videos.length === 0) throw new StoreInputError('videos are required');

  const state = await readState();
  const now = new Date().toISOString();
  const existingById = new Map(state.videos.map((video) => [video.id, video]));
  const existingBySource = new Map(state.videos.filter((video) => video.sourceUrl).map((video) => [video.sourceUrl, video]));

  for (const importedVideo of videos) {
    const existing = existingById.get(importedVideo.id) || (importedVideo.sourceUrl ? existingBySource.get(importedVideo.sourceUrl) : undefined);
    const nextVideo: VideoItem = {
      ...existing,
      ...importedVideo,
      rank: existing?.rank ?? state.videos.length + 1,
      saved: existing?.saved ?? importedVideo.saved,
      folder: existing?.folder ?? importedVideo.folder,
      ingestedAt: existing?.ingestedAt ?? importedVideo.ingestedAt ?? now,
      viewsHistory: mergeViewsHistory(existing, importedVideo),
    };

    state.videos = existing
      ? state.videos.map((video) => video.id === existing.id ? nextVideo : video)
      : [...state.videos, nextVideo];
    existingById.set(nextVideo.id, nextVideo);
    if (nextVideo.sourceUrl) existingBySource.set(nextVideo.sourceUrl, nextVideo);
    ensureTemplate(state, nextVideo.template);
  }

  ensureFolder(state, 'YouTube 수집');
  state.lastSyncedAt = now;
  await writeState(state);
  return readState();
});

export const updateVideoSaved = async (id: string): Promise<AppState> => withMutation(async () => {
  const state = await readState();
  const video = findVideo(state, id);
  video.saved = !video.saved;
  if (!video.saved) video.folder = '';
  return writeState(state);
});

export const updateDownloadStatus = async (clipId: string, status: DownloadClip['status'], outputPath?: string, error?: string): Promise<AppState> => withMutation(async () => {
  if (!['queued', 'processing', 'ready', 'failed'].includes(status)) {
    throw new StoreInputError('status must be queued, processing, ready, or failed');
  }
  const state = await readState();
  const clip = state.downloads.find((download) => download.id === clipId);
  if (!clip) throw new StoreNotFoundError(`Download clip not found: ${clipId}`);
  clip.status = status;
  clip.outputPath = status === 'ready' ? outputPath || `local://clips/${clip.id}.mp4` : undefined;
  clip.error = status === 'failed' ? error || '다운로드 작업을 완료하지 못했습니다.' : undefined;
  return writeState(state);
});

export const assignVideoFolder = async (id: string, folder: string): Promise<AppState> => withMutation(async () => {
  const state = await readState();
  const video = findVideo(state, id);
  video.saved = true;
  video.folder = folder;
  ensureFolder(state, folder);
  return writeState(state);
});

export const createDownload = async (videoId: string, startSec: number, endSec: number, policyAccepted = false): Promise<AppState> => withMutation(async () => {
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || startSec < 0 || endSec <= startSec) {
    throw new StoreInputError('startSec and endSec must be valid clip bounds');
  }
  if (!policyAccepted) {
    throw new StoreInputError('policyAccepted is required before queueing a clip');
  }

  const state = await readState();
  const video = findVideo(state, videoId);
  const roundedStart = Math.round(startSec);
  const roundedEnd = Math.round(endSec);
  const existing = state.downloads.find((download) => (
    download.videoId === videoId
    && download.startSec === roundedStart
    && download.endSec === roundedEnd
    && download.status === 'queued'
  ));
  const clip = {
    id: existing?.id ?? `clip-${videoId}-${roundedStart}-${roundedEnd}-${Date.now().toString(36)}`,
    videoId,
    title: video.title,
    startSec: roundedStart,
    endSec: roundedEnd,
    status: 'queued' as const,
    format: 'mp4' as const,
    aspectRatio: '9:16' as const,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    policyNote: '로컬 큐에만 등록됩니다. 원본 재배포 전 권리와 플랫폼 정책을 확인하세요.',
    outputPath: undefined,
    error: undefined,
  };

  state.downloads = existing
    ? state.downloads.map((download) => download.id === existing.id ? clip : download)
    : [clip, ...state.downloads];

  video.saved = true;
  if (!video.folder) video.folder = '다운로드 후보';
  ensureFolder(state, '다운로드 후보');

  return writeState(state);
});

export const createMatchReport = async (payload: MatchReportPayload = {}): Promise<AppState> => withMutation(async () => {
  const state = await readState();
  const sourceVideo = payload.sourceVideoId || payload.videoId
    ? findVideo(state, payload.sourceVideoId || payload.videoId || '')
    : state.videos[0];
  const fallbackRemake = state.videos.find((video) => video.id !== sourceVideo?.id) ?? sourceVideo;
  const sourceTitle = payload.sourceTitle?.trim() || sourceVideo?.title || 'Original reference';
  const remakeTitle = payload.remakeTitle?.trim() || fallbackRemake?.title || 'Draft remake';
  const sourceUrl = payload.sourceUrl?.trim() || sourceVideo?.sourceUrl;
  const remakeUrl = payload.remakeUrl?.trim();
  const remakeNotes = payload.remakeNotes?.trim() || '';
  const sourceContext = `${sourceTitle} ${sourceVideo?.hook ?? ''} ${sourceVideo?.template ?? ''} ${sourceVideo?.category ?? ''}`;
  const remakeContext = `${remakeTitle} ${remakeNotes} ${remakeUrl ?? ''}`;
  const textScore = matchPercent(tokenOverlap(sourceContext, remakeContext), 18, 92, sourceContext, remakeContext);
  const audioScore = audioSimilarity(sourceUrl, remakeUrl, remakeNotes);
  const pixelScore = pixelSimilarity(sourceUrl, remakeUrl, remakeNotes);
  const structureScore = structureSimilarity(sourceVideo, remakeContext);
  const score = Math.round(textScore * 0.34 + audioScore * 0.18 + pixelScore * 0.22 + structureScore * 0.26);
  const risk = score >= 76 ? 'High' : score >= 61 ? 'Medium' : 'Low';

  const report: MatchReport = {
    id: `match-${Date.now().toString(36)}-${deterministicScore(`${sourceContext}|${remakeContext}`).toString(36)}`,
    sourceTitle,
    remakeTitle,
    sourceUrl,
    remakeUrl,
    matchScore: `${score}%`,
    risk,
    signals: [
      { label: '텍스트/키워드', score: `${textScore}%`, note: textScore >= 70 ? '제목, 훅, 메모의 핵심 키워드가 강하게 겹칩니다.' : '표면 문구와 키워드가 충분히 분산되어 있습니다.' },
      { label: '사운드 핑거프린트', score: `${audioScore}%`, note: audioScore >= 65 ? '동일 음원·BGM·효과음 사용 가능성을 보수적으로 표시했습니다.' : 'URL과 메모 기준으로 동일 사운드 사용 신호가 낮습니다.' },
      { label: '픽셀/프레임', score: `${pixelScore}%`, note: pixelScore >= 65 ? '동일 소스 URL 또는 프레임 재사용 메모가 있어 시각 리스크가 높습니다.' : '프레임·화면 재사용 단서가 낮은 편입니다.' },
      { label: '구조/전개', score: `${structureScore}%`, note: structureScore >= 70 ? '원본 템플릿, 훅, CTA 전개가 리메이크 메모와 크게 겹칩니다.' : '구조 전개가 원본과 충분히 달라 보입니다.' },
    ],
    policyChecks: buildPolicyChecks({ audioScore, pixelScore, risk, sourceUrl, remakeUrl, structureScore, textScore }),
    createdAt: new Date().toISOString(),
  };

  state.matchReports = [report, ...state.matchReports].slice(0, 20);
  return writeState(state);
});

export const simulateLiveSync = async (): Promise<AppState> => withMutation(async () => {
  const state = await readState();
  const syncedAt = new Date().toISOString();
  state.videos = state.videos.map((video) => {
    const currentVelocity = Math.max(1000, velocityNumber(video));
    const rankBoost = Math.max(1, 12 - video.rank);
    const delta = Math.round(currentVelocity * (0.18 + rankBoost / 100));
    const viewCount = video.viewCount + delta;
    const velocity = currentVelocity + rankBoost * 137;
    return {
      ...video,
      views: formatCompact(viewCount),
      viewCount,
      velocity: `+${(velocity / 1000).toFixed(1)}K/h`,
      lastSampledAt: syncedAt,
      viewsHistory: [...(video.viewsHistory ?? []), { at: syncedAt, views: viewCount }].slice(-24),
    };
  });
  state.lastSyncedAt = syncedAt;
  return writeState(state);
});

export class StoreInputError extends Error {
  status = 400;
}

export class StoreNotFoundError extends Error {
  status = 404;
}

const ensureDataFile = async () => {
  try {
    await readFile(/*turbopackIgnore: true*/ getDataPath(), 'utf8');
  } catch (error) {
    if (!isNotFound(error)) throw error;
    await writeState(createSeedState());
  }
};

const hydrateState = (state: AppState): AppState => ({
  ...state,
  videos: [...state.videos].map(hydrateVideo).sort((a, b) => a.rank - b.rank),
  folders: hydrateFolders(state.videos, state.folders),
  downloads: state.downloads ?? [],
  matchReports: (state.matchReports ?? []).map(hydrateMatchReport),
  lastSyncedAt: state.lastSyncedAt ?? null,
});

const hydrateVideo = (video: VideoItem): VideoItem => ({
  ...video,
  language: video.language ?? '한국어',
  sourceKind: video.sourceKind ?? 'seed',
  viewsHistory: video.viewsHistory ?? [{ at: video.lastSampledAt ?? new Date().toISOString(), views: video.viewCount }],
});

const hydrateMatchReport = (report: MatchReport): MatchReport => {
  if (report.signals.length >= 4 && report.signals.some((signal) => signal.label.includes('픽셀'))) return report;

  const fallbackScore = Number(report.matchScore.replace('%', '')) || 52;
  const textSignal = report.signals.find((signal) => signal.label.includes('텍스트')) ?? report.signals[0];
  const audioSignal = report.signals.find((signal) => signal.label.includes('오디오') || signal.label.includes('사운드')) ?? report.signals[2];
  const structureSignal = report.signals.find((signal) => signal.label.includes('구조') || signal.label.includes('장면') || signal.label.includes('리듬')) ?? report.signals[1];

  return {
    ...report,
    signals: [
      {
        label: '텍스트/키워드',
        score: textSignal?.score ?? `${Math.min(96, fallbackScore + 8)}%`,
        note: textSignal?.note ?? '후킹 문장과 키워드 겹침을 분리 산정했습니다.',
      },
      {
        label: '사운드 핑거프린트',
        score: audioSignal?.score ?? `${Math.max(18, fallbackScore - 16)}%`,
        note: audioSignal?.note ?? '음원, 효과음, 음성 톤을 별도 신호로 분리했습니다.',
      },
      {
        label: '픽셀/프레임',
        score: `${Math.max(12, fallbackScore - 22)}%`,
        note: '기존 리포트를 4-signal schema로 보정한 프레임 유사도 신호입니다.',
      },
      {
        label: '구조/전개',
        score: structureSignal?.score ?? `${Math.max(24, fallbackScore - 7)}%`,
        note: structureSignal?.note ?? '훅, 증거, CTA 순서의 구조적 유사도를 별도 산정했습니다.',
      },
    ],
  };
};

const hydrateFolders = (videos: VideoItem[], folders: FolderItem[]) => folders.map((folder) => ({
  ...folder,
  count: videos.filter((video) => video.folder === folder.name).length,
}));

const sourceKind = (video: VideoItem) => video.sourceKind ?? 'seed';

const visibleVideos = (videos: VideoItem[]) => {
  const realVideos = videos.filter((video) => sourceKind(video) !== 'seed');
  return realVideos.length > 0 ? realVideos : videos;
};

const rankVisibleVideos = (videos: VideoItem[]) => videos.map((video, index) => ({
  ...video,
  rank: index + 1,
}));

const ensureFolder = (state: AppState, folder: string) => {
  if (state.folders.some((item) => item.name === folder)) return;
  state.folders.push({
    name: folder,
    color: folderPalette[state.folders.length % folderPalette.length],
    desc: '사용자가 추가한 로컬 폴더',
  });
};

const ensureTemplate = (state: AppState, templateName: string) => {
  if (state.templates.some((template) => template.name === templateName)) return;
  state.templates.push({
    name: templateName,
    type: 'User imported pattern',
    views: '0',
    delta: 'new',
    count: 1,
    tone: 'cyan',
    why: '사용자가 직접 추가한 레퍼런스에서 감지한 템플릿입니다.',
    bestFor: '수동 리서치 레퍼런스 정리',
  });
};

const tokenOverlap = (source: string, remake: string) => {
  const sourceTokens = meaningfulTokens(source);
  const remakeTokens = meaningfulTokens(remake);
  if (sourceTokens.length === 0 || remakeTokens.length === 0) return 0;
  const remakeSet = new Set(remakeTokens);
  const shared = new Set(sourceTokens.filter((token) => remakeSet.has(token)));
  return shared.size / Math.max(1, Math.min(new Set(sourceTokens).size, remakeSet.size));
};

const meaningfulTokens = (value: string) => value
  .toLowerCase()
  .replace(/https?:\/\/\S+/g, ' ')
  .split(/[^a-z0-9가-힣]+/)
  .map((token) => token.trim())
  .filter((token) => token.length >= 2 && !['the', 'and', 'with', 'for', '영상', '리메이크', '초안'].includes(token));

const matchPercent = (overlap: number, floor: number, ceiling: number, source: string, remake: string) => {
  const deterministicNoise = deterministicScore(`${source}|${remake}`) % 9;
  return Math.max(floor, Math.min(ceiling, Math.round(floor + overlap * (ceiling - floor) + deterministicNoise)));
};

const audioSimilarity = (sourceUrl?: string, remakeUrl?: string, notes = '') => {
  const lower = notes.toLowerCase();
  let score = 24 + deterministicScore(`${sourceUrl ?? ''}|${remakeUrl ?? ''}|audio`) % 16;
  if (sameCanonicalUrl(sourceUrl, remakeUrl)) score += 40;
  if (/same audio|same sound|same bgm|동일 음원|동일 사운드|원본 음원|bgm/.test(lower)) score += 22;
  if (/new audio|different audio|새 음원|다른 음원|무음|voiceover|보이스오버/.test(lower)) score -= 18;
  return boundedPercent(score);
};

const pixelSimilarity = (sourceUrl?: string, remakeUrl?: string, notes = '') => {
  const lower = notes.toLowerCase();
  let score = 18 + deterministicScore(`${sourceUrl ?? ''}|${remakeUrl ?? ''}|pixel`) % 18;
  if (sameCanonicalUrl(sourceUrl, remakeUrl)) score += 45;
  if (/same frame|same clip|same footage|동일 장면|동일 화면|원본 클립|캡처|crop|크롭/.test(lower)) score += 24;
  if (/new footage|new shoot|새 촬영|새 화면|직접 촬영|재촬영/.test(lower)) score -= 18;
  return boundedPercent(score);
};

const structureSimilarity = (sourceVideo: VideoItem | undefined, remakeContext: string) => {
  const context = remakeContext.toLowerCase();
  const template = sourceVideo?.template.toLowerCase() ?? '';
  let score = 28 + deterministicScore(`${sourceVideo?.id ?? ''}|${remakeContext}|structure`) % 18;
  if (template && context.includes(template)) score += 28;
  if (/hook|cta|before|after|ranking|list|steps|훅|전개|증거|비교|순위|단계|리스트|구조|템플릿/.test(context)) score += 18;
  if (/different structure|new structure|새 구조|다른 구조|순서 변경|전개 변경/.test(context)) score -= 20;
  return boundedPercent(score);
};

const buildPolicyChecks = ({
  audioScore,
  pixelScore,
  risk,
  sourceUrl,
  remakeUrl,
  structureScore,
  textScore,
}: {
  audioScore: number;
  pixelScore: number;
  risk: MatchReport['risk'];
  sourceUrl?: string;
  remakeUrl?: string;
  structureScore: number;
  textScore: number;
}): PolicyCheck[] => [
  {
    name: '원본 출처·사용 권한',
    status: risk === 'High' || sameCanonicalUrl(sourceUrl, remakeUrl) ? '검토' : '통과',
    desc: sameCanonicalUrl(sourceUrl, remakeUrl)
      ? '원본과 리메이크 URL이 같거나 같은 영상으로 보입니다. 게시 전 권리 확인이 필요합니다.'
      : 'URL 기준 동일 원본 재사용 단서는 낮지만 외부 게시 전 권리 확인은 필요합니다.',
  },
  {
    name: '동일 장면·음원 재사용',
    status: pixelScore >= 70 || audioScore >= 70 ? '주의' : '통과',
    desc: `픽셀 ${pixelScore}%, 사운드 ${audioScore}%로 분리 산정했습니다. 한쪽만 높아도 재사용 리스크로 검토하세요.`,
  },
  {
    name: '구조적 재사용 콘텐츠',
    status: textScore >= 76 || structureScore >= 76 ? '검토' : textScore >= 58 || structureScore >= 58 ? '주의' : '통과',
    desc: `텍스트 ${textScore}%, 구조 ${structureScore}%입니다. 낮은 표면 일치율만으로 안전하다고 보지 않습니다.`,
  },
  {
    name: '업로드 전 사람 검수',
    status: risk === 'Low' ? '주의' : '검토',
    desc: '자동 검수는 제작 전 스크리닝입니다. 최종 업로드 전 사람이 저작권·반복 생산·오해 유발 메타데이터를 확인해야 합니다.',
  },
];

const sameCanonicalUrl = (a?: string, b?: string) => Boolean(a && b && canonicalSourceUrl(a) === canonicalSourceUrl(b));

const canonicalSourceUrl = (value: string) => {
  try {
    const url = new URL(value);
    url.search = '';
    url.hash = '';
    return `${url.hostname.replace(/^www\./, '')}${url.pathname.replace(/\/$/, '')}`;
  } catch {
    return value.trim().toLowerCase();
  }
};

const boundedPercent = (value: number) => Math.max(8, Math.min(96, Math.round(value)));

const folderCollection = (folder: FolderItem, state: AppState): FolderCollection => {
  const videos = state.videos.filter((video) => video.folder === folder.name);
  const templateCounts = new Map<string, number>();
  for (const video of videos) {
    templateCounts.set(video.template, (templateCounts.get(video.template) ?? 0) + 1);
  }
  const topVideo = [...videos].sort((a, b) => velocityNumber(b) - velocityNumber(a))[0];
  const updatedAt = videos
    .map((video) => video.ingestedAt ?? video.lastSampledAt ?? video.publishedAt)
    .filter(Boolean)
    .sort((a, b) => Date.parse(String(b)) - Date.parse(String(a)))[0] ?? null;

  return {
    ...folder,
    count: videos.length,
    videos,
    savedCount: videos.filter((video) => video.saved).length,
    downloadCount: state.downloads.filter((clip) => videos.some((video) => video.id === clip.videoId)).length,
    templates: Array.from(templateCounts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    topVelocity: topVideo?.velocity ?? '+0.0K/h',
    updatedAt,
  };
};

const toChannelSummary = (videos: VideoItem[]): ChannelSummary => {
  const top = [...videos].sort((a, b) => b.viewCount - a.viewCount)[0];
  const topByVelocity = [...videos].sort((a, b) => velocityNumber(b) - velocityNumber(a))[0];
  const totalViews = videos.reduce((sum, video) => sum + video.viewCount, 0);
  const subscriberCount = videos.find((video) => video.subscriberCount != null)?.subscriberCount;
  return {
    channelId: top.channelId,
    channel: top.channel,
    subscriberCount,
    videoCount: videos.length,
    totalViews,
    avgViews: Math.round(totalViews / videos.length),
    topVelocity: topByVelocity?.velocity ?? '+0.0K/h',
    growthRatio: subscriberCount && subscriberCount > 0 ? totalViews / subscriberCount : 0,
    gradient: top.gradient,
    thumbnailUrl: top.thumbnailUrl,
    topVideoId: top.id,
    topVideoTitle: top.title,
    topCategory: top.category,
  };
};

const sortChannels = (channels: ChannelSummary[], sort?: string): ChannelSummary[] => {
  const sorted = [...channels];
  switch (sort) {
    case 'subscribers':
    case '구독자순':
      return sorted.sort((a, b) => (b.subscriberCount ?? 0) - (a.subscriberCount ?? 0));
    case 'growth':
    case '급성장순':
      return sorted.sort((a, b) => b.growthRatio - a.growthRatio);
    case 'views':
    case '조회수합계순':
    default:
      return sorted.sort((a, b) => b.totalViews - a.totalViews);
  }
};

const mergeViewsHistory = (existing: VideoItem | undefined, importedVideo: VideoItem) => {
  const samples = [...(existing?.viewsHistory ?? []), ...(importedVideo.viewsHistory ?? [])]
    .filter((sample) => Number.isFinite(Date.parse(sample.at)) && Number.isFinite(sample.views))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const deduped = new Map(samples.map((sample) => [`${sample.at}:${sample.views}`, sample]));
  return Array.from(deduped.values()).slice(-24);
};

const filterVideos = (videos: VideoItem[], query: VideoQuery) => {
  const search = (query.q ?? query.query ?? '').trim().toLowerCase();
  return rankVisibleVideos([...videos]
    .filter((video) => isAllValue(query.category) || video.category === query.category)
    .filter((video) => isAllValue(query.template) || video.template === query.template)
    .filter((video) => matchesUploaded(video, query.uploaded))
    .filter((video) => matchesViews(video, query.views))
    .filter((video) => matchesDuration(video, query.duration))
    .filter((video) => matchesLanguage(video, query.language))
    .filter((video) => matchesSubscribers(video, query.maxSubscribers, query.minSubscribers))
    .filter((video) => !search || `${video.title} ${video.channel} ${video.template} ${video.category}`.toLowerCase().includes(search))
    .sort((a, b) => compareVideos(a, b, query.sort)));
};

const matchesLanguage = (video: VideoItem, language?: string) => {
  if (isAllValue(language)) return true;
  return (video.language ?? '한국어') === language;
};

// 채널 규모 필터 (대형채널 제외 = 작은 채널 outlier 발굴). 구독자 수 미상이면 통과.
const matchesSubscribers = (video: VideoItem, max?: string, min?: string) => {
  if (video.subscriberCount == null) return true;
  const maxValue = parseSubscriberBound(max);
  const minValue = parseSubscriberBound(min);
  if (maxValue != null && video.subscriberCount > maxValue) return false;
  if (minValue != null && video.subscriberCount < minValue) return false;
  return true;
};

const parseSubscriberBound = (label?: string) => {
  if (!label || isAllValue(label)) return null;
  const number = Number(label.match(/(\d+(?:\.\d+)?)/)?.[1] ?? NaN);
  if (!Number.isFinite(number)) return null;
  const unit = /만/.test(label) ? 10000 : /천/.test(label) ? 1000 : 1;
  return number * unit;
};

const isAllValue = (value?: string) => !value || value === '전체' || value.startsWith('전체 ') || value === 'All' || value.startsWith('All ');

const matchesUploaded = (video: VideoItem, uploaded?: string) => {
  if (isAllValue(uploaded)) return true;
  if (uploaded === '실시간') return uploadedHours(video.uploaded) <= 1;
  if (uploaded === '1년 이상') return uploadedHours(video.uploaded) >= 8760;
  const hours = uploadedHoursFromLabel(uploaded);
  return hours === null || uploadedHours(video.uploaded) <= hours;
};

const uploadedHoursFromLabel = (label?: string) => {
  if (!label) return null;
  if (label.includes('24h')) return 24;
  if (label.includes('3일')) return 72;
  const number = Number(label.match(/(\d+)/)?.[1] ?? NaN);
  if (!Number.isFinite(number)) return null;
  if (label.includes('일')) return number * 24;
  if (label.includes('h')) return number;
  return null;
};

const matchesViews = (video: VideoItem, views?: string) => {
  if (isAllValue(views)) return true;
  const viewLabel = views ?? '';
  const number = Number(viewLabel.match(/(\d+)/)?.[1] ?? NaN);
  if (!Number.isFinite(number)) return true;
  const multiplier = viewLabel.includes('M') ? 1000000 : viewLabel.includes('K') ? 1000 : 10000;
  return video.viewCount >= number * multiplier;
};

const matchesDuration = (video: VideoItem, duration?: string) => {
  if (isAllValue(duration)) return true;
  const durationLabel = duration ?? '';
  const number = Number(durationLabel.match(/(\d+)/)?.[1] ?? NaN);
  return !Number.isFinite(number) || durationSeconds(video.duration) <= number;
};

const compareVideos = (a: VideoItem, b: VideoItem, sort?: string) => {
  switch (sort) {
    case 'views':
    case '조회수순':
      return b.viewCount - a.viewCount;
    case 'saveRate':
    case '저장률순':
      return pct(b.saveRate) - pct(a.saveRate);
    case 'latest':
    case '최신순':
      return a.rank - b.rank;
    case 'comments':
    case '댓글수순':
      return commentsScore(b) - commentsScore(a);
    case 'shares':
    case '공유순':
      return shareScore(b) - shareScore(a);
    case 'acceleration':
    case '급가속순':
      return measuredVelocity(b).perHour - measuredVelocity(a).perHour;
    case 'velocity':
    case '급상승순':
    default:
      return a.rank - b.rank;
  }
};

const buildIngestedVideo = ({
  id,
  rank,
  source,
  now,
  payload,
  oembed,
  existing,
}: {
  id: string;
  rank: number;
  source: 'youtube-oembed' | 'manual';
  now: string;
  payload: ValidatedIngestPayload;
  oembed: YoutubeOembed | null;
  existing?: VideoItem;
}): VideoItem => {
  const viewCount = existing?.viewCount ?? 0;
  const template = payload.template?.trim() || existing?.template || '9:16 Full Frame';
  const category = payload.category?.trim() || existing?.category || '수동 수집';
  const title = payload.title?.trim() || oembed?.title || existing?.title || 'Untitled Shorts reference';
  const channel = payload.channel?.trim() || oembed?.author_name || existing?.channel || 'Unknown channel';
  const sourceUrl = payload.sourceUrl?.trim() || existing?.sourceUrl;
  const viewsHistory = existing?.viewsHistory ?? [{ at: now, views: viewCount }];

  return {
    id,
    rank,
    title,
    channel,
    template,
    category,
    uploaded: existing?.uploaded ?? 'just now',
    views: formatCompact(viewCount),
    viewCount,
    velocity: existing?.velocity ?? '+0.0K/h',
    saved: existing?.saved ?? true,
    folder: existing?.folder || '수동 수집',
    gradient: existing?.gradient ?? gradientFor(id),
    hook: payload.hook?.trim() || existing?.hook || '수동 추가된 레퍼런스입니다. 훅/전개/CTA를 분석해 템플릿으로 분류하세요.',
    retention: existing?.retention ?? '0%',
    saveRate: existing?.saveRate ?? '0%',
    duration: payload.duration?.trim() || existing?.duration || '00:30',
    sourceUrl,
    thumbnailUrl: oembed?.thumbnail_url || existing?.thumbnailUrl,
    publishedAt: existing?.publishedAt ?? now,
    lastSampledAt: existing?.lastSampledAt ?? now,
    ingestedAt: existing?.ingestedAt ?? now,
    sourceKind: source,
    language: payload.language ?? existing?.language ?? '한국어',
    viewsHistory,
  };
};

const normalizeLanguage = (language?: string): VideoItem['language'] | undefined => {
  if (!language) return undefined;
  if (language === '한국어' || language === '영어' || language === '기타') return language;
  throw new StoreInputError('language must be 한국어, 영어, or 기타');
};

type YoutubeOembed = {
  author_name?: string;
  provider_name?: string;
  thumbnail_url?: string;
  title?: string;
};

const fetchYoutubeOembed = async (sourceUrl: string): Promise<YoutubeOembed | null> => {
  if (!isYoutubeUrl(sourceUrl)) return null;
  try {
    const endpoint = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(sourceUrl)}`;
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) return null;
    return await response.json() as YoutubeOembed;
  } catch {
    return null;
  }
};

const isYoutubeUrl = (sourceUrl: string) => {
  try {
    const url = new URL(sourceUrl);
    return ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'].includes(url.hostname);
  } catch {
    return false;
  }
};

const youtubeVideoId = (sourceUrl: string) => {
  try {
    const url = new URL(sourceUrl);
    if (url.hostname === 'youtu.be') return sanitizeId(url.pathname.slice(1));
    if (url.pathname.startsWith('/shorts/')) return sanitizeId(url.pathname.split('/')[2]);
    if (url.searchParams.get('v')) return sanitizeId(url.searchParams.get('v') ?? '');
    return sanitizeId(url.pathname.split('/').filter(Boolean).pop() ?? '');
  } catch {
    return null;
  }
};

const sanitizeId = (value: string) => {
  const id = value.replace(/[^a-zA-Z0-9_-]/g, '');
  return id || null;
};

const gradientFor = (input: string) => {
  const palettes = [
    ['#7170ff', '#111827'],
    ['#06b6d4', '#101820'],
    ['#10b981', '#111827'],
    ['#f59e0b', '#171717'],
    ['#ec4899', '#121212'],
  ];
  const palette = palettes[deterministicScore(input) % palettes.length];
  return `linear-gradient(160deg,${palette[0]},${palette[1]} 58%,#050505)`;
};

const findVideo = (state: AppState, id: string) => {
  const video = state.videos.find((item) => item.id === id);
  if (!video) throw new StoreNotFoundError(`Video not found: ${id}`);
  return video;
};

const deterministicScore = (input: string) => {
  let sum = 0;
  for (let index = 0; index < input.length; index += 1) {
    sum = (sum + input.charCodeAt(index) * (index + 17)) % 9973;
  }
  return sum;
};

const getDataPath = () => process.env.SHORTS_IQ_DATA_PATH || defaultDataPath;

const dirname = (filePath: string) => {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const index = normalizedPath.lastIndexOf('/');
  if (index === -1) return '.';
  return normalizedPath.slice(0, index) || '/';
};

const isNotFound = (error: unknown) => {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
};
