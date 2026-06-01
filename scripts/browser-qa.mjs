import { spawn } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { chromium } from "playwright";

const STARTUP_TIMEOUT_MS = 45_000;
const BASE_VIEWPORT = { width: 1440, height: 1000 };

const checks = [];
const externalBaseUrl = Boolean(process.env.BROWSER_QA_BASE_URL);
let baseUrl = normalizeBaseUrl(process.env.BROWSER_QA_BASE_URL);
let serverProcess = null;
let tempDir = null;
let browser = null;

try {
  if (!baseUrl) {
    const port = await getAvailablePort();
    baseUrl = `http://127.0.0.1:${port}`;
    tempDir = await mkdtemp(path.join(tmpdir(), "shorts-iq-browser-qa-"));
    const dataPath = process.env.SHORTS_IQ_DATA_PATH || path.join(tempDir, "shorts-iq.json");
    const mode = process.env.BROWSER_QA_SERVER_MODE === "start" && await hasProductionBuild() ? "start" : "dev";
    const youtubeEnv = process.env.BROWSER_QA_ALLOW_YOUTUBE_API
      ? {}
      : { SHORTS_IQ_YOUTUBE_API_KEY: "", YOUTUBE_DATA_API_KEY: "" };
    const args = mode === "start"
      ? ["exec", "next", "start", "--hostname", "127.0.0.1", "--port", String(port)]
      : ["exec", "next", "dev", "--hostname", "127.0.0.1", "--port", String(port)];

    serverProcess = spawn("pnpm", args, {
      cwd: process.cwd(),
      env: { ...process.env, ...youtubeEnv, SHORTS_IQ_DATA_PATH: dataPath },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const logs = [];
    serverProcess.stdout.on("data", (chunk) => logs.push(String(chunk)));
    serverProcess.stderr.on("data", (chunk) => logs.push(String(chunk)));
    await waitForServer(baseUrl, serverProcess, logs);
  } else if (!process.env.BROWSER_QA_ALLOW_MUTATION) {
    throw new Error("BROWSER_QA_BASE_URL points at an existing server; set BROWSER_QA_ALLOW_MUTATION=1 only for disposable data.");
  }

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: BASE_VIEWPORT });
  const consoleErrors = [];
  const runtimeIssues = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => runtimeIssues.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) => {
    const errorText = request.failure()?.errorText ?? "unknown";
    if (errorText.includes("ERR_ABORTED")) return;
    runtimeIssues.push(`request failed: ${request.method()} ${request.url()} ${errorText}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400 && !isExpectedResponse(response)) {
      runtimeIssues.push(`unexpected response: ${response.status()} ${response.url()}`);
    }
  });

  await runDiscoveryFlow(page);
  await runReferenceOpsFlow(page);
  await runSearchIngestFlow(page);
  await runMatchGuardFlow(page);
  await runNotFoundFlow(page);
  await runMobileOverflowFlow(page);

  const unexpectedConsoleErrors = consoleErrors.filter((line) => !isExpectedConsoleError(line));
  record("browser console has no unexpected errors", unexpectedConsoleErrors.length === 0, unexpectedConsoleErrors.join(" | "));
  record("browser runtime has no unexpected failures", runtimeIssues.length === 0, runtimeIssues.join(" | "));
} finally {
  if (browser) await browser.close();
  if (serverProcess) await stopServer(serverProcess);
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
}

const failed = checks.filter((check) => !check.ok);
for (const check of checks) {
  const marker = check.ok ? "PASS" : "FAIL";
  console.log(`${marker} ${check.name}${check.detail ? ` - ${check.detail}` : ""}`);
}

if (failed.length > 0) {
  console.error(`\nBrowser QA failed: ${failed.length}/${checks.length} checks failed.`);
  process.exit(1);
}

console.log(`\nBrowser QA passed: ${checks.length} checks.`);

async function runDiscoveryFlow(page) {
  await page.goto(`${baseUrl}/rankings`);
  await page.getByRole("button", { name: /언어\s*한국어/ }).click();
  await page.getByRole("option", { name: "영어" }).click();
  await page.waitForURL(/language=%EC%98%81%EC%96%B4/);
  await page.waitForFunction(() => document.body.textContent?.includes("조건이 너무 좁습니다"));

  record("rankings filter syncs language to URL", page.url().includes("language=%EC%98%81%EC%96%B4"), page.url());
  record("rankings empty state reflects server-filtered results", await page.getByText("조건이 너무 좁습니다").isVisible());
  record("template explorer nav removed", (await page.getByRole("link", { name: "Template Explorer" }).count()) === 0);
  record("channel-scale filter present (pint benchmark)", (await page.getByRole("button", { name: /채널규모/ }).count()) > 0);
  await assertNoHorizontalOverflow(page, "rankings desktop overflow");

  // 인기 채널 탭 (실시간 인기 채널)
  await page.getByRole("button", { name: "인기 채널" }).click();
  await page.waitForResponse((response) => response.url().includes("/api/channels")).catch(() => {});
  await page.waitForFunction(() => document.querySelectorAll(".channelRow").length > 0).catch(() => {});
  record("trend rankings channel tab loads ranked channels", (await page.locator(".channelRow").count()) > 0);
  await assertNoHorizontalOverflow(page, "channel tab desktop overflow");
}

async function runReferenceOpsFlow(page) {
  await page.goto(`${baseUrl}/videos/vid-001`);
  await page.getByText("/api/videos/vid-001", { exact: true }).waitFor();
  record("measurement honesty badge present (측정/추정/표본 부족)", (await page.getByText(/추정|측정|표본 부족/).count()) > 0);
  const detailActions = page.locator(".detailActions");
  await detailActions.getByRole("button", { name: /폴더 저장/ }).click();
  await page.getByRole("button", { name: /다운로드 후보/ }).click();
  await page.waitForFunction(() => document.body.textContent?.includes("다운로드 후보 폴더에 저장했습니다."));

  await detailActions.getByRole("button", { name: /구간 다운로드/ }).click();
  await page.waitForSelector("label.policyConfirm input");
  const queueButton = page.getByRole("button", { name: /다운로드 큐에 추가/ });
  record("download queue button is disabled until policy is accepted", await queueButton.isDisabled());
  await page.locator("label.policyConfirm input").check();
  await Promise.all([
    page.waitForResponse((response) => response.url().includes("/api/downloads") && response.request().method() === "POST"),
    queueButton.click(),
  ]);
  await page.waitForFunction(() => document.body.textContent?.includes("정책 확인 후 다운로드 큐에 추가했습니다."));

  await page.goto(`${baseUrl}/folders`);
  await page.getByRole("button", { name: /다운로드 후보/ }).click();
  record("folders page shows reassigned video", await page.getByText("편의점 신상 조합이 터진 이유").isVisible());

  await page.goto(`${baseUrl}/downloads`);
  const queuedClipText = await page.locator(".queueList .queueItem").first().textContent().catch(() => "");
  record("downloads page shows queued clip", queuedClipText?.includes("편의점 신상 조합이 터진 이유"), queuedClipText || "no queued clip");
  await assertNoHorizontalOverflow(page, "reference ops desktop overflow");
}

async function runSearchIngestFlow(page) {
  const title = `Browser QA Reference ${Date.now().toString(36)}`;
  await page.goto(`${baseUrl}/`);
  await page.getByLabel("YouTube keyword").fill("browser qa no key");
  const youtubeResponsePromise = page.waitForResponse((response) => response.url().includes("/api/youtube/search") && response.request().method() === "POST");
  await page.getByRole("button", { name: /키워드 수집/ }).click();
  const youtubeResponse = await youtubeResponsePromise;
  const youtubeBody = await youtubeResponse.json().catch(() => ({}));
  record("youtube keyword import surfaces missing-key error", youtubeResponse.status() === 400 && String(youtubeBody.error ?? "").includes("API_KEY"), JSON.stringify(youtubeBody));
  record("youtube keyword import failure appears in UI", await page.getByText("API 오류").isVisible());

  await page.getByLabel("Manual title").fill(title);
  await page.getByRole("button", { name: /레퍼런스 추가/ }).click();
  await page.waitForFunction((text) => document.body.textContent?.includes(text), title);
  record("manual reference ingest appears in search results", await page.getByText(title).isVisible());
  await assertNoHorizontalOverflow(page, "search ingest desktop overflow");
}

async function runMatchGuardFlow(page) {
  await page.goto(`${baseUrl}/match`);
  await page.getByLabel("Remake title").fill("Browser QA remake changed structure");
  await page.getByLabel("Remake URL").fill("https://example.com/browser-qa-remake");
  await page.getByLabel("Remake notes").fill("new footage, new audio, different structure, CTA order changed");
  await Promise.all([
    page.waitForResponse((response) => response.url().includes("/api/match-reports") && response.request().method() === "POST"),
    page.getByRole("button", { name: /강력 검수 리포트 생성/ }).click(),
  ]);
  await page.waitForFunction(() => document.body.textContent?.includes("Browser QA remake changed structure") && /\d+%/.test(document.body.textContent || ""));

  const hasSignals = await page.evaluate(() => ["텍스트/키워드", "사운드 핑거프린트", "픽셀/프레임", "구조/전개"].every((label) => document.body.textContent?.includes(label)));
  const hasPolicy = await page.evaluate(() => document.body.textContent?.includes("원본 출처·사용 권한") && document.body.textContent?.includes("구조적 재사용 콘텐츠"));
  record("match guard renders four separated signals", hasSignals);
  record("match guard renders policy checks", hasPolicy);
  await assertNoHorizontalOverflow(page, "match guard desktop overflow");
}

async function runNotFoundFlow(page) {
  await page.goto(`${baseUrl}/videos/not-in-state`);
  await page.waitForSelector("text=이 숏츠는 현재 인덱스에 없습니다");
  const noFallbackTitle = !await page.getByText("편의점 신상 조합이 터진 이유").isVisible().catch(() => false);
  record("missing video detail does not fall back to another video", noFallbackTitle);
  record("missing video detail shows requested id", await page.getByText("not-in-state").first().isVisible());
  await assertNoHorizontalOverflow(page, "not-found desktop overflow");
}

async function runMobileOverflowFlow(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  const videosResponse = await page.request.get(`${baseUrl}/api/videos`);
  const videosBody = await videosResponse.json().catch(() => ({}));
  const firstVisibleVideoId = videosBody.videos?.[0]?.id || "vid-001";
  for (const route of ["/", "/rankings", "/saved", "/folders", "/downloads", "/match", `/videos/${firstVisibleVideoId}`]) {
    await page.goto(`${baseUrl}${route}`);
    await page.waitForLoadState("networkidle");
    await assertNoHorizontalOverflow(page, `${route} mobile overflow`);
    const overflowing = await page.evaluate(() => Array.from(document.querySelectorAll("button, h1, h2, p, strong, input, textarea"))
      .filter((element) => element.scrollWidth > element.clientWidth + 1)
      .slice(0, 5)
      .map((element) => element.textContent?.trim() || element.getAttribute("aria-label")));
    record(`${route} mobile text fits`, overflowing.length === 0, overflowing.join(" | "));
  }
}

async function assertNoHorizontalOverflow(page, name) {
  const result = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  record(name, result.scrollWidth <= result.clientWidth, `${result.scrollWidth} > ${result.clientWidth}`);
}

function record(name, ok, detail = "") {
  checks.push({ name, ok: Boolean(ok), detail: ok ? "" : detail });
}

async function waitForServer(origin, child, logs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < STARTUP_TIMEOUT_MS) {
    if (child.exitCode !== null) throw new Error(`Server exited early.\n${logs.join("")}`);
    try {
      const response = await fetch(origin, { signal: AbortSignal.timeout(1000) });
      if (response.ok || response.status < 500) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  throw new Error(`Timed out waiting for ${origin}.\n${logs.join("")}`);
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
      resolve();
    }, 3000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close(() => port ? resolve(port) : reject(new Error("Could not allocate port")));
    });
    server.on("error", reject);
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
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function isExpectedResponse(response) {
  return (
    response.status() === 404 && response.url().includes("/api/videos/not-in-state")
  ) || (
    response.status() === 400 && response.url().includes("/api/youtube/search")
  );
}

function isExpectedConsoleError(line) {
  return line.includes("404") || line.includes("400 (Bad Request)");
}
