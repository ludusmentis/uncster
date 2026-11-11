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
import { fileURLToPath } from 'node:url';
import baseConfig from './vite.config';
import { defineConfig, mergeConfig, type Plugin } from 'vite';

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
