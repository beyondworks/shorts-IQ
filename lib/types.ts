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
  metricsProxy?: boolean;
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
