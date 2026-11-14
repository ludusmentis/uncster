/**
 * UAT mock harness config (M003 / S03-3) — wraps vite.config.ts and injects
 * the fetch-mock setup script (mock/uat-mock-setup.ts) as the first module
 * script in index.html so it executes before the app entry. Run with:
 *
 *   npx vite --config vite-mock.config.ts
 *
 * Used only for browser UAT screenshots with mocked Spotify data; never for
 * real dev (the real config stays untouched) and never imported by tests.
 */
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import baseConfig from './vite.config';
import { defineConfig, mergeConfig, type Plugin } from 'vite';

/**
 * UAT runs pin port 3000 (--port 3000 --strictPort) and verification treats a
 * port-in-use startup failure as exit 1. Orphaned mock-server instances from
 * previous attempts/sessions are the recurring cause, so the config frees the
 * port itself at load time (before vite binds) — same best-effort contract as
 * scripts/free-port-3000.mjs (npm run dev predev). Never imported by the app
 * or tests; mock-config-only.
 */
const freePort3000 = (): void => {
  try {
    const pids = execSync('lsof -ti tcp:3000', { encoding: 'utf8' })
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    for (const pid of pids) {
      try {
        process.kill(Number(pid), 'SIGKILL');
        console.log(`[vite-mock] killed stale listener on :3000 (pid ${pid})`);
      } catch {
        /* already gone */
      }
    }
    if (pids.length > 0) execSync('sleep 0.3');
  } catch {
    /* lsof exit 1 = no listener; nothing to do */
  }
};
freePort3000();

const injectMockSetup = (): Plugin => ({
  name: 'uat-mock-setup-injector',
  apply: 'serve',
  transformIndexHtml(html: string): string {
    // Match the entry script by prefix only: after an HMR invalidation vite
    // serves index.html with a cache-busting query on the entry
    // (/src/main.tsx?t=...), and an exact-string replace silently drops
    // the mock injection (MEM034 loop-guard cousin — always verify via
    // curl before walking).
    const entryScript = /<script type="module" src="\/src\/main\.tsx[^"]*"><\/script>/;
    if (!entryScript.test(html)) {
      throw new Error(
        '[uat-mock-setup-injector] entry script tag not found — mock not injected',
      );
    }
    return html.replace(
      entryScript,
      '<script type="module" src="/mock/uat-mock-setup.ts"></script>\n' +
        '$&',
    );
  },
});

export default defineConfig(
  mergeConfig(baseConfig, {
    plugins: [injectMockSetup()],
    resolve: {
      alias: {
        '/mock/uat-mock-setup.ts': fileURLToPath(
          new URL('./mock/uat-mock-setup.ts', import.meta.url),
        ),
      },
    },
  }),
);
