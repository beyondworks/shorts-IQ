import { spawn } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";

const STARTUP_TIMEOUT_MS = 45_000;
const REQUEST_TIMEOUT_MS = 10_000;
const HTML_ROUTES = ["/", "/rankings", "/templates", "/search", "/saved", "/folders", "/downloads", "/match", "/videos/vid-001", "/videos/not-in-state"];

const checks = [];
const externalBaseUrl = Boolean(process.env.SMOKE_BASE_URL);
let baseUrl = normalizeBaseUrl(process.env.SMOKE_BASE_URL);
let serverProcess = null;
let tempDir = null;

try {
  if (!baseUrl) {
    const port = await getAvailablePort();
    baseUrl = `http://127.0.0.1:${port}`;
    tempDir = await mkdtemp(path.join(tmpdir(), "shorts-iq-smoke-"));
    const dataPath = process.env.SHORTS_IQ_DATA_PATH || path.join(tempDir, "shorts-iq.json");
    const mode = process.env.SMOKE_SERVER_MODE === "start" && await hasProductionBuild() ? "start" : "dev";
    const args = mode === "start"
      ? ["exec", "next", "start", "--hostname", "127.0.0.1", "--port", String(port)]
      : ["exec", "next", "dev", "--hostname", "127.0.0.1", "--port", String(port)];

    serverProcess = spawn("pnpm", args, {
      cwd: process.cwd(),
      env: { ...process.env, SHORTS_IQ_DATA_PATH: dataPath },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const logs = [];
    serverProcess.stdout.on("data", (chunk) => logs.push(String(chunk)));
    serverProcess.stderr.on("data", (chunk) => logs.push(String(chunk)));
    await waitForServer(baseUrl, serverProcess, logs);
  }

  if (externalBaseUrl && process.env.SMOKE_ALLOW_MUTATION !== "1") {
    throw new Error("SMOKE_BASE_URL points at an existing server; set SMOKE_ALLOW_MUTATION=1 only for disposable data.");
  }
  await runApiChecks(baseUrl);
  await runHtmlChecks(baseUrl);
} finally {
  if (serverProcess) {
    await stopServer(serverProcess);
  }
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
}

const failed = checks.filter((check) => !check.ok);
for (const check of checks) {
  const marker = check.ok ? "PASS" : "FAIL";
  console.log(`${marker} ${check.name}${check.detail ? ` - ${check.detail}` : ""}`);
}

if (failed.length > 0) {
  console.error(`\nSmoke test failed: ${failed.length}/${checks.length} checks failed.`);
  process.exit(1);
}

console.log(`\nSmoke test passed: ${checks.length} checks.`);

async function runApiChecks(origin) {
  const smokeRunId = `smoke-${Date.now().toString(36)}`;
  const state = await checkJson("GET /api/state", `${origin}/api/state`, {
    validate: (body) => {
      assertArray(body.videos, "videos");
      assertArray(body.templates, "templates");
      assertArray(body.folders, "folders");
      assertArray(body.downloads, "downloads");
      assertArray(body.matchReports, "matchReports");
    },
  });

  const firstVideo = state?.videos?.[0]?.id || "vid-001";
  const secondVideo = state?.videos?.[1]?.id || firstVideo;
  const preSyncVideo = findById(state?.videos, firstVideo);
  const category = encodeURIComponent(state?.videos?.[0]?.category || "All");
  const ingestSource = `https://example.com/shorts/${smokeRunId}`;
  const smokeFolder = `Smoke Test Folder ${smokeRunId}`;

  await checkJson("GET /api/videos query contract", `${origin}/api/videos?category=${category}&sort=views`, {
    validate: (body) => assertArray(body.videos ?? body, "videos response"),
  });
  await checkJson("GET /api/videos language filter contract", `${origin}/api/videos?language=${encodeURIComponent("영어")}`, {
    validate: (body) => {
      assertArray(body.videos ?? body, "videos response");
      if ((body.videos ?? body).length !== 0) throw new Error("expected English filter to narrow Korean seed data to 0");
    },
  });
  await checkJson("GET /api/videos/:id contract", `${origin}/api/videos/${firstVideo}`, {
    validate: (body) => {
      const video = body.video ?? body;
      if (!video?.id) throw new Error("expected video.id");
      if (video.id !== firstVideo) throw new Error("expected requested video id");
      if (!Array.isArray(video.viewsHistory)) throw new Error("expected video detail viewsHistory");
    },
  });
  await checkJson("GET /api/videos/:id returns 404 for missing video", `${origin}/api/videos/video-missing-smoke`, {
    expectedStatus: 404,
    validate: (body) => {
      if (!String(body.error ?? "").includes("not found")) throw new Error("expected missing video detail error");
    },
  });
  await checkJson("GET /api/templates contract", `${origin}/api/templates`, {
    validate: (body) => assertArray(body.templates ?? body, "templates response"),
  });
  await checkJson("GET /api/rankings contract", `${origin}/api/rankings?sort=velocity`, {
    validate: (body) => assertArray(body.videos ?? body, "rankings response"),
  });
  await checkJson("POST /api/youtube/search dry-run returns search plan", `${origin}/api/youtube/search`, {
    method: "POST",
    json: { query: "korean convenience store shorts", dryRun: true, language: "한국어", maxResults: 7, order: "viewCount", regionCode: "KR" },
    validate: (body) => {
      if (body.dryRun !== true) throw new Error("expected dryRun response");
      if (!String(body.plan?.searchUrl ?? "").includes("youtube/v3/search")) throw new Error("expected search endpoint");
      if (!String(body.plan?.searchUrl ?? "").includes("type=video")) throw new Error("expected type=video search");
      if (!String(body.plan?.searchUrl ?? "").includes("videoDuration=short")) throw new Error("expected short video search");
      if (body.plan?.maxResults !== 7) throw new Error("expected maxResults clamp to preserve 7");
      if (body.plan?.regionCode !== "KR") throw new Error("expected KR region");
    },
  });
  await checkJson("POST /api/youtube/search requires query", `${origin}/api/youtube/search`, {
    method: "POST",
    json: { dryRun: true },
    expectedStatus: 400,
    validate: (body) => {
      if (!String(body.error ?? "").includes("query")) throw new Error("expected query validation error");
    },
  });
  const ingestState = await checkJson("POST /api/ingest imports a manual reference", `${origin}/api/ingest`, {
    method: "POST",
    json: {
      sourceUrl: ingestSource,
      title: "Smoke English import",
      category: "Smoke Category",
      template: "Product Demo",
      language: "영어",
      duration: "00:27",
      hook: "smoke hook",
    },
    validate: (body) => {
      const video = body.videos?.find((item) => item.sourceUrl === ingestSource);
      if (!video) throw new Error("expected ingested video in state");
      if (!video.id.startsWith("manual-")) throw new Error(`expected manual id, got ${video.id}`);
      if (video.sourceKind !== "manual") throw new Error("expected manual sourceKind");
      if (video.language !== "영어") throw new Error("expected ingested language");
      if (!video.ingestedAt) throw new Error("expected ingestedAt");
      assertArray(video.viewsHistory, "ingested video viewsHistory");
    },
  });
  const firstIngestedVideo = ingestState?.videos?.find((item) => item.sourceUrl === ingestSource);
  const firstIngestHistoryLength = firstIngestedVideo?.viewsHistory?.length ?? 0;
  const dedupState = await checkJson("POST /api/ingest dedupes by sourceUrl", `${origin}/api/ingest`, {
    method: "POST",
    json: {
      sourceUrl: ingestSource,
      title: "Smoke English import updated",
      category: "Smoke Category",
      template: "Product Demo",
      language: "영어",
    },
    validate: (body) => {
      const matches = body.videos?.filter((item) => item.sourceUrl === ingestSource) ?? [];
      if (matches.length !== 1) throw new Error(`expected one ingested video, got ${matches.length}`);
      if (matches[0].title !== "Smoke English import updated") throw new Error("expected sourceUrl dedupe to update title");
      if ((matches[0].viewsHistory ?? []).length !== firstIngestHistoryLength) throw new Error("expected metadata re-ingest to preserve viewsHistory length");
      if (matches[0].lastSampledAt !== firstIngestedVideo?.lastSampledAt) throw new Error("expected metadata re-ingest to preserve lastSampledAt");
    },
  });
  const ingestedVideo = dedupState?.videos?.find((item) => item.sourceUrl === ingestSource)
    ?? ingestState?.videos?.find((item) => item.sourceUrl === ingestSource);
  const ingestedId = ingestedVideo?.id || "manual-smoke";

  await checkJson("GET /api/videos language filter includes ingested English video", `${origin}/api/videos?language=${encodeURIComponent("영어")}`, {
    validate: (body) => {
      const videos = body.videos ?? body;
      assertArray(videos, "videos response");
      if (!videos.some((video) => video.id === ingestedId)) throw new Error("expected English ingested video");
    },
  });
  await checkJson("GET /api/videos combines category template and query", `${origin}/api/videos?category=${encodeURIComponent("Smoke Category")}&template=${encodeURIComponent("Product Demo")}&q=${encodeURIComponent("Smoke")}`, {
    validate: (body) => {
      const videos = body.videos ?? body;
      assertArray(videos, "videos response");
      if (!videos.some((video) => video.id === ingestedId)) throw new Error("expected ingested video in combined query");
    },
  });
  await checkJson("GET /api/videos/:id returns ingested metadata", `${origin}/api/videos/${ingestedId}`, {
    validate: (body) => {
      const video = body.video ?? body;
      if (video.id !== ingestedId) throw new Error("expected ingested video id");
      if (video.sourceUrl !== ingestSource) throw new Error("expected ingested sourceUrl");
      if (video.language !== "영어") throw new Error("expected ingested language");
    },
  });
  await checkJson("POST /api/ingest rejects invalid language", `${origin}/api/ingest`, {
    method: "POST",
    json: { title: "Invalid language smoke", language: "Spanish" },
    expectedStatus: 400,
    validate: (body) => {
      if (!String(body.error ?? "").includes("language")) throw new Error("expected language validation error");
    },
  });

  await checkJson("POST /api/saved toggles a video", `${origin}/api/saved`, {
    method: "POST",
    json: { videoId: secondVideo },
    validate: (body) => {
      const video = body.video ?? findById(body.videos, secondVideo) ?? body;
      if (!video?.id) throw new Error("expected video in saved response");
      if (typeof video.saved !== "boolean") throw new Error("expected saved boolean");
    },
  });
  await checkJson("POST /api/folders assigns a folder", `${origin}/api/folders`, {
    method: "POST",
    json: { videoId: secondVideo, folder: smokeFolder },
    validate: (body) => {
      const video = body.video ?? findById(body.videos, secondVideo) ?? body;
      if (video.folder !== smokeFolder) throw new Error("folder was not assigned");
    },
  });
  await checkJson("GET /api/folders returns collection summaries", `${origin}/api/folders`, {
    validate: (body) => {
      assertArray(body.folders, "folders");
      const collection = body.folders.find((folder) => folder.name === smokeFolder);
      if (!collection) throw new Error("expected assigned smoke folder collection");
      assertArray(collection.videos, "collection.videos");
      assertArray(collection.templates, "collection.templates");
      if (!collection.videos.some((video) => video.id === secondVideo)) throw new Error("expected folder collection to include assigned video");
      if (collection.savedCount < 1) throw new Error("expected folder savedCount");
      if (typeof collection.topVelocity !== "string") throw new Error("expected topVelocity");
    },
  });
  await checkJson("GET /api/folders filters one collection", `${origin}/api/folders?folder=${encodeURIComponent(smokeFolder)}`, {
    validate: (body) => {
      if (body.folders?.length !== 1) throw new Error("expected one filtered folder");
      if (body.activeFolder?.name !== smokeFolder) throw new Error("expected active smoke folder");
      if (!body.activeFolder.videos.some((video) => video.id === secondVideo)) throw new Error("expected active folder video");
    },
  });
  await checkJson("GET /api/folders returns 404 for missing folder", `${origin}/api/folders?folder=${encodeURIComponent(`${smokeFolder} missing`)}`, {
    expectedStatus: 404,
    validate: (body) => {
      if (!String(body.error ?? "").includes("Folder not found")) throw new Error("expected missing folder error");
    },
  });
  await checkJson("GET /api/downloads returns queue total", `${origin}/api/downloads`, {
    validate: (body) => {
      assertArray(body.downloads, "downloads");
      if (body.total !== body.downloads.length) throw new Error("expected total to equal downloads length");
    },
  });
  await checkJson("POST /api/downloads rejects missing video", `${origin}/api/downloads`, {
    method: "POST",
    json: { videoId: "vid-missing", startSec: 1, endSec: 9, policyAccepted: true },
    expectedStatus: 404,
    validate: (body) => {
      if (!String(body.error ?? "").includes("not found")) throw new Error("expected missing video error");
    },
  });
  const roundedState = await checkJson("POST /api/downloads rounds fractional bounds", `${origin}/api/downloads`, {
    method: "POST",
    json: { videoId: secondVideo, startSec: 2.4, endSec: 12.6, policyAccepted: true },
    validate: (body) => {
      const clip = findClip(body.downloads, secondVideo, 2, 13, "queued");
      if (!clip) throw new Error("expected rounded queued clip at 2-13");
    },
  });
  const roundedClipId = findClip(roundedState?.downloads, secondVideo, 2, 13, "queued")?.id;
  await checkJson("POST /api/downloads dedupes active queued clip", `${origin}/api/downloads`, {
    method: "POST",
    json: { videoId: secondVideo, startSec: 2, endSec: 13, policyAccepted: true },
    validate: (body) => {
      const matches = (body.downloads ?? []).filter((clip) => clip.videoId === secondVideo && clip.startSec === 2 && clip.endSec === 13 && clip.status === "queued");
      if (matches.length !== 1) throw new Error(`expected one active queued clip, got ${matches.length}`);
      if (matches[0].id !== roundedClipId) throw new Error("expected queued dedupe to preserve clip id");
    },
  });
  await checkJson("PATCH /api/downloads marks clip processing without output", `${origin}/api/downloads`, {
    method: "PATCH",
    json: { clipId: roundedClipId, status: "processing" },
    validate: (body) => {
      const clip = findById(body.downloads, roundedClipId);
      if (clip?.status !== "processing") throw new Error("expected processing status");
      if (clip.outputPath || clip.error) throw new Error("expected processing to clear outputPath and error");
    },
  });
  await checkJson("PATCH /api/downloads uses default failure message", `${origin}/api/downloads`, {
    method: "PATCH",
    json: { clipId: roundedClipId, status: "failed" },
    validate: (body) => {
      const clip = findById(body.downloads, roundedClipId);
      if (clip?.status !== "failed") throw new Error("expected failed status");
      if (!String(clip.error ?? "").includes("완료하지 못했습니다")) throw new Error("expected default failure message");
    },
  });
  const downloadState = await checkJson("POST /api/downloads queues a clip", `${origin}/api/downloads`, {
    method: "POST",
    json: { videoId: secondVideo, startSec: 2, endSec: 12, policyAccepted: true },
    validate: (body) => {
      const clip = body.clip ?? findClip(body.downloads, secondVideo, 2, 12, "queued") ?? body;
      if (!clip?.id) throw new Error("expected clip.id");
      if (clip.status !== "queued") throw new Error("expected queued clip");
    },
  });
  await checkJson("GET /api/folders reflects folder download count", `${origin}/api/folders?folder=${encodeURIComponent(smokeFolder)}`, {
    validate: (body) => {
      if (body.activeFolder?.downloadCount < 1) throw new Error("expected folder downloadCount after queueing clip");
    },
  });
  const clipId = findClip(downloadState?.downloads, secondVideo, 2, 12, "queued")?.id;
  if (!clipId) throw new Error("smoke setup failed: queued clip was not created");
  await checkJson("PATCH /api/downloads marks clip ready", `${origin}/api/downloads`, {
    method: "PATCH",
    json: { clipId, status: "ready" },
    validate: (body) => {
      const clip = findById(body.downloads, clipId);
      if (clip?.status !== "ready") throw new Error("expected ready status");
      if (!clip.outputPath) throw new Error("expected outputPath for ready clip");
    },
  });
  await checkJson("PATCH /api/downloads marks clip failed", `${origin}/api/downloads`, {
    method: "PATCH",
    json: { clipId, status: "failed", error: "Smoke failed" },
    validate: (body) => {
      const clip = findById(body.downloads, clipId);
      if (clip?.status !== "failed") throw new Error("expected failed status");
      if (clip.error !== "Smoke failed") throw new Error("expected failure reason");
    },
  });
  const requeuedDownloadState = await checkJson("POST /api/downloads creates a new clip after terminal status", `${origin}/api/downloads`, {
    method: "POST",
    json: { videoId: secondVideo, startSec: 2, endSec: 12, policyAccepted: true },
    validate: (body) => {
      const matchingClips = (body.downloads ?? []).filter((clip) => clip.videoId === secondVideo && clip.startSec === 2 && clip.endSec === 12);
      const ids = new Set(matchingClips.map((clip) => clip.id));
      if (matchingClips.length < 2) throw new Error("expected a fresh queued clip after failed terminal status");
      if (ids.size !== matchingClips.length) throw new Error("expected unique clip ids");
      if (!matchingClips.some((clip) => clip.status === "queued" && clip.id !== clipId)) throw new Error("expected new queued clip id");
    },
  });
  const requeuedClipId = (requeuedDownloadState?.downloads ?? []).find((clip) => clip.videoId === secondVideo && clip.startSec === 2 && clip.endSec === 12 && clip.status === "queued")?.id;
  await checkJson("POST /api/downloads/process dry-run returns yt-dlp ffmpeg plan", `${origin}/api/downloads/process`, {
    method: "POST",
    json: { clipId: requeuedClipId, dryRun: true },
    validate: (body) => {
      if (body.dryRun !== true) throw new Error("expected dryRun response");
      if (body.plan?.clipId !== requeuedClipId) throw new Error("expected plan clip id");
      if (!hasCommand(body.plan?.commands?.ytdlp, "yt-dlp")) throw new Error("expected yt-dlp command");
      if (!hasCommand(body.plan?.commands?.ffmpeg, "ffmpeg")) throw new Error("expected ffmpeg command");
      if (!String(body.plan?.outputPath ?? "").endsWith(".mp4")) throw new Error("expected mp4 output path");
    },
  });
  await checkJson("POST /api/downloads/process rejects missing clip", `${origin}/api/downloads/process`, {
    method: "POST",
    json: { clipId: "clip-missing", dryRun: true },
    expectedStatus: 404,
    validate: (body) => {
      if (!String(body.error ?? "").includes("not found")) throw new Error("expected not found error");
    },
  });
  await checkJson("PATCH /api/downloads rejects invalid status", `${origin}/api/downloads`, {
    method: "PATCH",
    json: { clipId, status: "done" },
    expectedStatus: 400,
    validate: (body) => {
      if (!String(body.error ?? "").includes("status")) throw new Error("expected status validation error");
    },
  });
  await checkJson("PATCH /api/downloads returns 404 for missing clip", `${origin}/api/downloads`, {
    method: "PATCH",
    json: { clipId: "clip-missing", status: "ready" },
    expectedStatus: 404,
    validate: (body) => {
      if (!String(body.error ?? "").includes("not found")) throw new Error("expected not found error");
    },
  });
  await checkJson("POST /api/downloads requires policy acceptance", `${origin}/api/downloads`, {
    method: "POST",
    json: { videoId: secondVideo, startSec: 2, endSec: 12 },
    expectedStatus: 400,
    validate: (body) => {
      if (!String(body.error ?? "").includes("policyAccepted")) throw new Error("expected policyAccepted validation error");
    },
  });
  await checkJson("POST /api/downloads rejects invalid bounds", `${origin}/api/downloads`, {
    method: "POST",
    json: { videoId: secondVideo, startSec: 12, endSec: 2 },
    expectedStatus: 400,
    validate: (body) => {
      if (!body.error) throw new Error("expected validation error message");
    },
  });
  const noSourceState = await checkJson("POST /api/ingest imports title-only reference", `${origin}/api/ingest`, {
    method: "POST",
    json: { title: "No source smoke", category: "Smoke Category", template: "Product Demo" },
    validate: (body) => {
      if (!body.videos?.some((video) => video.title === "No source smoke" && !video.sourceUrl)) throw new Error("expected title-only ingested video");
    },
  });
  const noSourceVideo = noSourceState?.videos?.find((video) => video.title === "No source smoke");
  const noSourceDownloadState = await checkJson("POST /api/downloads queues title-only clip", `${origin}/api/downloads`, {
    method: "POST",
    json: { videoId: noSourceVideo?.id, startSec: 1, endSec: 8, policyAccepted: true },
    validate: (body) => {
      if (!findClip(body.downloads, noSourceVideo?.id, 1, 8, "queued")) throw new Error("expected title-only queued clip");
    },
  });
  const noSourceClip = findClip(noSourceDownloadState?.downloads, noSourceVideo?.id, 1, 8, "queued");
  await checkJson("POST /api/downloads/process rejects clip without sourceUrl", `${origin}/api/downloads/process`, {
    method: "POST",
    json: { clipId: noSourceClip?.id, dryRun: true },
    expectedStatus: 400,
    validate: (body) => {
      if (!String(body.error ?? "").includes("sourceUrl")) throw new Error("expected sourceUrl validation error");
    },
  });
  const invalidSourceState = await checkJson("POST /api/ingest imports invalid-url reference", `${origin}/api/ingest`, {
    method: "POST",
    json: { sourceUrl: `not-a-url-${smokeRunId}`, title: "Invalid source smoke", category: "Smoke Category", template: "Product Demo" },
    validate: (body) => {
      if (!body.videos?.some((video) => video.title === "Invalid source smoke" && video.sourceUrl?.startsWith("not-a-url-"))) throw new Error("expected invalid-url ingested video");
    },
  });
  const invalidSourceVideo = invalidSourceState?.videos?.find((video) => video.title === "Invalid source smoke");
  const invalidSourceDownloadState = await checkJson("POST /api/downloads queues invalid-url clip", `${origin}/api/downloads`, {
    method: "POST",
    json: { videoId: invalidSourceVideo?.id, startSec: 1, endSec: 5, policyAccepted: true },
    validate: (body) => {
      if (!findClip(body.downloads, invalidSourceVideo?.id, 1, 5, "queued")) throw new Error("expected invalid-url queued clip");
    },
  });
  const invalidSourceClip = findClip(invalidSourceDownloadState?.downloads, invalidSourceVideo?.id, 1, 5, "queued");
  await checkJson("POST /api/downloads/process persists deterministic failure", `${origin}/api/downloads/process`, {
    method: "POST",
    json: { clipId: invalidSourceClip?.id },
    validate: (body) => {
      const clip = findById(body.downloads, invalidSourceClip?.id);
      if (clip?.status !== "failed") throw new Error("expected failed status after invalid source processing");
      if (!clip.error) throw new Error("expected processing error");
      if (clip.outputPath) throw new Error("failed processing should not expose outputPath");
    },
  });
  await checkJson("POST /api/match-reports creates a report", `${origin}/api/match-reports`, {
    method: "POST",
    json: {
      videoId: secondVideo,
      remakeTitle: "Smoke remake with changed structure",
      remakeUrl: "https://example.com/remake-smoke",
      remakeNotes: "new footage, new audio, different structure, CTA order changed",
    },
    validate: (body) => {
      const report = body.report ?? body.matchReports?.[0] ?? body;
      if (!report?.id) throw new Error("expected report.id");
      if (!report.sourceTitle) throw new Error("expected source title from videoId");
      if (report.remakeTitle !== "Smoke remake with changed structure") throw new Error("expected remake title from input");
      if (report.remakeUrl !== "https://example.com/remake-smoke") throw new Error("expected remake url from input");
      if (!["Low", "Medium", "High"].includes(report.risk)) throw new Error("expected risk level");
      assertArray(report.signals, "report.signals");
      if (report.signals.length !== 4) throw new Error("expected four separated match signals");
      for (const label of ["텍스트/키워드", "사운드 핑거프린트", "픽셀/프레임", "구조/전개"]) {
        if (!report.signals.some((signal) => signal.label === label && /%$/.test(signal.score))) throw new Error(`expected signal ${label}`);
      }
      assertArray(report.policyChecks, "report.policyChecks");
      if (report.policyChecks.length < 4) throw new Error("expected expanded policy checks");
    },
  });
  await checkJson("POST /api/match-reports rejects missing source video", `${origin}/api/match-reports`, {
    method: "POST",
    json: { videoId: "vid-missing", remakeTitle: "Missing source smoke" },
    expectedStatus: 404,
    validate: (body) => {
      if (!String(body.error ?? "").includes("not found")) throw new Error("expected missing source video error");
    },
  });
  await checkJson("POST /api/sync refreshes sampled metrics", `${origin}/api/sync`, {
    method: "POST",
    json: {},
    validate: (body) => {
      if (!body.lastSyncedAt) throw new Error("expected lastSyncedAt");
      assertArray(body.videos, "videos");
      const syncedVideo = findById(body.videos, firstVideo);
      if (!preSyncVideo || !syncedVideo) throw new Error("expected sampled video");
      if (syncedVideo.viewCount <= preSyncVideo.viewCount) throw new Error("expected viewCount to increase");
      if (!syncedVideo.lastSampledAt) throw new Error("expected lastSampledAt");
      if ((syncedVideo.viewsHistory ?? []).length <= (preSyncVideo.viewsHistory ?? []).length) throw new Error("expected viewsHistory sample to append");
      const latestSample = syncedVideo.viewsHistory.at(-1);
      if (latestSample?.views !== syncedVideo.viewCount) throw new Error("expected latest sample to match viewCount");
    },
  });
}

async function runHtmlChecks(origin) {
  for (const route of HTML_ROUTES) {
    await checkText(`GET ${route} HTML route`, `${origin}${route}`, {
      validate: (text) => {
        if (!text.includes("__next")) throw new Error("expected Next.js HTML payload");
      },
    });
  }
}

async function checkJson(name, url, options = {}) {
  return check(name, async () => {
    const response = await fetchWithTimeout(url, requestOptions(options));
    const text = await response.text();
    const body = parseJson(text, url);
    const expectedStatus = options.expectedStatus ?? 200;
    if (response.status !== expectedStatus) {
      throw new Error(`expected HTTP ${expectedStatus}, got ${response.status}: ${summarizeBody(body)}`);
    }
    options.validate?.(body);
    return body;
  });
}

async function checkText(name, url, options = {}) {
  return check(name, async () => {
    const response = await fetchWithTimeout(url);
    const text = await response.text();
    if (response.status !== 200) throw new Error(`expected HTTP 200, got ${response.status}`);
    options.validate?.(text);
    return text;
  });
}

async function check(name, fn) {
  try {
    const result = await fn();
    checks.push({ name, ok: true });
    return result;
  } catch (error) {
    checks.push({ name, ok: false, detail: error.message });
    return null;
  }
}

function requestOptions(options) {
  if (!options.method && !options.json) return undefined;
  return {
    method: options.method || "GET",
    headers: options.json ? { "content-type": "application/json" } : undefined,
    body: options.json ? JSON.stringify(options.json) : undefined,
  };
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function waitForServer(origin, child, logs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < STARTUP_TIMEOUT_MS) {
    if (child.exitCode !== null) {
      throw new Error(`Next dev server exited early.\n${logs.join("").slice(-4_000)}`);
    }
    try {
      const response = await fetchWithTimeout(origin);
      if (response.status < 500) return;
    } catch {
      await sleep(500);
    }
  }
  throw new Error(`Timed out waiting for ${origin}.\n${logs.join("").slice(-4_000)}`);
}

async function stopServer(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      resolve();
    }, 5000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

async function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function hasProductionBuild() {
  try {
    await stat(path.join(process.cwd(), ".next", "BUILD_ID"));
    return true;
  } catch {
    return false;
  }
}

function normalizeBaseUrl(value) {
  if (!value) return "";
  return value.replace(/\/+$/, "");
}

function parseJson(text, url) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`expected JSON from ${url}, got: ${text.slice(0, 160)}`);
  }
}

function assertArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`expected ${label} to be an array`);
}

function findById(items, id) {
  return Array.isArray(items) ? items.find((item) => item.id === id) : undefined;
}

function findClip(items, videoId, startSec, endSec, status) {
  if (!Array.isArray(items)) return undefined;
  return items.find((item) => (
    item.videoId === videoId
    && item.startSec === startSec
    && item.endSec === endSec
    && (!status || item.status === status)
  ));
}

function hasCommand(parts, command) {
  return Array.isArray(parts) && parts.some((part) => part === command || String(part).endsWith(`/${command}`));
}

function summarizeBody(body) {
  if (typeof body === "string") return body.slice(0, 160);
  return JSON.stringify(body).slice(0, 240);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
