/**
 * T001 verification: dev server boots on the exact registered redirect host
 * (http://127.0.0.1:3000) and serves the SPA shell with both routes resolving.
 * Exits 0 on success, 1 on failure; prints each check result.
 */
import { spawn } from 'node:child_process';

// Default 3000 = the registered Spotify redirect URI port. A different port
// can be passed as argv[2] ONLY to work around an environment-level port
// conflict (e.g. a stale Colima ssh forward holding *:3000); the app config
// itself stays pinned to 127.0.0.1:3000 with strictPort.
const port = process.argv[2] ?? '3000';
const URL_HOME = `http://127.0.0.1:${port}/`;
const URL_CALLBACK = `http://127.0.0.1:${port}/callback`;

// Spawn detached so we can signal the ENTIRE process group. Killing just the
// npx wrapper orphans the vite child, which keeps holding port 3000 and makes
// every subsequent verification run fail with EADDRINUSE.
const vite = spawn('npx', ['vite', '--port', port], {
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true,
});
let viteErr = '';
vite.stderr.on('data', (d) => { viteErr += d.toString(); });

async function waitForServer(timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(URL_HOME);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`dev server did not become ready; vite stderr: ${viteErr}`);
}

async function check(url, needle, label) {
  const res = await fetch(url);
  const body = await res.text();
  const ok = res.status === 200 && body.includes(needle);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label} (status ${res.status}, contains "${needle}")`);
  if (!ok) process.exitCode = 1;
}

try {
  await waitForServer();
  await check(URL_HOME, '<div id="root">', 'home route serves SPA shell');
  await check(URL_CALLBACK, '<div id="root">', 'callback route serves SPA shell');
  const html = await (await fetch(URL_HOME)).text();
  const hasEntry = html.includes('/src/main.tsx');
  console.log(`${hasEntry ? 'PASS' : 'FAIL'} entry module referenced`);
  if (!hasEntry) process.exitCode = 1;
} catch (err) {
  console.error(`FAIL ${err.message}`);
  process.exitCode = 1;
} finally {
  killTree();
}

function killTree() {
  if (vite.killed || vite.exitCode !== null) return;
  try {
    // Negative pid = signal the whole detached process group (npx + vite).
    process.kill(-vite.pid, 'SIGTERM');
  } catch {
    // Group already gone; fall back to direct kill in case the group id differs.
    try { vite.kill('SIGTERM'); } catch { /* already exited */ }
  }
}

// Never leave an orphaned vite holding port 3000, even on signals.
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => { killTree(); process.exit(1); });
}
process.on('exit', killTree);
