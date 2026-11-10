/**
 * UAT helper (03-3-T3): resizes the managed gsd-browser session's viewport
 * by attaching to its Chrome DevTools Protocol endpoint via playwright-core.
 *
 * Usage: node scripts/set-gsd-browser-viewport.mjs <width> <height> [cdpPort]
 *   cdpPort is discovered automatically from the "Google Chrome for Testing"
 *   main process listen socket when omitted.
 *
 * Why: the browser_* tool surface has no viewport control and window.resizeTo
 * is blocked for automation; media-query breakpoints (375/768/1280) therefore
 * need a CDP-driven Emulation viewport change on the managed session.
 */
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(
  '/opt/homebrew/lib/node_modules/@opengsd/gsd-pi/node_modules/',
);

const width = Number(process.argv[2]);
const height = Number(process.argv[3]);
if (!width || !height) {
  console.error('usage: node scripts/set-gsd-browser-viewport.mjs <w> <h>');
  process.exit(1);
}

const findCdpPort = () => {
  const out = execSync(
    "ps aux | grep 'chrome-for-testing/chrome/mac_arm' | grep -v Helper | grep -v grep",
    { encoding: 'utf8' },
  );
  const pid = out.trim().split('\n')[0].trim().split(/\s+/)[1];
  const lsof = execSync(`lsof -nP -p ${pid} 2>/dev/null | grep LISTEN`, {
    encoding: 'utf8',
  });
  const m = lsof.match(/127\.0\.0\.1:(\d+)/);
  if (!m) throw new Error('no CDP listen socket found');
  return Number(m[1]);
};

const port = Number(process.argv[4]) || findCdpPort();
const { chromium } = require('playwright-core');
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const contexts = browser.contexts();
let pages = contexts.flatMap((c) => c.pages());
if (pages.length === 0 && contexts.length > 0) {
  pages = [await contexts[0].newPage()];
}
for (const page of pages) {
  await page.setViewportSize({ width, height });
  console.log(
    `viewport set to ${width}x${height} on ${page.url()}`,
  );
}
await browser.close();
process.exit(0);
