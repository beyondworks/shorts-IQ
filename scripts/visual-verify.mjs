// 8792에 read-only로 붙어 스크린샷 + 콘솔 에러를 수집한다 (자체 임시 프로필 → MCP 잠금 무관).
import { chromium } from 'playwright';

const base = process.env.VERIFY_BASE_URL || 'http://127.0.0.1:8792';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1480, height: 1020 } });
const errors = [];
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

const shots = [
  { path: '/', file: 'verify-dashboard.png' },
  { path: '/rankings', file: 'verify-rankings.png' },
];

for (const shot of shots) {
  await page.goto(`${base}${shot.path}`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2800); // 클라 /api/state + /api/videos 로드 대기
  await page.screenshot({ path: shot.file, fullPage: false });
  console.log(`shot: ${shot.file}`);
}

// 핵심 UI 텍스트가 실제 DOM에 렌더됐는지 검증
await page.goto(`${base}/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
const bodyText = await page.evaluate(() => document.body.innerText);
const checks = ['터진 영상 대량 발견', '터진 영상 대량 수집', '지금 터진 영상', '최고 배율', '터진 신호'];
for (const text of checks) console.log(`${bodyText.includes(text) ? 'OK ' : 'MISSING '} "${text}"`);

console.log(`console errors: ${errors.length}`);
errors.slice(0, 8).forEach((e) => console.log(`  - ${e}`));

await browser.close();
