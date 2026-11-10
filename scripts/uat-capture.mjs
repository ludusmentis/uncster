/**
 * UAT capture (03-3-T3): drives the managed gsd-browser session via CDP
 * (playwright-core connectOverCDP) to capture the slice-UAT screenshot
 * matrix — 1280/768/375 widths, grid + tracks + skeleton + empty states —
 * against the vite-mock harness (P006/P007), zero live Spotify calls.
 *
 * Usage: node scripts/uat-capture.mjs [cdpPort] [outDir]
 */
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(
  '/opt/homebrew/lib/node_modules/@opengsd/gsd-pi/node_modules/',
);

const findCdpPort = () => {
  const out = execSync(
    "ps aux | grep 'chrome-for-testing/chrome/mac_arm' | grep -v Helper | grep -v grep",
    { encoding: 'utf8' },
  );
  const pids = out
    .trim()
    .split('\n')
    .map((l) => l.trim().split(/\s+/)[1]);
  for (const pid of pids) {
    try {
      const lsof = execSync(
        `lsof -nP -p ${pid} 2>/dev/null | grep LISTEN`,
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] },
      );
      const m = lsof.match(/127\.0\.0\.1:(\d+)/);
      if (m) return Number(m[1]);
    } catch {
      // this pid has no listen socket — try the next candidate
    }
  }
  throw new Error('no CDP listen socket found');
};

const port = Number(process.argv[2]) || findCdpPort();
const outDir = process.argv[3] || '.gsd/uat-shots/03-3-T3';
mkdirSync(outDir, { recursive: true });

const { chromium } = require('playwright-core');
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const page = browser
  .contexts()
  .flatMap((c) => c.pages())
  .find((p) => p.url().includes('127.0.0.1:3000')) ??
  (await browser.contexts()[0].newPage());

const BASE = 'http://127.0.0.1:3000';
const setFlag = async (key, value) => {
  await page.evaluate(
    ([k, v]) => (v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v)),
    [key, value],
  );
};
const shoot = async (name, path, { width, flags = {}, settleMs = 400 } = {}) => {
  for (const [k, v] of Object.entries(flags)) await setFlag(k, v);
  await page.setViewportSize({ width, height: 800 });
  await page.goto(BASE + path);
  if (settleMs) await page.waitForTimeout(settleMs);
  await page.screenshot({ path: `${outDir}/${name}` });
  console.log(`captured ${name}`);
  for (const [k] of Object.entries(flags)) await setFlag(k, null);
};

// 1. Loaded views at all three widths.
await shoot('home-1280.png', '/', { width: 1280 });
await shoot('tracks-1280.png', '/playlist/pl-1', { width: 1280 });
await shoot('home-768.png', '/', { width: 768 });
await shoot('tracks-768.png', '/playlist/pl-1', { width: 768 });
await shoot('home-375.png', '/', { width: 375 });
await shoot('tracks-375.png', '/playlist/pl-1', { width: 375 });

// 2. Skeleton shimmer (slow-mocked fetches) at mobile + desktop.
await shoot('skeleton-home-375.png', '/', { width: 375, flags: { 'uat.slow': '1' } });
await shoot('skeleton-tracks-375.png', '/playlist/pl-1', { width: 375, flags: { 'uat.slow': '1' } });
await shoot('skeleton-home-1280.png', '/', { width: 1280, flags: { 'uat.slow': '1' } });

// 3. Refined empty states.
await shoot('empty-tracks-1280.png', '/playlist/pl-empty', { width: 1280 });
await shoot('empty-grid-1280.png', '/', { width: 1280, flags: { 'uat.noplaylists': '1' } });
await shoot('unauthed-home-1280.png', '/', { width: 1280, flags: { 'uat.unauthed': '1' } });

// 4. Network isolation proof: collect all requests from one loaded session.
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
const requests = [];
page.on('request', (r) => requests.push(r.url()));
await page.goto(BASE + '/playlist/pl-1', { waitUntil: 'networkidle' });
const live = requests.filter((u) => u.includes('api.spotify.com'));
console.log(
  `network check: ${requests.length} observed requests, ${live.length} to real Spotify endpoints`,
);
if (live.length > 0) {
  console.error('LIVE SPOTIFY REQUESTS DETECTED: ' + live.join(', '));
  process.exit(1);
}
console.log('ALL UAT CAPTURES DONE');
await browser.close();
process.exit(0);
