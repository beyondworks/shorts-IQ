export type BreakoutGrade = 'Breakout' | 'Surging' | 'Notable' | 'Steady';

// '터진 영상' 신호 — 절대 조회수가 아니라 "기대 대비 얼마나 비정상적으로 터졌는가".
// 런타임 파생값(저장하지 않음). null = 해당 축의 표본/데이터 부족(정직하게 미측정 처리).
export type BreakoutSignal = {
  score: number; // 0~100
  grade: BreakoutGrade;
  subscriberMultiple: number | null; // 구독자 대비 조회수 배율
  outlier: number | null; // 채택된 outlier 배율(채널-자기 우선, 없으면 니치 또래)
  outlierSource: 'channel' | 'niche' | null; // outlier 출처 — 'channel'=이 채널 평소 대비(1순위), 'niche'=또래 대비
  freshVph: number; // 신선도 가중 시간당 조회수
  ageHours: number;
  // 신뢰도(축의 '질' 기준): 1순위 outlier(채널 평소 또는 또래 대비 실측) 보유 = high,
  // 없고 노이즈 큰 VSR(구독자 대비)만 = medium, 둘 다 없어 velocity(절대 인기)만 = low(가짜 확신 금지).
  confidence: 'high' | 'medium' | 'low';
  measured: { subscriberMultiple: boolean; outlier: boolean };
};

export type VideoItem = {
  id: string;
  rank: number;
  title: string;
  channel: string;
  template: string;
  category: string;
  uploaded: string;
  views: string;
  viewCount: number;
  velocity: string;
  saved: boolean;
  folder: string;
  gradient: string;
  hook: string;
  retention: string;
  saveRate: string;
  duration: string;
  sourceUrl?: string;
  thumbnailUrl?: string;
  publishedAt?: string;
  lastSampledAt?: string;
  ingestedAt?: string;
  sourceKind?: 'seed' | 'youtube-oembed' | 'youtube-api' | 'manual';
  language?: '한국어' | '영어' | '기타';
  viewsHistory?: { at: string; views: number }[];
  likeCount?: number;
  commentCount?: number;
  subscriberCount?: number;
  channelId?: string;
  channelPublishedAt?: string;
  channelMedianViews?: number; // 이 채널 최근 영상 조회수 중앙값(채널 평소) — 채널-자기 배율 baseline
  channelSampleSize?: number; // 위 중앙값을 낸 표본 수(신뢰도 판단용)
  channelBaselineAt?: string; // 채널 baseline 수집 시각
  metricsProxy?: boolean;
  breakout?: BreakoutSignal; // 런타임 파생 (랭킹/표시용)
  rankDelta?: number | null; // 직전 샘플 대비 랭킹 변동 (양수=상승). null=신규/추적 부족
};

export type TemplatePattern = {
  name: string;
  type: string;
  views: string;
  delta: string;
  count: number;
  tone: 'cyan' | 'violet' | 'green' | 'blue';
  why: string;
  bestFor: string;
};

export type FolderItem = {
  name: string;
  color: string;
  desc: string;
  count?: number;
};

export type FolderCollection = FolderItem & {
  videos: VideoItem[];
  savedCount: number;
  downloadCount: number;
  templates: { name: string; count: number }[];
  topVelocity: string;
  updatedAt: string | null;
};

export type ChannelSummary = {
  channelId?: string;
  channel: string;
  subscriberCount?: number;
  videoCount: number;
  totalViews: number;
  avgViews: number;
  topVelocity: string;
  growthRatio: number;
  gradient: string;
  thumbnailUrl?: string;
  topVideoId?: string;
  topVideoTitle?: string;
  topCategory: string;
  breakoutScore: number; // 채널 최고 breakout 점수 (터진 영상 보유 정도)
  breakoutCount: number; // breakout/surging 등급 영상 수
};

export type DownloadClip = {
  id: string;
  videoId: string;
  title: string;
  startSec: number;
  endSec: number;
  status: 'queued' | 'processing' | 'ready' | 'failed';
  format: 'mp4';
  aspectRatio: '9:16';
  createdAt: string;
  policyNote: string;
  outputPath?: string;
  error?: string;
};

export type DownloadProcessPlan = {
  clipId: string;
  sourceUrl: string;
  rawPath: string;
  outputPath: string;
  tools: {
    ytdlp: string;
    ffmpeg: string;
  };
  commands: {
    ytdlp: string[];
    ffmpeg: string[];
  };
};

export type IngestResult = {
  video: VideoItem;
  source: 'youtube-oembed' | 'manual';
  created: boolean;
};

export type MatchSignal = {
  label: string;
  score: string;
  note: string;
};

export type PolicyCheck = {
  name: string;
  status: '통과' | '주의' | '검토';
  desc: string;
};

export type MatchReport = {
  id: string;
  sourceTitle: string;
  remakeTitle: string;
  sourceUrl?: string;
  remakeUrl?: string;
  matchScore: string;
  risk: 'Low' | 'Medium' | 'High';
  signals: MatchSignal[];
  policyChecks: PolicyCheck[];
  createdAt: string;
};

export type AppState = {
  videos: VideoItem[];
  templates: TemplatePattern[];
  folders: FolderItem[];
  downloads: DownloadClip[];
  matchReports: MatchReport[];
  lastSyncedAt: string | null;
};
