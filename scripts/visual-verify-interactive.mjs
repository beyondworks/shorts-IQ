// 인터랙션 시각 검증: 수집 서랍 열림(z-index/레이아웃), 기간 탭 전환. read-only(수집 트리거 안 함).
import { chromium } from 'playwright';

const base = process.env.VERIFY_BASE_URL || 'http://127.0.0.1:8792';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1480, height: 1020 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(`${base}/`, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(2800);

// KPI 텍스트 확인 (수정 후 breakout 표시 정상인지 — /api/state는 readVisibleState라 정상이어야)
const kpiText = await page.evaluate(() => {
  const strip = document.querySelector('.kpiStrip') || document.querySelector('.kpiGrid');
  return strip ? strip.innerText.replace(/\n+/g, ' | ') : '(KPI strip 없음)';
});
console.log('KPI:', kpiText);

// 1) 수집 서랍 열기
const ingest = page.getByRole('button', { name: /영상 가져오기|수집/ });
if (await ingest.count()) {
  await ingest.first().click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'verify-ingest-open.png' });
  console.log('shot: verify-ingest-open.png (수집 서랍 열림)');
  // 서랍이 헤더 위로 잘 뜨는지 + 스크롤 겹침 점검: 서랍 연 채 살짝 스크롤
  await page.mouse.wheel(0, 200);
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'verify-ingest-scroll.png' });
  console.log('shot: verify-ingest-scroll.png (서랍+스크롤 겹침 점검)');
  // 닫기 (바깥 클릭)
  await page.mouse.click(740, 60);
  await page.waitForTimeout(400);
} else {
  console.log('수집 버튼 못 찾음');
}

// 2) 기간 탭 '이번 주' 전환
await page.goto(`${base}/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
const week = page.getByRole('button', { name: /이번 주/ });
if (await week.count()) {
  await week.first().click();
  await page.waitForTimeout(2200); // /api/videos?uploaded=7일 재fetch
  await page.screenshot({ path: 'verify-period-week.png' });
  const active = await page.evaluate(() => {
    const a = document.querySelector('.periodTabs button.active, .rankTabs button.active');
    return a ? a.innerText : '(active 탭 없음)';
  });
  console.log('shot: verify-period-week.png | active 탭:', active);
} else {
  console.log('기간 탭 못 찾음');
}

console.log('console errors:', errors.length);
errors.slice(0, 6).forEach((e) => console.log('  -', e));
await browser.close();
