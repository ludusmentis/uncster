/**
 * Self-contained mock-game UAT runner (M007 / S02, T05).
 *
 * `node scripts/uat-run.mjs` brings up the full P007 vite-mock harness,
 * runs the game walk, tears everything down, and exits with the walk's
 * exit code — so it works standalone (e.g. as a bare-string task verify
 * command replayed by post-unit verification, which has no dev server
 * or browser running beforehand):
 *
 *   1. frees port 3000 (scripts/free-port-3000.mjs)
 *   2. spawns the vite-mock dev server (vite-mock.config.ts, strict port)
 *   3. verifies the mock-injection marker is served before any walking
 *      (M003–M006 HMR gotcha guard, MEM034)
 *   4. spawns chrome-for-testing headless with a private CDP user-data-dir
 *      on an OS-assigned debugging port (read from DevToolsActivePort)
 *   5. runs scripts/uat-assert.mjs <cdpPort> (game-walk default mode)
 *   6. kills the server and browser, removes the temp dir, exits with the
 *      walk's exit code
 *
 * No new dependencies; chrome-for-testing is a pre-existing project
 * environment binary (see P007/KNOWLEDGE).
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

const CHROME_BIN =
  '/Users/orlorenz/chrome-for-testing/chrome/mac_arm-156.0.8078.47/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const BASE = 'http://127.0.0.1:3000';
const MARKER = 'uat-mock-setup';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll `cond` until it returns true or `ms` elapses; throws with `label` on timeout. */
async function waitFor(cond, ms, label) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await cond()) return;
    await sleep(400);
  }
  throw new Error(`uat-run: timed out waiting for ${label}`);
}

async function serverServesMarker() {
  try {
    const res = await fetch(`${BASE}/`);
    if (!res.ok) return false;
    return (await res.text()).includes(MARKER);
  } catch {
    return false;
  }
}

async function main() {
  spawnSync('node', ['scripts/free-port-3000.mjs'], { stdio: 'ignore' });

  const tmp = mkdtempSync(path.join(tmpdir(), 'harlequin-uat-'));
  const vite = spawn(
    'npx',
    ['vite', '--config', 'vite-mock.config.ts', '--port', '3000', '--strictPort'],
    { stdio: 'ignore' },
  );
  const cdpDir = path.join(tmp, 'cdp');
  let chrome = null;

  try {
    await waitFor(serverServesMarker, 60_000, 'vite-mock dev server with mock-injection marker');
    console.log('uat-run: vite-mock server up, mock-injection marker verified');

    chrome = spawn(
      CHROME_BIN,
      [
        '--headless=new',
        '--remote-debugging-port=0',
        `--user-data-dir=${cdpDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        'about:blank',
      ],
      { stdio: 'ignore' },
    );

    // With --remote-debugging-port=0 the chosen port is written to
    // DevToolsActivePort (first line) inside the user-data-dir.
    const portFile = path.join(cdpDir, 'DevToolsActivePort');
    await waitFor(
      () => existsSync(portFile) && readFileSync(portFile, 'utf8').trim().length > 0,
      30_000,
      'chrome-for-testing CDP port file',
    );
    const cdpPort = Number(readFileSync(portFile, 'utf8').split('\n')[0]);
    await waitFor(
      async () => {
        try {
          const r = await fetch(`http://127.0.0.1:${cdpPort}/json/version`);
          return r.ok;
        } catch {
          return false;
        }
      },
      30_000,
      'chrome CDP endpoint',
    );
    console.log(`uat-run: chrome-for-testing on CDP port ${cdpPort}`);

    const walk = spawnSync('node', ['scripts/uat-assert.mjs', String(cdpPort)], {
      stdio: 'inherit',
    });
    const rc = walk.status ?? 1;
    console.log(`uat-run: uat-assert exit ${rc}`);
    process.exitCode = rc;
  } finally {
    vite.kill('SIGTERM');
    chrome?.kill('SIGTERM');
    await sleep(800);
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
