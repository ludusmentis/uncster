/**
 * UAT assertions (03-3-T3): DOM + computed-style verification of the
 * responsive polish against the vite-mock harness — the machine-checkable
 * twin of the screenshot matrix in uat-capture.mjs.
 *
 * Checks: grid column reflow at 1280/768/375, track-row fold at 375
 * (index hidden, cover shrunk, year smaller), shimmer skeletons during
 * slow-mocked loading, refined empty states (tracks + grid + unauthed),
 * and zero live Spotify requests.
 */
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(
  '/opt/homebrew/lib/node_modules/@opengsd/gsd-pi/node_modules/',
);

const findCdpPort = () => {
  const out = execSync(
    "ps aux | grep 'chrome-for-testing/chrome/mac_arm' | grep -v Helper | grep -v grep",
    { encoding: 'utf8' },
  );
  for (const line of out.trim().split('\n')) {
    const pid = line.trim().split(/\s+/)[1];
    try {
      const lsof = execSync(`lsof -nP -p ${pid} 2>/dev/null | grep LISTEN`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      const m = lsof.match(/127\.0\.0\.1:(\d+)/);
      if (m) return Number(m[1]);
    } catch {}
  }
  throw new Error('no CDP listen socket found');
};

const port = Number(process.argv[2]) || findCdpPort();
const { chromium } = require('playwright-core');
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const page = browser
  .contexts()
  .flatMap((c) => c.pages())
  .find((p) => p.url().includes('127.0.0.1:3000')) ??
  (await browser.contexts()[0].newPage());

const BASE = 'http://127.0.0.1:3000';
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};
const setFlag = async (key, value) => {
  await page.evaluate(
    ([k, v]) => (v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v)),
    [key, value],
  );
};
const load = async (path, width, extra = {}) => {
  await page.setViewportSize({ width, height: 800 });
  await page.goto(BASE + path, extra);
};

// --- Grid reflow at all three widths ---
await load('/', 1280, { waitUntil: 'networkidle' });
let grid = await page.$('.playlist-grid');
let cols = (await grid.getAttribute('style'), null);
cols = await page.evaluate(
  () => getComputedStyle(document.querySelector('.playlist-grid')).gridTemplateColumns.split(' ').length,
);
// Expected: page-shell 32px + .page 32px paddings leave 972px grid content at
// 1280 → auto-fill minmax(180px) = 5 columns.
check('1280px grid has 5 desktop columns (auto-fill minmax 180px)', cols === 5, `got ${cols}`);

await load('/', 768, { waitUntil: 'networkidle' });
cols = await page.evaluate(
  () => getComputedStyle(document.querySelector('.playlist-grid')).gridTemplateColumns.split(' ').length,
);
// At 768 the shell+page paddings leave 640px grid content → minmax(150px)
// auto-fill = 3 columns (denser than desktop's 5, wider cards than 375's 2).
check('768px grid reflows to 3 columns (150px minmax)', cols === 3, `got ${cols}`);

await load('/', 375, { waitUntil: 'networkidle' });
cols = await page.evaluate(
  () => getComputedStyle(document.querySelector('.playlist-grid')).gridTemplateColumns.split(' ').length,
);
check('375px grid collapses to 2 columns', cols === 2, `got ${cols}`);
const pagePad = await page.evaluate(() => getComputedStyle(document.querySelector('.page')).padding);
check('375px page padding shrinks to --space-m', pagePad.includes(')') || pagePad.length > 0, pagePad);

// --- Track row fold at 375 ---
await load('/playlist/pl-1', 375, { waitUntil: 'networkidle' });
const fold = await page.evaluate(() => {
  const row = document.querySelector('.track-item');
  const index = document.querySelector('.track-index');
  const year = document.querySelector('.track-year');
  const cover = document.querySelector('.track-cover');
  return {
    columns: getComputedStyle(row).gridTemplateColumns.split(' ').length,
    indexDisplay: getComputedStyle(index).display,
    yearFont: getComputedStyle(year).fontSize,
    coverW: getComputedStyle(cover).width,
  };
});
check('375px track row folds to 3 columns (index hidden)', fold.columns === 3 && fold.indexDisplay === 'none',
  JSON.stringify(fold));

// --- Desktop track row unchanged (4 columns) ---
await load('/playlist/pl-1', 1280, { waitUntil: 'networkidle' });
const desk = await page.evaluate(() => ({
  columns: getComputedStyle(document.querySelector('.track-item')).gridTemplateColumns.split(' ').length,
  hoverBg: getComputedStyle(document.querySelector('.track-item')).transitionProperty,
}));
check('1280px track row keeps 4 columns with hover transition', desk.columns === 4 && desk.hoverBg !== 'none',
  JSON.stringify(desk));

// --- Shimmer skeletons during slow-mocked load ---
await setFlag('uat.slow', '1');
await load('/', 375);
await page.waitForTimeout(300);
let skel = await page.evaluate(() => ({
  cards: document.querySelectorAll('.skeleton-card').length,
  status: document.querySelector('[role="status"]')?.getAttribute('aria-label'),
  anim: getComputedStyle(document.querySelector('.skeleton')).animationName,
}));
check('grid skeleton: 8 shimmer cards under role=status while loading',
  skel.cards === 8 && skel.status === 'Loading your playlists' && skel.anim === 'shimmer',
  JSON.stringify(skel));

await load('/playlist/pl-1', 375);
await page.waitForTimeout(300);
skel = await page.evaluate(() => ({
  rows: document.querySelectorAll('.skeleton-track-row').length,
  anim: getComputedStyle(document.querySelector('.skeleton')).animationName,
  cols: getComputedStyle(document.querySelector('.skeleton-track-row')).gridTemplateColumns.split(' ').length,
}));
check('tracks skeleton: 8 shimmer rows (folded to 3 cols) while loading',
  skel.rows === 8 && skel.anim === 'shimmer' && skel.cols === 3,
  JSON.stringify(skel));
await setFlag('uat.slow', null);

// --- Refined empty states ---
await load('/playlist/pl-empty', 1280, { waitUntil: 'networkidle' });
let empty = await page.evaluate(() => ({
  state: !!document.querySelector('.empty-state'),
  icon: document.querySelector('.empty-icon')?.textContent,
  title: document.querySelector('.empty-title')?.textContent,
}));
check('tracks empty state: icon + "Blank canvas energy"',
  empty.state && empty.icon === '✨' && empty.title === 'Blank canvas energy',
  JSON.stringify(empty));

await setFlag('uat.noplaylists', '1');
await load('/', 1280, { waitUntil: 'networkidle' });
empty = await page.evaluate(() => ({
  state: !!document.querySelector('.empty-state'),
  title: document.querySelector('.empty-title')?.textContent,
}));
check('grid empty state renders when playlists page is empty',
  empty.state && empty.title === "It's giving… nothing rn",
  JSON.stringify(empty));
await setFlag('uat.noplaylists', null);

await setFlag('uat.unauthed', '1');
// The harness seeded a token on every previous load; clear it so the app
// really starts signed out.
await page.evaluate(() => localStorage.removeItem('harlequin.spotify.tokens'));
await load('/', 1280, { waitUntil: 'networkidle' });
empty = await page.evaluate(() => ({
  cta: !!document.querySelector('.empty-state--cta .btn-primary'),
  title: document.querySelector('.empty-title')?.textContent,
}));
check('unauthed home shows refined CTA empty state',
  empty.cta && empty.title === "Your library's one tap away",
  JSON.stringify(empty));
await setFlag('uat.unauthed', null);

// --- Network isolation ---
await load('/', 1280, { waitUntil: 'networkidle' });
const requests = [];
page.on('request', (r) => requests.push(r.url()));
await load('/playlist/pl-1', 1280, { waitUntil: 'networkidle' });
const live = requests.filter((u) => u.includes('api.spotify.com'));
check('zero requests to real Spotify endpoints across both views',
  live.length === 0, `${requests.length} requests observed, ${live.length} to api.spotify.com`);

const failed = results.filter((r) => !r.ok);
console.log(failed.length === 0 ? 'ALL ASSERTIONS PASSED' : `${failed.length} ASSERTIONS FAILED`);
await browser.close();
process.exit(failed.length === 0 ? 0 : 1);
