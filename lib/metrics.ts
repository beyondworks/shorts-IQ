import type { VideoItem } from './types';

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

export const pct = (value: string) => Number(value.replace('%', ''));

export const commentsScore = (video: VideoItem) => Math.round((video.viewCount / 1000) * (pct(video.retention) / 100) * (1 + (11 - video.rank) / 18));

export const shareScore = (video: VideoItem) => Math.round((video.viewCount / 1000) * (pct(video.saveRate) / 100) * (video.template.includes('Challenge') || video.template.includes('Caption') ? 1.55 : 1));

export const velocityNumber = (video: VideoItem) => Number(video.velocity.replace('+', '').replace('K/h', '')) * 1000;

export const formatCompact = (value: number) => value >= 1000000
  ? `${(value / 1000000).toFixed(value >= 10000000 ? 0 : 1)}M`
  : value >= 1000
    ? `${Math.round(value / 1000)}K`
    : String(value);

export const vidiqMetrics = (video: VideoItem) => {
  const age = Math.max(uploadedHours(video.uploaded), .5);
  const vph = Math.round(video.viewCount / age);
  const velocity = velocityNumber(video);
  const expected = Math.max(180000, (11 - video.rank) * 145000);
  const outlier = Math.max(1, Math.min(9.9, video.viewCount / expected));
  const engagement = Math.round((pct(video.retention) * .52) + (pct(video.saveRate) * 2.2) + Math.min(24, shareScore(video) / 18));
  const score = Math.min(100, Math.round(45 + outlier * 10 + engagement * .35 + Math.min(12, velocity / 8000)));
  const grade = score >= 86 ? 'Viral' : score >= 72 ? 'Strong' : score >= 58 ? 'Rising' : 'Watch';
  return { score, grade, vph, velocity, outlier: outlier.toFixed(1), comments: commentsScore(video), shares: shareScore(video), engagement };
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
