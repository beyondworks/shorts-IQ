import { access, mkdir } from 'fs/promises';
import { spawn } from 'child_process';
import type { AppState, DownloadClip, DownloadProcessPlan, VideoItem } from './types';
import { readState, StoreInputError, StoreNotFoundError, updateDownloadStatus } from './store';

type ProcessOptions = {
  dryRun?: boolean;
};

const defaultOutputDir = '.data/clips';
const commandTimeoutMs = 120_000;

// 동시 실행 중인 다운로드 작업 추적 (호스트 자원 고갈·중복 실행 방지)
const inFlight = new Set<string>();
const maxConcurrentDownloads = () => Math.max(1, Number(process.env.SHORTS_IQ_MAX_DOWNLOADS ?? 2));

export const createDownloadProcessPlan = async (clipId: string): Promise<DownloadProcessPlan> => {
  const state = await readState();
  const { clip, video } = getDownloadContext(state, clipId);
  if (!video.sourceUrl) throw new StoreInputError(`Video has no sourceUrl: ${video.id}`);
  validateSourceUrl(video.sourceUrl, video.id);

  const tools = await resolveTools();
  const outputDir = process.env.SHORTS_IQ_OUTPUT_DIR || defaultOutputDir;
  const rawPath = `${outputDir}/${safeFileName(clip.id)}.source.mp4`;
  const outputPath = `${outputDir}/${safeFileName(clip.id)}.mp4`;

  return {
    clipId,
    sourceUrl: video.sourceUrl,
    rawPath,
    outputPath,
    tools,
    commands: {
      ytdlp: [
        tools.ytdlp,
        '--no-playlist',
        '-f',
        'mp4/best[ext=mp4]/best',
        '-o',
        rawPath,
        video.sourceUrl,
      ],
      ffmpeg: [
        tools.ffmpeg,
        '-y',
        '-ss',
        String(clip.startSec),
        '-to',
        String(clip.endSec),
        '-i',
        rawPath,
        '-vf',
        'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2',
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-c:a',
        'aac',
        outputPath,
      ],
    },
  };
};

export const processDownloadClip = async (clipId: string, options: ProcessOptions = {}): Promise<AppState> => {
  let plan: DownloadProcessPlan;
  try {
    plan = await createDownloadProcessPlan(clipId);
    if (options.dryRun) return readState();
  } catch (error) {
    if (error instanceof StoreInputError) {
      return updateDownloadStatus(clipId, 'failed', undefined, error.message);
    }
    throw error;
  }

  if (inFlight.has(clipId)) return readState();
  if (inFlight.size >= maxConcurrentDownloads()) {
    return updateDownloadStatus(clipId, 'failed', undefined, `동시 다운로드 한도(${maxConcurrentDownloads()})를 초과했습니다. 잠시 후 다시 시도하세요.`);
  }

  inFlight.add(clipId);
  await mkdir(dirname(plan.outputPath), { recursive: true });
  await updateDownloadStatus(clipId, 'processing');

  try {
    await runCommand(plan.tools.ytdlp, plan.commands.ytdlp.slice(1));
    await runCommand(plan.tools.ffmpeg, plan.commands.ffmpeg.slice(1));
    return await updateDownloadStatus(clipId, 'ready', plan.outputPath);
  } catch (error) {
    return await updateDownloadStatus(clipId, 'failed', undefined, error instanceof Error ? error.message : '다운로드 작업을 완료하지 못했습니다.');
  } finally {
    inFlight.delete(clipId);
  }
};

const getDownloadContext = (state: AppState, clipId: string): { clip: DownloadClip; video: VideoItem } => {
  const clip = state.downloads.find((item) => item.id === clipId);
  if (!clip) throw new StoreNotFoundError(`Download clip not found: ${clipId}`);
  const video = state.videos.find((item) => item.id === clip.videoId);
  if (!video) throw new StoreNotFoundError(`Video not found: ${clip.videoId}`);
  return { clip, video };
};

const resolveTools = async () => {
  const ytdlp = await resolveTool(process.env.SHORTS_IQ_YTDLP_BIN || 'yt-dlp', 'yt-dlp');
  const ffmpeg = await resolveTool(process.env.SHORTS_IQ_FFMPEG_BIN || 'ffmpeg', 'ffmpeg');
  return { ytdlp, ffmpeg };
};

const validateSourceUrl = (sourceUrl: string, videoId: string) => {
  try {
    const url = new URL(sourceUrl);
    if (url.protocol === 'http:' || url.protocol === 'https:') return;
  } catch {
    // Fall through to the shared validation error below.
  }
  throw new StoreInputError(`Video sourceUrl must be an http(s) URL: ${videoId}`);
};

const resolveTool = async (command: string, label: string) => {
  if (command.includes('/')) {
    await access(command).catch(() => {
      throw new StoreInputError(`${label} executable not found: ${command}`);
    });
    return command;
  }
  if (await canRun(command)) return command;
  for (const candidate of [`/opt/homebrew/bin/${command}`, `/usr/local/bin/${command}`, `/usr/bin/${command}`]) {
    if (await canAccess(candidate)) return candidate;
  }
  throw new StoreInputError(`${label} executable not found in PATH`);
};

const canRun = async (command: string) => {
  try {
    await runCommand(command, ['--version'], 5_000);
    return true;
  } catch {
    return false;
  }
};

const canAccess = async (filePath: string) => {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
};

const runCommand = (command: string, args: string[], timeoutMs = commandTimeoutMs) => new Promise<void>((resolve, reject) => {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const stderr: string[] = [];
  const timer = setTimeout(() => {
    child.kill('SIGKILL');
    reject(new Error(`${command} timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  child.stderr.on('data', (chunk) => stderr.push(String(chunk)));
  child.on('error', (error) => {
    clearTimeout(timer);
    reject(error);
  });
  child.on('close', (code) => {
    clearTimeout(timer);
    if (code === 0) {
      resolve();
      return;
    }
    reject(new Error(`${command} exited ${code}: ${stderr.join('').slice(-900)}`));
  });
});

const safeFileName = (value: string) => value.replace(/[^a-zA-Z0-9._-]/g, '_');

const dirname = (filePath: string) => {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const index = normalizedPath.lastIndexOf('/');
  if (index === -1) return '.';
  return normalizedPath.slice(0, index) || '/';
};
